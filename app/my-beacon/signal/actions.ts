"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { buildSignalWelcomeEmail } from "@/lib/email/signal-emails";
import {
  normalizeHandle,
  validateHandleFormat,
  DISPLAY_NAME_MAX,
  HEADLINE_MAX,
  BIO_MAX,
  isSignalAccent,
} from "@/lib/signal";
import type { Json } from "@/lib/database.types";
import { isNflTeamCode } from "@/lib/nfl-teams";
import { signalTag, revalidateProfileCaches } from "@/lib/signal-profile";
import {
  isProfileLayout,
  coerceBlocks,
  serializeLayoutConfig,
} from "@/lib/signal/blocks";
import {
  parseSleeperLeagueSettings,
  mergeSleeperLeagueSettings,
} from "@/lib/sleeper-league-settings";
import {
  LINK_LABEL_MAX,
  LINK_URL_MAX,
  LINKS_MAX,
  type SignalLink,
  type PlayerSearchResult,
} from "./customization";

/**
 * Server actions for the My Signal editor. All writes go through the caller's
 * session client so the owner-only RLS policies apply, and the authoritative
 * handle triggers (migration 0068) enforce reserved words, reclaim blocking, and
 * the rename rate limit regardless of what we send. checkHandleAvailability uses
 * the service-role client because draft handles are invisible to anon/owner RLS,
 * so a plain query would miss handles taken by unpublished profiles.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export type HandleStatus =
  | "available"
  | "invalid"
  | "reserved"
  | "taken"
  | "unchanged";

// Map a database error (trigger RAISE or constraint violation) to friendly copy.
function mapHandleError(error: { message?: string; code?: string }): string {
  const m = error.message ?? "";
  if (m.includes("reserved_handle")) return "That handle is reserved.";
  if (m.includes("handle_unavailable")) {
    return "That handle was used by another profile and cannot be reused.";
  }
  if (m.includes("handle_change_rate_limited")) {
    return "You can change your handle again 30 days after your last change.";
  }
  if (error.code === "23505") return "That handle is already taken.";
  if (m.includes("signals_handle_check")) {
    return "Use 3 to 30 lowercase letters, numbers, or underscores.";
  }
  return "Could not save your handle. Please try again.";
}

export async function checkHandleAvailability(
  raw: string,
): Promise<{ status: HandleStatus; message: string }> {
  const handle = normalizeHandle(raw);
  const formatError = validateHandleFormat(handle);
  if (formatError) return { status: "invalid", message: formatError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Require a session. This action is service-role backed (it can see draft
  // handles), so leaving it open would let anyone enumerate which handles,
  // including unpublished ones, are taken.
  if (!user) {
    return { status: "invalid", message: "Sign in to check handle availability." };
  }

  const admin = createAdminClient();

  const { data: reserved } = await admin
    .from("signal_reserved_handles")
    .select("handle")
    .eq("handle", handle)
    .maybeSingle();
  if (reserved) return { status: "reserved", message: "That handle is reserved." };

  const { data: existing } = await admin
    .from("signals")
    .select("user_id")
    .eq("handle", handle)
    .maybeSingle();
  if (existing) {
    if (user && existing.user_id === user.id) {
      return { status: "unchanged", message: "This is already your handle." };
    }
    return { status: "taken", message: "That handle is already taken." };
  }

  const { data: historical } = await admin
    .from("signal_handle_history")
    .select("signal_id")
    .eq("old_handle", handle)
    .maybeSingle();
  if (historical) {
    if (user) {
      const { data: mine } = await admin
        .from("signals")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (mine && mine.id === historical.signal_id) {
        return { status: "available", message: "Available (your previous handle)." };
      }
    }
    return {
      status: "taken",
      message: "That handle was used by another profile and cannot be reused.",
    };
  }

  return { status: "available", message: "Available." };
}

export async function claimHandle(raw: string): Promise<ActionResult> {
  const handle = normalizeHandle(raw);
  const formatError = validateHandleFormat(handle);
  if (formatError) return { ok: false, error: formatError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: existing } = await supabase
    .from("signals")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return { ok: false, error: "You already have a Signal." };

  const metaName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const fallbackName = user.email ? user.email.split("@")[0] : "Creator";
  const displayName = (metaName || fallbackName).slice(0, DISPLAY_NAME_MAX);

  const { error } = await supabase
    .from("signals")
    .insert({ user_id: user.id, handle, display_name: displayName });
  if (error) return { ok: false, error: mapHandleError(error) };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, user.id);

  // Welcome the new creator. This runs only on a first claim (the guard above
  // errors if a Signal already exists), so renames never re-trigger it. Sent after
  // the response via after() so a slow email provider never delays the claim, and
  // a delivery failure never fails it. Name priority matches the other emails:
  // profile first/last name, then the account display name, else no name.
  if (user.email) {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("first_name, last_name")
      .eq("user_id", user.id)
      .maybeSingle();
    const welcomeName =
      [prefs?.first_name, prefs?.last_name].filter(Boolean).join(" ").trim() || metaName;
    const welcome = buildSignalWelcomeEmail({ name: welcomeName || null, handle });
    const to = user.email;
    after(() =>
      sendEmail({
        to,
        subject: `Welcome @${handle}! Let's start boosting your signal!`,
        html: welcome.html,
        text: welcome.text,
      }),
    );
  }

  return { ok: true };
}

/**
 * Persist the profile accent. The slug is validated against the fixed Phase 3
 * palette (SIGNAL_ACCENT_SLUGS, enforced by isSignalAccent) before the write;
 * the signals.accent CHECK (migration 0069) is the database backstop. Never
 * trust the client value.
 */
