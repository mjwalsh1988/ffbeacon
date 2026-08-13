/**
 * One-time backfill of the draft pick ledger (draft_selections).
 *
 * Run: npm run backfill:draft-selections
 *      npm run backfill:draft-selections -- --skip-sleeper   (pass A only)
 *
 * NEVER WIRE THIS INTO A CRON. Both sync paths keep the ledger current from here
 * on (lib/on-the-clock/sleeper-sync.ts and lib/league-draft-selections.ts). This
 * script exists to recover what those paths were discarding before they existed.
 *
 * PASS A: on_the_clock_pick_cache -> ledger.
 *   No Sleeper traffic at all. The picks are already stored and their player ids
 *   are already resolved, so the id map is built FROM THE CACHE ROWS rather than
 *   re-queried, and a draft's context is read from on_the_clock_draft_cache.
 *
 * PASS B: Sleeper -> ledger, for completed league_drafts with no rows yet.
 *   This is the one that matters. On 2026-08-12 there were 99 completed drafts
 *   whose picks existed nowhere in our database. Drafts are grouped by league so
 *   the format is derived once per league, and requests are spaced out.
 *
 * Idempotent through the (sleeper_draft_id, pick_no) unique constraint, so a
 * re-run is safe and simply rewrites the same rows.
 */

import { getServiceClient, withRetry } from "./_supabase";
import {
  recordDraftSelections,
  shapeDraftSelections,
  draftIdsWithSelections,
  type DraftSelectionContext,
  type RawDraftPick,
} from "../lib/draft-selections";
import { getSleeperDraftPicksOrNull, type SleeperLeague } from "../lib/sleeper";
import {
  ffbeaconFormatCandidates,
  detectLeagueFormat,
} from "../lib/on-the-clock/format-detect";
import { inferPlayerPool } from "../lib/on-the-clock/draft-derive";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

type Client = SupabaseClient<Database>;
type FormatCandidates = Awaited<ReturnType<typeof ffbeaconFormatCandidates>>;

const PAGE = 1000;
const UPSERT_CHUNK = 500;
const SLEEPER_SPACING_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function epochMsToIso(value: unknown): string | null {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Coerce a stored raw Sleeper league object into the shape deriveLeagueFormat
 * reads. Returns null when any of the three signals is missing, because a guess
 * here would misclassify a whole draft's worth of picks.
 */
function leagueShape(raw: unknown): SleeperLeague | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (!l.scoring_settings || !l.roster_positions || !l.settings) return null;
  return l as unknown as SleeperLeague;
}

// ---------------------------------------------------------------------------
// Pass A: the On The Clock pick cache
// ---------------------------------------------------------------------------

