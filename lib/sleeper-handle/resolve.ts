import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import type { Database } from "@/lib/database.types";
import { getSleeperUser } from "@/lib/sleeper";
import {
  mergeSleeperLeagueSettings,
  parseSleeperLeagueSettings,
  type SleeperLeagueSettings,
} from "@/lib/sleeper-league-settings";
import { normalizeSleeperHandle } from "./validate";
import type {
  HandleGateState,
  SavedSleeperHandle,
  SleeperViewer,
} from "./types";

/**
 * The one module that reads the reader's saved Sleeper handle.
 *
 * `loadSavedSleeperHandle` answers "who is this reader". `resolveSleeperViewer`
 * answers "who is this surface acting for", which is a different question the
 * moment a shareable `?username=` link is involved. `resolveHandleGate` answers
 * both at once, for the surfaces that render an identity card.
 *
 * `lib/sleeper-handle/guard.test.ts` fails the suite if anything outside this
 * directory reads `sleeper_league_settings.username`. Before this module there
 * were seven copies of the same three lines, and that is how the
 * username-versus-display-name gap in the league deep views went unnoticed for
 * as long as it did.
 *
 * Nothing here throws. A surface that cannot tell who its reader is renders as
 * it does for a guest, which is always a correct page.
 */

type Client = SupabaseClient<Database>;

/** A backfill runs during a render, so it gets a render-sized deadline. */
const BACKFILL_TIMEOUT_MS = 2_500;

/** Enough to fill an id once, not enough to be a lever. See savedHandleWithId. */
const BACKFILL_BUCKET = "sleeper_handle_backfill";
const BACKFILL_WINDOW_SECONDS = 3_600;
const BACKFILL_MAX_PER_WINDOW = 3;

/**
 * The session read and the jsonb read, together, once per render.
 *
 * Together on purpose. `auth.getUser()` is an HTTP round trip to GoTrue here,
 * not a local decode, so "are they signed in" and "what did they save" asking
 * separately meant two of them on every tool page. Returning both from one
 * memoized call makes `resolveHandleGate` one round trip instead of two.
 *
 * `signedIn` is distinct from `settings`: a reader can be signed in with
 * nothing saved, and that is the `member-unsaved` state.
 */
const readIdentityRow = cache(
  async (
    supabase: Client,
  ): Promise<{ signedIn: boolean; settings: SleeperLeagueSettings | null }> => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { signedIn: false, settings: null };
      const { data } = await supabase
        .from("user_preferences")
        .select("sleeper_league_settings")
        .eq("user_id", user.id)
        .maybeSingle();
      return {
        signedIn: true,
        settings: parseSleeperLeagueSettings(data?.sleeper_league_settings),
      };
    } catch {
      // A broken session or a failed read is not evidence about a reader.
      return { signedIn: false, settings: null };
    }
  },
);

/**
 * The saved handle for the signed-in reader, or null. Never throws.
 *
 * Returns null for a signed-out reader AND for a signed-in reader who has
 * saved nothing, because no caller distinguishes them from the handle alone.
 * `resolveHandleGate` is what tells those two states apart.
 */
export async function loadSavedSleeperHandle(
  supabase: Client,
): Promise<SavedSleeperHandle | null> {
  const { settings } = await readIdentityRow(supabase);
  const username = settings?.username?.trim();
  if (!username) return null;
  return {
    username,
    sleeperUserId: settings?.sleeper_user_id ?? null,
    displayName: settings?.sleeper_display_name ?? null,
    avatar: settings?.sleeper_avatar ?? null,
    verifiedAt: settings?.handle_verified_at ?? null,
  };
}

/**
 * True when the reader is signed in, whatever they have saved.
 *
 * Goes through the same memoized read as the handle, so asking both questions
 * on one page costs one round trip rather than two.
 */
export async function isSignedIn(supabase: Client): Promise<boolean> {
  return (await readIdentityRow(supabase)).signedIn;
}

/** A searchParams value, which Next hands over as a string, an array or nothing. */
function readParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fails closed. A backfill we cannot meter is a backfill that does not run,
 * and not running costs a reader nothing except the id-first roster match on
 * this one render.
 */
async function claimBackfillSlot(): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/sleeper-handle-backfill", {
        headers: requestHeaders,
      }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "try_claim_rate_limit" as never,
      {
        p_bucket: BACKFILL_BUCKET,
        p_key: actorKey,
        p_max_requests: BACKFILL_MAX_PER_WINDOW,
        p_window_seconds: BACKFILL_WINDOW_SECONDS,
      } as never,
    );
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * The saved handle, with its Sleeper user id filled in if it was missing.
 *
 * METERED, and the reason is specific. This runs inside a PAGE RENDER on all
 * ten league deep views, and it is keyed on a value the reader can write:
 * `authenticated` holds a column grant on `sleeper_league_settings` because it
 * has to own its own preferences, so a reader can PATCH `sleeper_user_id` back
 * to null through PostgREST whenever they like. A failed resolution writes
 * nothing, so without a meter, alternating a PATCH with a page load spends one
 * Sleeper call per render from the shared process-wide bucket in
 * lib/sleeper-budget.ts, and other readers' interactive calls start timing out.
 *
 * A handful per hour is all this needs: it exists to fill an id ONCE for a row
 * saved before migration 0268, after which the early return above makes it
 * free forever.
 */
const savedHandleWithId = cache(
  async (supabase: Client): Promise<SavedSleeperHandle | null> => {
    const saved = await loadSavedSleeperHandle(supabase);
    if (!saved || saved.sleeperUserId) return saved;
    if (!(await claimBackfillSlot())) return saved;
    // Memoized, so one render fills it at most once however many callers ask.
    return ensureSleeperUserId(supabase, saved);
  },
);

