/**
 * Capture completed Sleeper league drafts into the pick ledger.
 *
 * League Pulse has always synced `league_drafts`, which stores a draft's SETTINGS
 * and never stored a single pick. On 2026-08-12 that meant 99 completed drafts,
 * roughly eighteen thousand picks, existed on Sleeper with our permission to read
 * them and were being discarded on every pulse. This closes that.
 *
 * THE FETCH POLICY IS THE WHOLE DESIGN.
 * A completed draft never changes again, so its picks are worth exactly one
 * Sleeper request, ever. Three gates enforce that:
 *
 *   1. Only drafts whose status is 'complete'. An in-progress draft is the live
 *      room's job (On The Clock), not this one, and half a draft would poison an
 *      ADP with picks that have not happened yet.
 *   2. Only drafts with no ledger rows yet, checked in ONE query before any
 *      fetching starts.
 *   3. A hard per-run cap. A user importing a decade-old dynasty league can have
 *      a dozen completed drafts; capturing five per pulse spreads that across a
 *      few visits instead of fanning out twelve simultaneous Sleeper requests
 *      the first time anyone opens the league.
 *
 * Everything here is non-fatal. It runs inside pulseLeagueDerived, the half that
 * streams in behind the page, and a failure leaves the ledger to try again on the
 * next resync.
 *
 * No `import "server-only"` guard, for the same reason as lib/draft-selections.ts
 * and lib/league-pulse.ts: this reaches tsx scripts through pulseLeagueDerived,
 * where that specifier does not resolve. draft_selections has no anon or
 * authenticated policy, so the table is the guard.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSleeperDraftPicksOrNull, type SleeperLeague } from "@/lib/sleeper";
import { recordDraftSelections, draftIdsWithSelections } from "@/lib/draft-selections";
import { ffbeaconFormatCandidates, detectLeagueFormat } from "@/lib/on-the-clock/format-detect";
import { inferPlayerPool } from "@/lib/on-the-clock/draft-derive";

type ServiceClient = SupabaseClient<Database>;

/**
 * Completed drafts captured per pulse. Deliberately small: this is background
 * work behind a page that is already rendering, and the remainder is picked up
 * on the next resync of the same league.
 */
export const MAX_DRAFTS_CAPTURED_PER_RUN = 5;

/**
 * Failed fetches before a draft is left alone. A permanently unreachable draft
 * would otherwise consume a slot of the per-run budget on every resync, forever,
 * ahead of drafts that would actually succeed.
 */
export const MAX_CAPTURE_ATTEMPTS = 3;

/** Pause between Sleeper draft-pick requests so a multi-draft league stays polite. */
const FETCH_SPACING_MS = 250;