async function passOnTheClock(supabase: Client, candidates: FormatCandidates) {
  const { data: drafts, error: draftErr } = await supabase
    .from("on_the_clock_draft_cache")
    .select(
      "sleeper_draft_id, sleeper_league_id, season, draft_status, draft_type, metadata, league_metadata",
    );
  if (draftErr) throw new Error(`draft cache read failed: ${draftErr.message}`);

  const byDraft = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts ?? []) byDraft.set(d.sleeper_draft_id, d);

  // on_the_clock_draft_cache.league_metadata only arrived in migration 0180, so
  // every draft cached before that has a null and cannot be classified from its
  // own row. Most of those leagues have ALSO been through League Pulse, which
  // stores the same scoring and roster shape, so `leagues` is the fallback. On
  // the first run this recovered 24 of the 34 otherwise-unclassifiable drafts.
  const leagueIds = [...new Set((drafts ?? []).map((d) => d.sleeper_league_id).filter(Boolean))];
  const leagueBySleeperId = new Map<string, SleeperLeague>();
  for (let i = 0; i < leagueIds.length; i += 200) {
    const chunk = leagueIds.slice(i, i + 200);
    const { data } = await supabase
      .from("leagues")
      .select("sleeper_league_id, scoring_settings, roster_positions, metadata")
      .in("sleeper_league_id", chunk);
    for (const row of data ?? []) {
      const shape = leagueShape({
        ...((row.metadata ?? {}) as Record<string, unknown>),
        ...(row.scoring_settings ? { scoring_settings: row.scoring_settings } : {}),
        ...(row.roster_positions ? { roster_positions: row.roster_positions } : {}),
      });
      if (shape) leagueBySleeperId.set(row.sleeper_league_id, shape);
    }
  }

  // Page the pick cache: PostgREST truncates a bare select at 1000 rows and
  // there are thousands here.
  const picks: Database["public"]["Tables"]["on_the_clock_pick_cache"]["Row"][] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("on_the_clock_pick_cache")
      .select("*")
      .order("sleeper_draft_id", { ascending: true })
      .order("pick_no", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`pick cache read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    picks.push(...data);
    if (data.length < PAGE) break;
  }

  const picksByDraft = new Map<string, typeof picks>();
  for (const p of picks) {
    const list = picksByDraft.get(p.sleeper_draft_id);
    if (list) list.push(p);
    else picksByDraft.set(p.sleeper_draft_id, [p]);
  }

  let draftsWritten = 0;
  let rowsWritten = 0;
  let unclassified = 0;

  for (const [draftId, draftPicks] of picksByDraft) {
    const draft = byDraft.get(draftId);
    if (!draft) continue; // orphan picks: no context to attach, skip

    const meta = (draft.metadata ?? {}) as Record<string, unknown>;
    const settings = (meta.settings ?? {}) as Record<string, unknown>;
    const shape =
      leagueShape(draft.league_metadata) ??
      (draft.sleeper_league_id ? (leagueBySleeperId.get(draft.sleeper_league_id) ?? null) : null);
    const detected = shape ? detectLeagueFormat(shape, candidates) : null;
    if (!detected) unclassified += 1;

    const rounds = Number(settings.rounds ?? 0);
    const season = intOrNull(draft.season);
    if (season === null) continue;

    const ctx: DraftSelectionContext = {
      sleeperDraftId: draftId,
      sleeperLeagueId: draft.sleeper_league_id,
      season,
      draftType: draft.draft_type,
      draftStatus: draft.draft_status,
      formatSlug: detected?.slug ?? null,
      playerPool: detected ? inferPlayerPool({ formatSlug: detected.slug, rounds }) : null,
      teams: intOrNull(settings.teams),
      rounds: intOrNull(settings.rounds),
      draftedAt: epochMsToIso(meta.start_time),
      ingestSource: "backfill",
    };

    // The cache already resolved every player id at sync time, so the map comes
    // from the rows themselves. No player lookup, no Sleeper call.
    const idMap = new Map<string, string>();
    for (const p of draftPicks) {
      if (p.sleeper_player_id && p.player_id) idMap.set(p.sleeper_player_id, p.player_id);
    }

    const raw: RawDraftPick[] = draftPicks.map((p) => ({
      pick_no: p.pick_no,
      round: p.round,
      draft_slot: p.draft_slot,
      roster_id: p.roster_id,
      picked_by: p.picked_by,
      player_id: p.sleeper_player_id,
      is_keeper: p.is_keeper,
      metadata: p.metadata,
    }));

    const rows = shapeDraftSelections(raw, ctx, idMap);
    if (rows.length === 0) continue;

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("draft_selections")
            .upsert(chunk, { onConflict: "sleeper_draft_id,pick_no" });
          if (error) throw error;
        },
        { label: `draft_selections upsert (${draftId})` },
      );
    }

    draftsWritten += 1;
    rowsWritten += rows.length;
  }

  return { draftsWritten, rowsWritten, unclassified };
}

// ---------------------------------------------------------------------------
// Pass B: Sleeper, for completed League Pulse drafts
// ---------------------------------------------------------------------------

async function passLeaguePulse(supabase: Client, candidates: FormatCandidates) {
  const { data: drafts, error } = await supabase
    .from("league_drafts")
    .select("sleeper_draft_id, league_id, season, status, type, settings, start_time")
    .eq("status", "complete")
    .order("season", { ascending: false });
  if (error) throw new Error(`league_drafts read failed: ${error.message}`);

  const completed = drafts ?? [];
  if (completed.length === 0) {
    return { draftsWritten: 0, rowsWritten: 0, skipped: 0, unreachable: 0 };
  }

  // One query, not one per draft.
  const captured = await draftIdsWithSelections(
    supabase,
    completed.map((d) => d.sleeper_draft_id),
  );
  const pending = completed.filter((d) => !captured.has(d.sleeper_draft_id));
  console.log(
    `  ${completed.length} completed league drafts, ${captured.size} already captured, ${pending.length} to fetch`,
  );

  // Format is a league property, so resolve it once per league rather than once
  // per draft (a dynasty league has one draft per season, all the same format).
  const leagueIds = [...new Set(pending.map((d) => d.league_id))];
  const formatByLeague = new Map<string, string | null>();
  for (let i = 0; i < leagueIds.length; i += 200) {
    const chunk = leagueIds.slice(i, i + 200);
    const { data } = await supabase
      .from("leagues")
      .select("id, scoring_settings, roster_positions, metadata")
      .in("id", chunk);
    for (const row of data ?? []) {
      const merged = {
        ...((row.metadata ?? {}) as Record<string, unknown>),
        ...(row.scoring_settings ? { scoring_settings: row.scoring_settings } : {}),
        ...(row.roster_positions ? { roster_positions: row.roster_positions } : {}),
      };
      const shape = leagueShape(merged);
      const detected = shape ? detectLeagueFormat(shape, candidates) : null;
      formatByLeague.set(row.id, detected?.slug ?? null);
    }
  }

  let draftsWritten = 0;
  let rowsWritten = 0;
  let unreachable = 0;

  for (const [index, draft] of pending.entries()) {
    if (index > 0) await sleep(SLEEPER_SPACING_MS);

    const picks = await getSleeperDraftPicksOrNull(draft.sleeper_draft_id);
    // null = the request failed and we know nothing. [] = Sleeper answered and
    // the draft has no picks (a reset draft still marked complete). Neither is
    // worth writing; only the first is worth reporting as a gap.
    if (picks === null) {
      unreachable += 1;
      continue;
    }
    if (picks.length === 0) continue;

    const settings = (draft.settings ?? {}) as Record<string, unknown>;
    const rounds = Number(settings.rounds ?? 0);
    const formatSlug = formatByLeague.get(draft.league_id) ?? null;

    const result = await recordDraftSelections(supabase, picks, {
      sleeperDraftId: draft.sleeper_draft_id,
      sleeperLeagueId: null,
      season: draft.season,
      draftType: draft.type,
      draftStatus: draft.status,
      formatSlug,
      playerPool: formatSlug ? inferPlayerPool({ formatSlug, rounds }) : null,
      teams: intOrNull(settings.teams),
      rounds: intOrNull(settings.rounds),
      draftedAt: draft.start_time,
      ingestSource: "backfill",
    });

    if (result.ok && result.rowsWritten > 0) {
      draftsWritten += 1;
      rowsWritten += result.rowsWritten;
      if (draftsWritten % 10 === 0) {
        console.log(`  ...${draftsWritten} drafts, ${rowsWritten} picks`);
      }
    } else if (!result.ok) {
      console.warn(`  draft ${draft.sleeper_draft_id} failed: ${result.error}`);
    }
  }

  return { draftsWritten, rowsWritten, skipped: captured.size, unreachable };
}

// ---------------------------------------------------------------------------

async function main() {
  const skipSleeper = process.argv.includes("--skip-sleeper");
  const supabase = getServiceClient();
  const started = Date.now();

  const candidates = await ffbeaconFormatCandidates(supabase);
  if (candidates.length === 0) {
    throw new Error("No FF Beacon format candidates. Cannot classify any draft.");
  }

  console.log("Pass A: on_the_clock_pick_cache -> draft_selections");
  const a = await passOnTheClock(supabase, candidates);
  console.log(
    `  ${a.rowsWritten} picks from ${a.draftsWritten} drafts (${a.unclassified} drafts had no derivable format)`,
  );

  let b = { draftsWritten: 0, rowsWritten: 0, skipped: 0, unreachable: 0 };
  if (skipSleeper) {
    console.log("Pass B: skipped (--skip-sleeper)");
  } else {
    console.log("Pass B: Sleeper -> draft_selections (completed league drafts)");
    b = await passLeaguePulse(supabase, candidates);
    console.log(
      `  ${b.rowsWritten} picks from ${b.draftsWritten} drafts (${b.unreachable} drafts unreachable)`,
    );
  }

  const { count } = await supabase
    .from("draft_selections")
    .select("id", { count: "exact", head: true });

  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s. draft_selections now holds ${count ?? "?"} picks.`,
  );

  // A zero-row ledger after a full run means something is wrong upstream, not
  // that there was nothing to do.
  if ((count ?? 0) === 0) {
    throw new Error("draft_selections is empty after a full backfill run.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