/**
 * URL first, then the saved handle, then null.
 *
 * `?username=` is the shareable-link mechanism and stays one: a reader who
 * follows a link carrying someone else's handle sees that person's leagues and
 * team, signed in or not. An empty param counts as absent.
 *
 * When the URL wins, `sleeperUserId` is null unless the URL names the reader's
 * own saved handle (compared case-insensitively, because Sleeper resolves
 * handles that way), in which case the cached id is carried across and the
 * surface still saves its `getSleeperUser` call.
 */
export async function resolveSleeperViewer(
  supabase: Client,
  usernameParam: string | string[] | undefined,
): Promise<SleeperViewer | null> {
  const fromUrl = readParam(usernameParam);
  // The id is filled in here rather than at each caller, and that placement is
  // the whole point. The ten league deep views resolve their viewer through
  // this function and nothing else, so a row saved before migration 0268 would
  // otherwise carry a null id forever on exactly the surfaces the id exists
  // for: `matchViewerRoster` would fall straight through to the display-name
  // path, and a reader whose Sleeper username differs from their display name
  // would see no team highlighted. That is the defect this feature was built
  // to fix. It costs nothing once filled, and nothing at all for a reader who
  // already has an id.
  const saved = await savedHandleWithId(supabase);

  if (fromUrl) {
    const sameAsSaved =
      saved !== null && saved.username.toLowerCase() === fromUrl.toLowerCase();
    return {
      username: fromUrl,
      sleeperUserId: sameAsSaved ? saved.sleeperUserId : null,
      displayName: sameAsSaved ? saved.displayName : null,
      avatar: sameAsSaved ? saved.avatar : null,
      source: "url",
    };
  }

  if (!saved) return null;
  return {
    username: saved.username,
    sleeperUserId: saved.sleeperUserId,
    displayName: saved.displayName,
    avatar: saved.avatar,
    source: "saved",
  };
}

/**
 * The four-state gate every username surface renders one of.
 *
 * `member-overridden` is the one state that needs both halves: the card says
 * "Viewing as @x from this link" and offers a way back to @y.
 */
export async function resolveHandleGate(
  supabase: Client,
  usernameParam: string | string[] | undefined,
): Promise<HandleGateState> {
  const signedIn = await isSignedIn(supabase);
  if (!signedIn) return { kind: "guest" };

  // The filled handle, so the identity card has the avatar and display name
  // and every surface behind the gate matches rosters by id.
  const saved = await savedHandleWithId(supabase);
  if (!saved) return { kind: "member-unsaved" };

  const viewer = await resolveSleeperViewer(supabase, usernameParam);
  if (viewer && viewer.source === "url") {
    // A link that names the reader's own handle is not an override; it is the
    // same identity arriving by a different road, and saying "from this link"
    // about it would be noise.
    if (viewer.username.toLowerCase() !== saved.username.toLowerCase()) {
      return { kind: "member-overridden", handle: saved, viewer };
    }
  }

  return { kind: "member-saved", handle: saved };
}

/**
 * Fill in the Sleeper user id for a row saved before migration 0268.
 *
 * One `getSleeperUser` call, then the four identity keys written back through
 * the reader's OWN session client, so the owner-only RLS policy on
 * `user_preferences` is the boundary rather than something around it. The next
 * visit costs nothing.
 *
 * A failed resolution writes nothing and returns the handle unchanged. The
 * caller then behaves as the "no longer resolves" case: card, form opened, and
 * a sentence saying so. That distinction matters, because a Sleeper outage and
 * a renamed account are not the same thing, and clearing a good handle on the
 * first 500 would be the worse mistake.
 */
export async function ensureSleeperUserId(
  supabase: Client,
  handle: SavedSleeperHandle,
): Promise<SavedSleeperHandle> {
  if (handle.sleeperUserId) return handle;

  const normalized = normalizeSleeperHandle(handle.username);
  if (!normalized) return handle;

  let user: Awaited<ReturnType<typeof getSleeperUser>> = null;
  try {
    // A short deadline because this runs INSIDE A PAGE RENDER. The budget's
    // interactive deadline in lib/sleeper-budget.ts bounds only the wait for a
    // token, not the HTTP request that follows, so without this a slow Sleeper
    // could hold a render for the default twenty seconds.
    user = await getSleeperUser(normalized, BACKFILL_TIMEOUT_MS);
  } catch {
    return handle;
  }
  if (!user?.user_id) return handle;

  const filled: SavedSleeperHandle = {
    username: handle.username,
    sleeperUserId: user.user_id,
    displayName: user.display_name ?? null,
    avatar: user.avatar ?? null,
    verifiedAt: new Date().toISOString(),
  };

  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return filled;

    const { data: existing } = await supabase
      .from("user_preferences")
      .select("sleeper_league_settings")
      .eq("user_id", authUser.id)
      .maybeSingle();

    const merged = mergeSleeperLeagueSettings(
      parseSleeperLeagueSettings(existing?.sleeper_league_settings),
      {
        sleeper_user_id: filled.sleeperUserId,
        sleeper_display_name: filled.displayName,
        sleeper_avatar: filled.avatar,
        handle_verified_at: filled.verifiedAt,
      },
    );

    await supabase
      .from("user_preferences")
      .update({ sleeper_league_settings: merged })
      .eq("user_id", authUser.id);
  } catch {
    // The write is an optimization. A failed one costs the next visit one
    // Sleeper call and nothing else, so it is never worth failing a render for.
  }

  return filled;
}
