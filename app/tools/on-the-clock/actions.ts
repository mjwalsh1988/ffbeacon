"use server";

/**
 * Run a draft-room trade through Signal Check.
 *
 * The cockpit already totals both sides off the board the instant an asset is
 * added, which is fast and is not a grade. This action produces the real thing:
 * the same pipeline /tools/signal-check runs, with the calibration rules, the
 * consolidation and value-adjustment pass, the verdict thresholds, confidence,
 * and the written explanation.
 *
 * WHAT IS AND IS NOT TRUSTED FROM THE CLIENT
 * The client sends asset references only: FF Beacon player ids and pick
 * descriptors. It does NOT send values, totals, or a format. The format is
 * derived server-side from the cached Sleeper league, which is the same contract
 * the rest of On The Clock follows: inside a league view the format comes from
 * the league, never from the request. A caller can therefore ask us to price any
 * public player, which is exactly what the public Signal Check builder already
 * allows, and can assert nothing.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { runSignalCheck, type RunSignalCheckResult } from "@/app/tools/signal-check/actions";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { readDraftCache } from "@/lib/on-the-clock/cache";
import { detectLeagueFormat, ffbeaconFormatCandidates } from "@/lib/on-the-clock/format-detect";
import type { SleeperLeague } from "@/lib/sleeper";

const DRAFT_ID_RE = /^[0-9]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKETS = new Set(["early", "mid", "late"]);

/** Matches the public builder's own ceiling; the pipeline enforces it again. */
const MAX_ASSETS_PER_SIDE = 12;

export type DraftTradeAssetInput =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; season: number; round: number; pickPosition: "early" | "mid" | "late" };

export interface AnalyzeDraftTradeInput {
  draftId: string;
  sides: { a: DraftTradeAssetInput[]; b: DraftTradeAssetInput[] };
}

function sanitizeSide(raw: unknown): DraftTradeAssetInput[] {
  if (!Array.isArray(raw)) return [];
  // Same reasoning as the pulse route: refuse an absurd array instead of
  // validating every entry of it.
  if (raw.length > MAX_ASSETS_PER_SIDE * 4) return [];
  const out: DraftTradeAssetInput[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ASSETS_PER_SIDE) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.kind === "player" && typeof o.playerId === "string" && UUID_RE.test(o.playerId)) {
      out.push({ kind: "player", playerId: o.playerId });
      continue;
    }
    if (o.kind === "pick") {
      const season = Number(o.season);
      const round = Number(o.round);
      const bucket = typeof o.pickPosition === "string" ? o.pickPosition : "";
      if (
        Number.isInteger(season) &&
        season >= 2000 &&
        season <= 2100 &&
        Number.isInteger(round) &&
        round >= 1 &&
        round <= 10 &&
        BUCKETS.has(bucket)
      ) {
        out.push({
          kind: "pick",
          season,
          round,
          pickPosition: bucket as "early" | "mid" | "late",
        });
      }
    }
  }
  return out;
}

/**
 * Resolve the FF Beacon format for a draft from the cached Sleeper league. Falls
 * back to the admin default only when the league object was never captured,
 * which is the same fallback the room's own board load uses.
 */
async function resolveDraftFormat(draftId: string): Promise<string | null> {
  const admin = createAdminClient();
  const cache = await readDraftCache(admin, draftId);
  if (!cache) return null;

  // Rebuild the minimal SleeperLeague shape the detector reads. The cache holds
  // the whole raw league object; this is the whitelisted view of it.
  const league = {
    league_id: cache.draft.sleeperLeagueId,
    name: "",
    season: cache.draft.season,
    sport: "nfl",
    status: cache.draft.draftStatus ?? "",
    total_rosters: cache.rosters.length,
    scoring_settings: cache.draft.scoringSettings,
    roster_positions: cache.draft.rosterPositions,
  } as SleeperLeague;

  if (cache.draft.rosterPositions.length === 0) {
    const settings = await loadOnTheClockSettings(admin);
    return settings.sourceFormat.defaultFormatFallback;
  }

  const candidates = await ffbeaconFormatCandidates(admin);
  const detected = detectLeagueFormat(league, candidates);
  if (detected) return detected.slug;
  const settings = await loadOnTheClockSettings(admin);
  return settings.sourceFormat.defaultFormatFallback;
}

export async function analyzeDraftTrade(raw: unknown): Promise<RunSignalCheckResult> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "That trade could not be read. Please rebuild it and try again." };
  }
  const input = raw as Record<string, unknown>;
  const draftId = typeof input.draftId === "string" ? input.draftId : "";
  if (!DRAFT_ID_RE.test(draftId)) {
    return { ok: false, error: "That draft could not be found." };
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return { ok: false, error: "On The Clock is not available yet." };
  }

  const sidesRaw = (input.sides ?? {}) as Record<string, unknown>;
  const a = sanitizeSide(sidesRaw.a);
  const b = sanitizeSide(sidesRaw.b);
  if (a.length === 0 && b.length === 0) {
    return { ok: false, error: "Add at least one asset to analyze a trade." };
  }

  const formatSlug = await resolveDraftFormat(draftId);
  if (!formatSlug) {
    return { ok: false, error: "That draft has not been synced yet." };
  }

  // Straight through the public pipeline. Not saved: a draft-room what-if is a
  // scratchpad, and writing a row for every hypothetical would fill the table
  // with trades nobody made. Sharing goes through the builder as it always has.
  return runSignalCheck({ formatSlug, sides: { a, b } }, { save: false });
}
