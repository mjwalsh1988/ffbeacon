"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import type { Database } from "@/lib/database.types";
import {
  getSleeperLeagues,
  currentNflSeason,
  type SleeperLeague,
} from "@/lib/sleeper";
import { formatTeamLabel } from "@/lib/team-label";
import { pulseLeague, normalizeDraftPicks } from "@/lib/league-pulse";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
} from "@/lib/sleeper-handle/resolve";
import type { SavedSleeperHandle } from "@/lib/sleeper-handle/types";
import {
  deriveLeagueFormat,
  mapToFormatSlug,
  describeDerivedFormat,
  pickClosestSupportedFormat,
} from "@/lib/sleeper-to-format";
import { resolveFormat, supportedFormatCandidates } from "@/lib/signal-check/format";
import { buildValueResolver } from "@/lib/signal-check/values";
import { loadSignalCheckSettings, loadActiveRuleset } from "@/lib/signal-check/settings";
import { runPipeline } from "@/lib/signal-check/pipeline";
import { freezeAnalysis } from "@/lib/signal-check/freeze";
import { toBuilderView, type BuilderView } from "@/lib/signal-check/builder-view";
import { buildPickPositionResolver } from "@/lib/league-pick-position";
import { SignalCheckError } from "@/lib/signal-check/errors";
import type { AnalysisInput, SideKey } from "@/lib/signal-check/types";
import { headers } from "next/headers";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";

type AnalysisInsert = Database["public"]["Tables"]["signal_check_analyses"]["Insert"];

export interface ImportLeague {
  sleeperLeagueId: string;
  name: string;
  season: string;
  /**
   * Sleeper's own league logo id, straight off the payload. Null for the many
   * leagues that never set one, which the logo component renders as a
   * same-sized placeholder so the column stays aligned.
   */
  avatar: string | null;
}

export interface ImportTradeTeam {
  rosterId: number;
  teamName: string;
  playerCount: number;
  pickCount: number;
}

export interface ImportTrade {
  sleeperTransactionId: string;
  week: number | null;
  teams: ImportTradeTeam[];
  label: string;
}

/** Per-asset headshot metadata aligned by index to the result's side assets. */
export interface ImportAssetMeta {
  kind: "player" | "pick";
  sleeperId: string | null;
  round: number | null;
}

export type ListLeaguesResult =
  | { ok: true; handle: SavedSleeperHandle; leagues: ImportLeague[] }
  | { ok: false; error: string; needsUsername?: boolean };

export type ListTradesResult =
  | { ok: true; trades: ImportTrade[] }
  | { ok: false; error: string };

export type ImportAnalyzeResult =
  | {
      ok: true;
      view: BuilderView;
      assetMeta: Record<SideKey, ImportAssetMeta[]>;
      evidence: string[];
      notices: string[];
      shareUrl: string | null;
    }
  | { ok: false; error: string };

type ImportIdentity = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  /** The FF Beacon account. A frozen analysis belongs to it, not to the handle. */
  userId: string;
  handle: SavedSleeperHandle;
};

/**
 * The signed-in reader and the Sleeper handle they saved, or null.
 *
 * The handle comes from `lib/sleeper-handle/resolve.ts`, which is the one
 * module allowed to read it (D1). This panel has no `?username=` path, so the
 * saved handle is the only identity it ever acts for.
 */
async function savedIdentity(): Promise<ImportIdentity | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const handle = await loadSavedSleeperHandle(supabase);
  if (!handle) return null;
  return { supabase, userId: user.id, handle };
}

/**
 * The reader's Sleeper user id, without a `getSleeperUser` call in the common
 * case (D3). A handle saved before migration 0268 carries no id, so it is
 * resolved once and written back; every visit after that costs nothing.
 *
 * Null means Sleeper could not resolve the saved handle right now, which is a
 * different answer from "that league is not yours" and is reported as one.
 */
async function sleeperUserIdFor(identity: ImportIdentity): Promise<string | null> {
  if (identity.handle.sleeperUserId) return identity.handle.sleeperUserId;
  const filled = await ensureSleeperUserId(identity.supabase, identity.handle);
  return filled.sleeperUserId;
}

/**
 * List the leagues attached to the signed-in user's saved Sleeper username for
 * the current season. Data comes from Sleeper's public API; this associates
 * imports with the user's saved identity but does not prove account ownership.
 */
