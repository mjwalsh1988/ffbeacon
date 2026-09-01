"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getSleeperLeague } from "@/lib/sleeper";
import { pulseLeague } from "@/lib/league-pulse";
import {
  loadLeagueRelaySettings,
  saveLeagueRelaySettings,
  validateLeagueRelaySettings,
} from "@/lib/league-relay/settings";
import { previewRelayMessages, type PreviewResult } from "@/lib/league-relay/preview";
import { runLeagueRelay, type RelayRunResult } from "@/lib/league-relay/relay";
import type { RelayMessageType } from "@/lib/league-relay/default-settings";

const ADMIN_PATH = "/admin/league-relay";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Persist the League Relay config.
 *
 * Admin-only and validated server-side. The client payload is never trusted: it
 * has to pass the full zod schema, including the cross-field rules (a message
 * type switched on with no channel, a recap window that ends before it starts),
 * before it is written with the service-role client.
 *
 * Saving changes what the NEXT tick does. It does not retract a message already
 * posted, which is the only sane behaviour: a channel has already seen it.
 */
export async function saveRelaySettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);

  const validated = validateLeagueRelaySettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await saveLeagueRelaySettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  revalidatePath(ADMIN_PATH);
  return { ok: true, message: "Saved. The next tick uses these." };
}

/** Sleeper league ids are numeric strings. Anything else is not worth a fetch. */
const SLEEPER_ID = /^\d{5,25}$/;

export interface LeagueSearchHit {
  /** leagues.id, or null when the league is on Sleeper but not synced here. */
  leagueRowId: string | null;
  sleeperLeagueId: string;
  name: string;
  season: number | null;
  totalRosters: number | null;
  alreadyCommunity: boolean;
}

/**
 * Find a league to nominate, by name or by Sleeper id.
 *
 * TWO SOURCES, IN ORDER. Our own `leagues` table first, because a league
 * already synced can be nominated immediately and searched by name. Then, when
 * the query looks like a Sleeper id and matched nothing here, Sleeper itself,
 * so an admin can nominate a league nobody has opened on the site yet.
 *
 * The name search is `ilike` over our own rows only. Sleeper has no league
 * search endpoint, and inventing one by guessing ids would be both useless and
 * rude.
 */
export async function searchLeaguesAction(query: string): Promise<LeagueSearchHit[]> {
  await requireAdmin(ADMIN_PATH);
  const q = query.trim();
  if (q.length < 2) return [];

  const admin = createAdminClient();

  const { data: community } = await admin.from("community_leagues").select("sleeper_league_id");
  const nominated = new Set((community ?? []).map((c) => c.sleeper_league_id));

  const isId = SLEEPER_ID.test(q);

  // NOT `.or()`. PostgREST's `or=(...)` takes a comma-separated expression
  // STRING, so anything interpolated into it is parsed as filter syntax rather
  // than as a value: a query containing a comma or a bracket changes which
  // predicates run. Only one condition is ever needed here, so each branch uses
  // the typed builder, where the value is sent as a value and cannot be read as
  // syntax. The id branch is additionally shape-checked by SLEEPER_ID above.
  //
  // Wildcards are STRIPPED from the name branch rather than escaped. `%` and
  // `_` are SQL LIKE wildcards and PostgREST additionally reads `*` as one, so
  // escaping correctly would mean getting two layers right; dropping them is
  // predictable, and a league name containing one of the three is not a search
  // anybody is running. Without this a query of "%" matches every league.
  const base = admin.from("leagues").select("id, sleeper_league_id, name, season, total_rosters");
  const { data: rows } = await (isId
    ? base.eq("sleeper_league_id", q)
    : base.ilike("name", `%${q.replace(/[%_*]/g, "")}%`)
  )
    .order("season", { ascending: false })
    .limit(20);

  const hits: LeagueSearchHit[] = (rows ?? []).map((l) => ({
    leagueRowId: l.id,
    sleeperLeagueId: l.sleeper_league_id,
    name: l.name,
    season: l.season,
    totalRosters: l.total_rosters,
    alreadyCommunity: nominated.has(l.sleeper_league_id),
  }));

  // Nothing stored, but it looks like an id: ask Sleeper. This is what lets an
  // admin paste an id for a league the site has never seen.
  if (hits.length === 0 && isId) {
    const league = await getSleeperLeague(q);
    if (league) {
      hits.push({
        leagueRowId: null,
        sleeperLeagueId: q,
        name: league.name,
        season: Number(league.season) || null,
        totalRosters: league.total_rosters ?? null,
        alreadyCommunity: nominated.has(q),
      });
    }
  }

  return hits;
}

/**
 * Mark a league as a community league.
 *
 * A LEAGUE THE SITE HAS NEVER SEEN IS SYNCED FIRST, in full, before the row is
 * written. Nominating an unsynced league and letting the cron discover it would
 * mean the first relay tick both syncs a whole season AND finds every
 * transaction in it newer than a watermark set moments earlier.
 *
 * THE WATERMARK IS SET TO NOW, ALWAYS. That is the line between "already
 * happened" and "news", and it is why nominating a league in November does not
 * replay September into the channel.
 */