export interface CaptureDraftSelectionsResult {
  draftsConsidered: number;
  draftsCaptured: number;
  picksWritten: number;
  /** How many draft-pick requests failed (the REQUEST failed, not "no picks"). */
  fetchFailures: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rebuild enough of a Sleeper league object for format derivation. `leagues`
 * stores `scoring_settings` and `roster_positions` as their own columns plus the
 * raw object in `metadata`, and deriveLeagueFormat reads exactly those three
 * things (scoring_settings, roster_positions, settings.type).
 */
function leagueShapeFromRow(row: {
  scoring_settings: unknown;
  roster_positions: unknown;
  metadata: unknown;
}): SleeperLeague | null {
  const meta = (row.metadata ?? null) as Record<string, unknown> | null;
  const scoring = (row.scoring_settings ?? meta?.scoring_settings ?? null) as Record<
    string,
    number
  > | null;
  const positions = (row.roster_positions ?? meta?.roster_positions ?? null) as string[] | null;
  // settings.type is the ONLY dynasty signal deriveLeagueFormat trusts, so a row
  // with no stored raw league cannot be classified and must not be guessed at.
  const settings = (meta?.settings ?? null) as Record<string, number> | null;
  if (!scoring || !positions || !settings) return null;
  return {
    scoring_settings: scoring,
    roster_positions: positions,
    settings,
  } as unknown as SleeperLeague;
}

/**
 * Fetch and store picks for this league's completed drafts that we have not
 * captured yet. Never throws.
 */
export async function captureLeagueDraftSelections(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<CaptureDraftSelectionsResult> {
  const empty: CaptureDraftSelectionsResult = {
    draftsConsidered: 0,
    draftsCaptured: 0,
    picksWritten: 0,
    fetchFailures: 0,
  };

  try {
    const { data: league } = await supabase
      .from("leagues")
      .select("id, sleeper_league_id, scoring_settings, roster_positions, metadata")
      .eq("id", leagueRowId)
      .maybeSingle();
    if (!league) return empty;

    const { data: drafts } = await supabase
      .from("league_drafts")
      .select(
        "sleeper_draft_id, season, status, type, settings, start_time, picks_captured_at, pick_capture_attempts",
      )
      .eq("league_id", leagueRowId)
      .eq("status", "complete")
      // A draft Sleeper has already answered about definitively is never asked
      // about again, whatever that answer was.
      .is("picks_captured_at", null)
      .lt("pick_capture_attempts", MAX_CAPTURE_ATTEMPTS)
      .order("season", { ascending: false });

    const completed = drafts ?? [];
    if (completed.length === 0) return empty;

    const alreadyCaptured = await draftIdsWithSelections(
      supabase,
      completed.map((d) => d.sleeper_draft_id),
    );
    const pending = completed
      .filter((d) => !alreadyCaptured.has(d.sleeper_draft_id))
      .slice(0, MAX_DRAFTS_CAPTURED_PER_RUN);

    if (pending.length === 0) {
      return { ...empty, draftsConsidered: completed.length };
    }

    // Format is a property of the LEAGUE, not of each draft, so it is resolved
    // once for the whole batch.
    const shape = leagueShapeFromRow(league);
    const candidates = shape ? await ffbeaconFormatCandidates(supabase) : [];
    const detected = shape ? detectLeagueFormat(shape, candidates) : null;

    let draftsCaptured = 0;
    let picksWritten = 0;
    let fetchFailures = 0;

    for (const [index, draft] of pending.entries()) {
      if (index > 0) await sleep(FETCH_SPACING_MS);

      const picks = await getSleeperDraftPicksOrNull(draft.sleeper_draft_id);

      // null means the REQUEST failed and we know nothing; [] means Sleeper
      // answered and this draft genuinely has no picks (a reset or abandoned
      // draft). Both write no rows, and the first version treated them the same
      // by simply moving on, which left an uncapturable draft classified as
      // pending forever. It also burned a slot of the per-run budget ahead of
      // drafts that would have succeeded.
      if (picks === null) {
        fetchFailures += 1;
        await supabase
          .from("league_drafts")
          .update({ pick_capture_attempts: (draft.pick_capture_attempts ?? 0) + 1 })
          .eq("sleeper_draft_id", draft.sleeper_draft_id);
        continue;
      }
      if (picks.length === 0) {
        // A definitive answer. A completed draft with no picks will never have
        // any, so stop asking.
        await supabase
          .from("league_drafts")
          .update({ picks_captured_at: new Date().toISOString() })
          .eq("sleeper_draft_id", draft.sleeper_draft_id);
        continue;
      }

      const settings = (draft.settings ?? {}) as Record<string, unknown>;
      const rounds = Number(settings.rounds ?? 0);
      const teams = Number(settings.teams ?? 0);

      const result = await recordDraftSelections(supabase, picks, {
        sleeperDraftId: draft.sleeper_draft_id,
        sleeperLeagueId: league.sleeper_league_id,
        season: draft.season,
        draftType: draft.type,
        draftStatus: draft.status,
        formatSlug: detected?.slug ?? null,
        playerPool: detected ? inferPlayerPool({ formatSlug: detected.slug, rounds }) : null,
        teams: Number.isFinite(teams) && teams > 0 ? teams : null,
        rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : null,
        // league_drafts.start_time is already a timestamptz, so it arrives as an
        // ISO string. No epoch conversion here, unlike the On The Clock path,
        // which reads Sleeper's raw epoch-milliseconds field.
        draftedAt: draft.start_time,
        ingestSource: "league_pulse",
      });

      if (result.ok && result.rowsWritten > 0) {
        draftsCaptured += 1;
        picksWritten += result.rowsWritten;
        await supabase
          .from("league_drafts")
          .update({ picks_captured_at: new Date().toISOString() })
          .eq("sleeper_draft_id", draft.sleeper_draft_id);
      } else if (!result.ok) {
        await supabase
          .from("league_drafts")
          .update({ pick_capture_attempts: (draft.pick_capture_attempts ?? 0) + 1 })
          .eq("sleeper_draft_id", draft.sleeper_draft_id);
      }
    }

    return { draftsConsidered: completed.length, draftsCaptured, picksWritten, fetchFailures };
  } catch (err) {
    console.warn(
      `[league-draft-selections] capture failed for league ${leagueRowId}:`,
      (err as Error).message,
    );
    return empty;
  }
}