export async function listImportLeagues(): Promise<ListLeaguesResult> {
  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  if (!settings.enabled || !settings.sleeperImportsEnabled) {
    return { ok: false, error: "Sleeper imports are currently unavailable." };
  }
  const id = await savedIdentity();
  if (!id) {
    return {
      ok: false,
      needsUsername: true,
      error: "Save your Sleeper username first to import a trade.",
    };
  }
  const sleeperUserId = await sleeperUserIdFor(id);
  if (!sleeperUserId) {
    return { ok: false, error: `No Sleeper user found for "${id.handle.username}".` };
  }
  const season = currentNflSeason();
  const leagues = await getSleeperLeagues(sleeperUserId, season);
  return {
    ok: true,
    // The whole identity, so the panel's card can show the reader's Sleeper
    // avatar and display name without a second call.
    handle: { ...id.handle, sleeperUserId },
    leagues: leagues.map((l) => ({
      sleeperLeagueId: l.league_id,
      name: l.name ?? "League",
      season: l.season ?? season,
      avatar: l.avatar ?? null,
    })),
  };
}

async function userOwnsLeague(
  sleeperUserId: string,
  sleeperLeagueId: string,
): Promise<boolean> {
  const leagues = await getSleeperLeagues(sleeperUserId, currentNflSeason());
  return leagues.some((l) => l.league_id === sleeperLeagueId);
}

function rosterLabelMap(
  rosters: { sleeper_roster_id: number; owner_user_id: string | null }[],
  users: { sleeper_user_id: string; display_name: string | null; team_name: string | null }[],
): Map<number, string> {
  const userById = new Map(users.map((u) => [u.sleeper_user_id, u]));
  const map = new Map<number, string>();
  for (const r of rosters) {
    const u = r.owner_user_id ? userById.get(r.owner_user_id) : null;
    map.set(
      r.sleeper_roster_id,
      formatTeamLabel({
        teamName: u?.team_name,
        username: u?.display_name,
        sleeperRosterId: r.sleeper_roster_id,
      }),
    );
  }
  return map;
}

/** Distinct receiving roster ids from a trade's adds + normalized picks. */
function tradeRosters(adds: Record<string, number> | null, picks: unknown[]): number[] {
  const set = new Set<number>();
  for (const rid of Object.values(adds ?? {})) set.add(Number(rid));
  for (const p of picks) {
    const owner = (p as { owner_id?: unknown }).owner_id;
    if (owner != null) set.add(Number(owner));
  }
  return Array.from(set).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
}

const IMPORT_RATE_WINDOW_SECONDS = 60;
const IMPORT_TRADES_MAX = 12;
const IMPORT_ANALYZE_MAX = 8;

/**
 * Fails closed. A limit we cannot evaluate is not a limit that passes.
 *
 * WHY THIS EXISTS ON A SIGNED-IN-ONLY ACTION. `userOwnsLeague` reads the
 * reader's Sleeper user id out of `user_preferences.sleeper_league_settings`,
 * and `authenticated` holds a column grant on that jsonb because it has to own
 * its own preferences. So the id is SELF-ASSERTED: a reader can PATCH it
 * through PostgREST and the ownership check then agrees with them. Nothing
 * confidential is behind it (league transactions are public-read under RLS and
 * already rendered at /leagues/[id]/transactions), so what an attacker gains
 * is not data but COMPUTE: `pulseLeague` on an arbitrary league id, repeatedly.
 * The meter is the guard that actually holds, so the meter is the one that has
 * to be here.
 */
async function claimImportSlot(bucket: string, max: number): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/signal-check-import", {
        headers: requestHeaders,
      }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: bucket,
      p_key: actorKey,
      p_max_requests: max,
      p_window_seconds: IMPORT_RATE_WINDOW_SECONDS,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[signal-check-import] rate-limit check failed", err);
    return false;
  }
}