export async function addCommunityLeagueAction(
  sleeperLeagueId: string,
  label: string | null,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);
  const id = sleeperLeagueId.trim();
  if (!SLEEPER_ID.test(id)) return { ok: false, error: "That is not a Sleeper league id." };

  const admin = createAdminClient();

  // Sync first. `pulseLeague` (not the two halves) because this is the one
  // moment we DO want every derived model built: the writeups read Power Pulse
  // ranks, and a league with none reads as having no standings at all.
  const pulse = await pulseLeague(admin, id, { force: true });
  if (!pulse.ok) {
    return { ok: false, error: `Could not sync that league from Sleeper: ${pulse.error}` };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("community_leagues").insert({
    league_id: pulse.leagueRowId,
    sleeper_league_id: id,
    label: label?.trim() || null,
    is_active: true,
    watermark_at: now,
    last_synced_at: now,
    sync_status: "ok",
    added_by: userId,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That league is already nominated." };
    return { ok: false, error: error.message };
  }

  revalidatePath(ADMIN_PATH);
  return {
    ok: true,
    message:
      "Added and synced. Only what happens from now on will be written up; nothing already in the league's history is posted.",
  };
}

/** Pause or resume a community league without losing its watermark or history. */
export async function setCommunityLeagueActiveAction(
  communityId: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(communityId)) return { ok: false, error: "Not a league id." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("community_leagues")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", communityId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(ADMIN_PATH);
  return {
    ok: true,
    message: isActive
      ? "Resumed. It syncs again on the next tick."
      : "Paused. It stops syncing and stops posting; nothing already posted is touched.",
  };
}

/**
 * Remove a league from the relay.
 *
 * The ledger rows survive, because they are the record of what was said in a
 * channel and deleting them would not unsay it. Re-adding the league later sets
 * a fresh watermark, and the surviving ledger keeps anything from the first
 * stint from being posted a second time.
 */
export async function removeCommunityLeagueAction(communityId: string): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(communityId)) return { ok: false, error: "Not a league id." };

  const admin = createAdminClient();
  const { error } = await admin.from("community_leagues").delete().eq("id", communityId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(ADMIN_PATH);
  return { ok: true, message: "Removed. The record of what it posted is kept." };
}

/**
 * Move a league's watermark.
 *
 * The one dangerous button on this page, which is why it takes a number of
 * hours rather than a date: an admin who wants "the last six hours" gets
 * exactly that, and cannot accidentally ask for the whole season by typing a
 * year wrong. The age cap in the settings still applies on top, so the real
 * reach is the smaller of the two.
 */
export async function rewindWatermarkAction(
  communityId: string,
  hours: number,
): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(communityId)) return { ok: false, error: "Not a league id." };
  const bounded = Math.min(168, Math.max(1, Math.round(Number(hours) || 1)));

  const admin = createAdminClient();
  const { error } = await admin
    .from("community_leagues")
    .update({
      watermark_at: new Date(Date.now() - bounded * 3_600_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", communityId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(ADMIN_PATH);
  return {
    ok: true,
    message: `Watermark moved back ${bounded} hours. The settings age cap still applies on top of it.`,
  };
}

/**
 * Build writeups without posting them.
 *
 * The safety rail for the whole feature. It runs the real builders on the real
 * league and returns the exact text a channel would receive, having claimed
 * nothing and sent nothing. It ignores the enable flags on purpose: an admin
 * previewing recaps has by definition not switched recaps on yet.
 */
export async function previewRelayAction(
  leagueRowId: string,
  types: RelayMessageType[],
): Promise<{ ok: true; result: PreviewResult } | { ok: false; error: string }> {
  await requireAdmin(ADMIN_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(leagueRowId)) return { ok: false, error: "Not a league id." };
  if (types.length === 0) return { ok: false, error: "Pick at least one message type." };

  const admin = createAdminClient();
  try {
    const result = await previewRelayMessages(admin, { leagueRowId, types, perType: 1 });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The preview failed." };
  }
}

/**
 * Run the relay right now, for one league.
 *
 * This POSTS. It is the same code path the cron runs, claims included, so it
 * cannot double-post anything the cron has already sent and anything it sends
 * the cron will not send again.
 */
export async function runRelayNowAction(
  leagueRowId: string,
): Promise<{ ok: true; result: RelayRunResult } | { ok: false; error: string }> {
  await requireAdmin(ADMIN_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(leagueRowId)) return { ok: false, error: "Not a league id." };

  const admin = createAdminClient();
  const settings = await loadLeagueRelaySettings(admin);
  // The gates an admin would be testing. Pretending they are set would teach
  // them nothing and would post from a configuration they have not saved.
  if (!settings.enabled) {
    return { ok: false, error: "League Relay is switched off. Turn it on and save first." };
  }

  try {
    const result = await runLeagueRelay(admin, { leagueId: leagueRowId });
    revalidatePath(ADMIN_PATH);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The run failed." };
  }
}