export async function saveAccent(accent: string): Promise<ActionResult> {
  if (!isSignalAccent(accent)) {
    return { ok: false, error: "That is not a valid accent." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { error } = await supabase
    .from("signals")
    .update({ accent, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not save your accent. Please try again." };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

/**
 * Persist the ordered custom-link list. Server-side validation (never trust the
 * client): https web links only (http, javascript:, data:, mailto: all
 * rejected), each URL must parse, labels are 1..40 chars after trimming, and at
 * most 10 links. The signals.links shape guard (migration 0069) is the DB
 * backstop.
 */
export async function saveLinks(input: SignalLink[]): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  if (!Array.isArray(input)) {
    return { ok: false, error: "Could not read your links." };
  }
  if (input.length > LINKS_MAX) {
    return { ok: false, error: `You can add at most ${LINKS_MAX} links.` };
  }

  const cleaned: SignalLink[] = [];
  for (const raw of input) {
    const label = typeof raw?.label === "string" ? raw.label.trim() : "";
    const url = typeof raw?.url === "string" ? raw.url.trim() : "";
    if (label.length < 1 || label.length > LINK_LABEL_MAX) {
      return {
        ok: false,
        error: `Each link needs a label of 1 to ${LINK_LABEL_MAX} characters.`,
      };
    }
    if (url.length > LINK_URL_MAX) {
      return { ok: false, error: "One of your links is too long." };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `"${label}" does not have a valid web address.` };
    }
    if (parsed.protocol !== "https:") {
      return {
        ok: false,
        error: `"${label}" must be an https:// web address.`,
      };
    }
    cleaned.push({ label, url: parsed.toString() });
  }

  const { error } = await supabase
    .from("signals")
    .update({
      links: cleaned as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not save your links. Please try again." };

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

/**
 * Persist favorite team and favorite player. The team code is validated against
 * the canonical 32-team list (signals.favorite_team CHECK is the backstop); the
 * player id must be a real players row (the FK is the backstop) or null to
 * clear. Either may be null independently.
 */
export async function saveFavorites(input: {
  favoriteTeam: string | null;
  favoritePlayerId: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const favoriteTeam = input.favoriteTeam;
  if (favoriteTeam !== null && !isNflTeamCode(favoriteTeam)) {
    return { ok: false, error: "That is not a valid NFL team." };
  }

  const favoritePlayerId = input.favoritePlayerId;
  if (favoritePlayerId !== null) {
    if (
      typeof favoritePlayerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        favoritePlayerId,
      )
    ) {
      return { ok: false, error: "That is not a valid player." };
    }
    const { data: player } = await supabase
      .from("players")
      .select("id")
      .eq("id", favoritePlayerId)
      .maybeSingle();
    if (!player) return { ok: false, error: "We could not find that player." };
  }

  const { error } = await supabase
    .from("signals")
    .update({
      favorite_team: favoriteTeam,
      favorite_player_id: favoritePlayerId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) {
    return { ok: false, error: "Could not save your favorites. Please try again." };
  }

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

/**
 * Typeahead search over the players table for the favorite-player picker. Reads
 * through the session client (players is public-read) and requires a session so
 * the editor-only endpoint is not openly callable. The query is sanitized to a
 * safe character set before the ilike, and we use a single .ilike (not .or) so
 * there is no PostgREST filter-string injection surface.
 */
export async function searchPlayers(
  rawQuery: string,
): Promise<PlayerSearchResult[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Keep letters, digits, spaces, and the few punctuation marks that appear in
  // real names. Strip everything else (including % _ , ( ) * \ which have
  // meaning in PostgREST filters) before building the pattern.
  const q = rawQuery
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s'.-]/gu, "")
    .trim()
    .slice(0, 40);
  if (q.length < 2) return [];

  const { data } = await supabase
    .from("players")
    .select("id, slug, full_name, first_name, last_name, position, team")
    .ilike("full_name", `%${q}%`)
    .order("full_name", { ascending: true })
    .limit(20);

  return (data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
    position: p.position,
    team: p.team,
  }));
}

export async function updateHandle(raw: string): Promise<ActionResult> {
  const handle = normalizeHandle(raw);
  const formatError = validateHandleFormat(handle);
  if (formatError) return { ok: false, error: formatError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  // Capture the old handle so we can bust its cached profile bundle too: after
  // a rename the old handle should 301, not serve a stale profile.
  const { data: before } = await supabase
    .from("signals")
    .select("handle")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("signals")
    .update({ handle, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: mapHandleError(error) };

  revalidatePath("/my-beacon/signal");
  // Bust the old handle's bundle so it 301s instead of serving the old profile,
  // then bust the new handle + all the user's board caches (board views embed
  // the owner handle).
  if (before?.handle && before.handle !== handle) {
    revalidateTag(signalTag(before.handle));
  }
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

export async function saveIdentity(input: {
  displayName: string;
  headline: string;
  bio: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Display name must be 1 to ${DISPLAY_NAME_MAX} characters.` };
  }
  const headline = input.headline.trim();
  if (headline.length > HEADLINE_MAX) {
    return { ok: false, error: `Headline must be ${HEADLINE_MAX} characters or fewer.` };
  }
  const bio = input.bio.trim();
  if (bio.length > BIO_MAX) {
    return { ok: false, error: `Bio must be ${BIO_MAX} characters or fewer.` };
  }

  const { error } = await supabase
    .from("signals")
    .update({
      display_name: displayName,
      headline: headline.length > 0 ? headline : null,
      bio: bio.length > 0 ? bio : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not save your details. Please try again." };

  revalidatePath("/my-beacon/signal");
  // display_name also appears on the public board view, so bust board caches too.
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

export async function setPublishState(input: {
  status: "draft" | "published";
  visibility: "public" | "private";
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: current } = await supabase
    .from("signals")
    .select("handle, published_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Claim your handle first." };

  // Stamp published_at the first time the profile is published; never clear it.
  const publishedAt =
    input.status === "published" && !current.published_at
      ? new Date().toISOString()
      : current.published_at;

  const { error } = await supabase
    .from("signals")
    .update({
      status: input.status,
      visibility: input.visibility,
      published_at: publishedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not update visibility. Please try again." };

  revalidatePath("/my-beacon/signal");
  // Unpublishing must also invalidate the public board views, which are gated
  // on this profile being live; otherwise a board stays viewable until the ISR
  // window lapses.
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

/**
 * Persist the ordered set of Sleeper leagues featured on the public Signal
 * profile. Stored under user_preferences.sleeper_league_settings.signal_league_ids.
 * We sanity-cap the list and store only valid-looking ids; the public page
 * renders only those already synced into the leagues table.
 */
export async function saveSignalLeagues(
  orderedSleeperLeagueIds: string[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  // Keep only digit ids (Sleeper league ids are numeric strings), de-duplicate
  // preserving order, and cap the count.
  const seen = new Set<string>();
  const cleaned = orderedSleeperLeagueIds
    .filter((id) => typeof id === "string" && /^[0-9]{1,32}$/.test(id))
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .slice(0, 12);

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user.id)
    .maybeSingle();

  const current = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);
  const merged = mergeSleeperLeagueSettings(current, {
    signal_league_ids: cleaned,
  });

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { user_id: user.id, sleeper_league_settings: merged },
      { onConflict: "user_id" },
    );
  if (error) {
    return { ok: false, error: "Could not save your featured leagues. Please try again." };
  }

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}

/**
 * Persist the profile layout (Layout A "feed" vs Layout B "sidebar") and the
 * ordered block list (signals.layout_config). Input is untrusted: the layout is
 * validated against the allowed set and the blocks are coerced (shape, singleton
 * uniqueness, id dedupe, MAX_BLOCKS cap). Board and league references are then
 * filtered to the entities the owner has actually featured (profile_visible
 * boards and signal_league_ids leagues), so layout_config never stores a
 * reference the owner cannot use. The public resolver also degrades gracefully if
 * a stored reference later becomes unavailable.
 */
export async function saveLayout(
  layout: string,
  blocks: unknown,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  if (!isProfileLayout(layout)) {
    return { ok: false, error: "That is not a valid layout." };
  }

  const cleaned = coerceBlocks(blocks);

  const { data: boardRows } = await supabase
    .from("user_ranking_boards")
    .select("id")
    .eq("user_id", user.id)
    .eq("profile_visible", true);
  const allowedBoardIds = new Set((boardRows ?? []).map((b) => b.id));

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user.id)
    .maybeSingle();
  const allowedLeagueIds = new Set(
    parseSleeperLeagueSettings(prefs?.sleeper_league_settings).signal_league_ids ??
      [],
  );

  const filtered = cleaned.filter((block) => {
    if (block.type === "board_top_n") return allowedBoardIds.has(block.boardId);
    if (block.type === "league_card") {
      return allowedLeagueIds.has(block.sleeperLeagueId);
    }
    return true;
  });

  const { error } = await supabase
    .from("signals")
    .update({
      layout,
      layout_config: serializeLayoutConfig(filtered) as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) {
    return { ok: false, error: "Could not save your layout. Please try again." };
  }

  revalidatePath("/my-beacon/signal");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true };
}