export async function listLeagueTrades(sleeperLeagueId: string): Promise<ListTradesResult> {
  if (!/^[0-9]{1,32}$/.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id." };
  }
  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  if (!settings.enabled || !settings.sleeperImportsEnabled) {
    return { ok: false, error: "Sleeper imports are currently unavailable." };
  }
  const id = await savedIdentity();
  if (!id) return { ok: false, error: "Sign in and save your Sleeper username first." };
  const sleeperUserId = await sleeperUserIdFor(id);
  if (!sleeperUserId) {
    return { ok: false, error: `No Sleeper user found for "${id.handle.username}".` };
  }
  if (!(await userOwnsLeague(sleeperUserId, sleeperLeagueId))) {
    return { ok: false, error: "That league is not linked to your Sleeper account." };
  }

  // After the cheap checks, before pulseLeague, which is the expensive half.
  if (!(await claimImportSlot("signal_check_import_trades", IMPORT_TRADES_MAX))) {
    return { ok: false, error: "Slow down a moment and try that again." };
  }

  const pulse = await pulseLeague(admin, sleeperLeagueId);
  if (!pulse.ok) return { ok: false, error: "Could not load that league from Sleeper." };

  const [{ data: txRows }, { data: rosters }, { data: users }] = await Promise.all([
    admin
      .from("league_transactions")
      .select("sleeper_transaction_id, week, adds, draft_picks")
      .eq("league_id", pulse.leagueRowId)
      .eq("type", "trade")
      .order("created_at_sleeper", { ascending: false }),
    admin.from("rosters").select("sleeper_roster_id, owner_user_id").eq("league_id", pulse.leagueRowId),
    admin
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name")
      .eq("league_id", pulse.leagueRowId),
  ]);

  const labels = rosterLabelMap(rosters ?? [], users ?? []);
  const trades: ImportTrade[] = (txRows ?? []).map((t) => {
    const picks = normalizeDraftPicks(t.draft_picks);
    const adds = (t.adds as Record<string, number> | null) ?? {};
    const involved = tradeRosters(adds, picks);
    const teams: ImportTradeTeam[] = involved.map((rid) => ({
      rosterId: rid,
      teamName: labels.get(rid) ?? `Team ${rid}`,
      playerCount: Object.values(adds).filter((r) => Number(r) === rid).length,
      pickCount: picks.filter((p) => Number((p as { owner_id?: unknown }).owner_id) === rid).length,
    }));
    const weekLabel = t.week != null ? `Week ${t.week}: ` : "";
    return {
      sleeperTransactionId: t.sleeper_transaction_id,
      week: t.week ?? null,
      teams,
      label: `${weekLabel}${teams.map((x) => x.teamName).join(" and ") || "Trade"}`,
    };
  });

  return { ok: true, trades };
}

function buildEvidence(league: SleeperLeague): string[] {
  const scoring = league.scoring_settings ?? {};
  const positions = league.roster_positions ?? [];
  const derived = deriveLeagueFormat(league);
  const lines: string[] = [];
  lines.push(`Detected: ${derived.league_type} ${derived.scoring_type}${derived.is_superflex ? " superflex" : ""}${derived.is_tep ? " TEP" : ""}`);
  if (positions.includes("SUPER_FLEX")) lines.push("roster_positions includes SUPER_FLEX");
  const qb = positions.filter((p) => p === "QB").length;
  if (qb >= 2) lines.push(`${qb} QB starting slots`);
  if (scoring.rec != null) lines.push(`scoring_settings.rec = ${scoring.rec}`);
  if (scoring.bonus_rec_te != null) lines.push(`scoring_settings.bonus_rec_te = ${scoring.bonus_rec_te}`);
  if (Number(league.settings?.type ?? 0) === 2) lines.push("settings.type = 2 (dynasty)");
  return lines;
}

async function mapSleeperPlayers(
  admin: ReturnType<typeof createAdminClient>,
  sleeperIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const numeric = Array.from(new Set(sleeperIds.filter((id) => /^\d+$/.test(id))));
  for (let i = 0; i < numeric.length; i += 200) {
    const chunk = numeric.slice(i, i + 200);
    const ors = chunk.map((id) => `external_ids->>sleeper.eq.${id}`).join(",");
    const { data } = await admin.from("players").select("id, external_ids").or(ors);
    for (const row of data ?? []) {
      const ext = row.external_ids as Record<string, unknown> | null;
      const sid = ext?.sleeper;
      if (typeof sid === "string" || typeof sid === "number") map.set(String(sid), row.id);
    }
  }
  return map;
}

export async function importAndAnalyze(args: {
  sleeperLeagueId: string;
  sleeperTransactionId: string;
  makePublic?: boolean;
}): Promise<ImportAnalyzeResult> {
  const { sleeperLeagueId, sleeperTransactionId } = args;
  if (!/^[0-9]{1,32}$/.test(sleeperLeagueId) || !/^[0-9]{1,32}$/.test(sleeperTransactionId)) {
    return { ok: false, error: "Invalid league or trade id." };
  }

  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  if (!settings.enabled || !settings.sleeperImportsEnabled) {
    return { ok: false, error: "Sleeper imports are currently unavailable." };
  }

  const id = await savedIdentity();
  if (!id) return { ok: false, error: "Sign in and save your Sleeper username first." };
  const sleeperUserId = await sleeperUserIdFor(id);
  if (!sleeperUserId) {
    return { ok: false, error: `No Sleeper user found for "${id.handle.username}".` };
  }
  if (!(await userOwnsLeague(sleeperUserId, sleeperLeagueId))) {
    return { ok: false, error: "That league is not linked to your Sleeper account." };
  }

  // Same reasoning as listLeagueTrades: the ownership check above rests on a
  // self-asserted id, so the meter is the guard that actually holds. Lower
  // than the trade list's, because this one also runs a full analysis.
  if (!(await claimImportSlot("signal_check_import_analyze", IMPORT_ANALYZE_MAX))) {
    return { ok: false, error: "Slow down a moment and try that again." };
  }

  const pulse = await pulseLeague(admin, sleeperLeagueId);
  if (!pulse.ok) return { ok: false, error: "Could not load that league from Sleeper." };

  const { data: league } = await admin
    .from("leagues")
    .select("id, name, season, metadata")
    .eq("id", pulse.leagueRowId)
    .maybeSingle();
  if (!league) return { ok: false, error: "League not found." };

  const { data: tx } = await admin
    .from("league_transactions")
    .select("sleeper_transaction_id, type, adds, draft_picks")
    .eq("league_id", pulse.leagueRowId)
    .eq("sleeper_transaction_id", sleeperTransactionId)
    .maybeSingle();
  if (!tx || tx.type !== "trade") return { ok: false, error: "That trade could not be found." };

  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const derived = deriveLeagueFormat(sleeperLeague);
  const notices: string[] = [];

  // Resolve the league's format. Prefer the exact derived format; if FF Beacon
  // does not publish values for it yet, fall back to the closest SUPPORTED
  // format (never crossing redraft/dynasty) and note that values may differ,
  // rather than dead-ending the user with a denial.
  const exactSlug = mapToFormatSlug(derived);
  let format = exactSlug ? await resolveFormat(admin, exactSlug) : null;
  if (!format) {
    const candidates = await supportedFormatCandidates(admin, settings);
    const closest = pickClosestSupportedFormat(derived, candidates);
    format = closest ? await resolveFormat(admin, closest.slug) : null;
    if (format) {
      notices.push(
        `Heads up: your league looks like ${describeDerivedFormat(derived)}, which FF Beacon does not have its own values for yet. We used the closest format we do support, ${format.display}, so a few values may be slightly off. We are actively building out more formats.`,
      );
    }
  }
  if (!format) {
    return {
      ok: false,
      error: "FF Beacon does not publish values for this league's format yet.",
    };
  }

  const adds = (tx.adds as Record<string, number> | null) ?? {};
  const picks = normalizeDraftPicks(tx.draft_picks);
  const rosters = tradeRosters(adds, picks);
  if (rosters.length !== 2) {
    return { ok: false, error: "Signal Check can analyze two-team trades. This trade involves a different number of teams." };
  }
  const [rosterA, rosterB] = rosters;

  // Map sleeper player ids -> FF Beacon player ids. Block on any unmatched
  // player so we never produce a misleading verdict.
  const sleeperIds = Object.keys(adds);
  const playerMap = await mapSleeperPlayers(admin, sleeperIds);
  const unmatched = sleeperIds.filter((sid) => !playerMap.has(sid));
  if (unmatched.length > 0) {
    return {
      ok: false,
      error: `Could not match ${unmatched.length} traded player${unmatched.length === 1 ? "" : "s"} to FF Beacon, so this trade cannot be analyzed accurately.`,
    };
  }

  const sideAssets: Record<SideKey, AnalysisInput["sides"]["a"]> = { a: [], b: [] };
  // Built in lockstep with sideAssets so the result can render headshots.
  const assetMeta: Record<SideKey, ImportAssetMeta[]> = { a: [], b: [] };
  const rosterToSide = (rid: number): SideKey => (rid === rosterA ? "a" : "b");

  for (const [sid, rid] of Object.entries(adds)) {
    const playerId = playerMap.get(sid)!;
    const side = rosterToSide(Number(rid));
    sideAssets[side].push({ kind: "player", playerId });
    assetMeta[side].push({ kind: "player", sleeperId: sid, round: null });
  }

  if (format.allowsPicks) {
    const pickPositions = await buildPickPositionResolver(admin, league.id);
    for (const p of picks) {
      const pick = p as {
        season?: unknown;
        round?: unknown;
        owner_id?: unknown;
        roster_id?: unknown;
      };
      const season = Number(pick.season);
      const round = Number(pick.round);
      const owner = Number(pick.owner_id);
      if (!Number.isFinite(season) || !Number.isFinite(round) || !Number.isFinite(owner)) continue;
      if (owner !== rosterA && owner !== rosterB) continue;
      const side = rosterToSide(owner);
      // Sleeper never sends the position in the round, so we take it from the
      // published draft order when one exists, and otherwise from the projected
      // finish of the pick's ORIGINAL team (roster_id, often a third team).
      // Failing both, the engine falls back to the season+round blend.
      const origin = Number(pick.roster_id);
      const placed = Number.isFinite(origin) ? pickPositions.resolve(origin, season) : null;
      sideAssets[side].push(
        placed
          ? {
              kind: "pick",
              season,
              round,
              pickPosition: placed.position,
              slotEstimated: placed.estimated,
            }
          : { kind: "pick", season, round },
      );
      assetMeta[side].push({ kind: "pick", sleeperId: null, round });
    }
  } else if (picks.length > 0) {
    notices.push("Draft picks were excluded because this is a redraft format.");
  }

  const input: AnalysisInput = { formatSlug: format.slug, sides: sideAssets };

  const [{ data: rosterRows }, { data: userRows }] = await Promise.all([
    admin.from("rosters").select("sleeper_roster_id, owner_user_id").eq("league_id", league.id),
    admin.from("league_users").select("sleeper_user_id, display_name, team_name").eq("league_id", league.id),
  ]);
  const labels = rosterLabelMap(rosterRows ?? [], userRows ?? []);
  const teamLabels: Partial<Record<SideKey, string | null>> = {
    a: labels.get(rosterA) ?? null,
    b: labels.get(rosterB) ?? null,
  };

  try {
    const built = await buildValueResolver(admin, format, input);
    const ruleset = await loadActiveRuleset(admin);
    const analysis = runPipeline({
      input,
      resolver: built.resolver,
      format,
      source: built.source,
      settings,
      rules: ruleset.rules,
      rulesetVersion: ruleset.version,
      formatAutoDetected: true,
      poolMax: built.poolMax,
    });
    const view = toBuilderView(analysis, settings, teamLabels);
    const evidence = buildEvidence(sleeperLeague);

    let shareUrl: string | null = null;
    if (args.makePublic && settings.shareLinksEnabled) {
      const shareId = crypto.randomUUID();
      const row = freezeAnalysis({
        analysis,
        input,
        settings,
        shareId,
        userId: id.userId,
        isPublic: true,
        createdAtIso: new Date().toISOString(),
        teamLabels,
        // Private import context: never copied into public_payload.
        sleeperContext: { sleeperLeagueId, sleeperTransactionId, rosterIds: rosters },
        formatDetectionEvidence: { lines: evidence, derived },
      });
      const { error } = await admin
        .from("signal_check_analyses")
        .insert(row as unknown as AnalysisInsert);
      if (error) console.error("[signal-check import] save failed", error);
      else shareUrl = `${SITE.url}/tools/signal-check/v/${shareId}`;
    }

    return { ok: true, view, assetMeta, evidence, notices, shareUrl };
  } catch (err) {
    if (err instanceof SignalCheckError) return { ok: false, error: err.message };
    console.error("[signal-check import] failed", err);
    return { ok: false, error: "Something went wrong analyzing that trade." };
  }
}
