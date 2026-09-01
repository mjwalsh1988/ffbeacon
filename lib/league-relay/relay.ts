import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { syncLeagueMatchups, resolveCurrentWeek } from "@/lib/league-matchups";
import { getNflState, type SleeperLeague } from "@/lib/sleeper";
import { loadScheduleBoard, loadMatchupDetail } from "@/lib/league-schedule/data";
import { analyzeLeagueTrades, type LeagueTradeInput } from "@/lib/league-signal-check";
import { SITE } from "@/lib/site";
import type { LeagueRelaySettings } from "./default-settings";
import { loadLeagueRelaySettings } from "./settings";
import {
  easternMoment,
  isPreviewWindow,
  isRecapWindow,
} from "./schedule";
import {
  loadFaabMedian,
  loadPulseRanks,
  loadRelayLeague,
  loadRelayTeams,
  loadWaiverPlayers,
  readFaabBid,
  readFaabBudget,
  resolveRelayContext,
} from "./load";
import { claimAndSend, claimHour, type SendOutcome } from "./post";
import { buildTradeWriteup } from "./trade-writeup";
import {
  buildWaiverDigest,
  buildWaiverWriteup,
  type WaiverMove,
  type WaiverPlayer,
} from "./waiver-writeup";
import { groupIntoRuns, runDigestKey, runIsDigest } from "./waiver-run";
import { buildMatchupPreview, buildMatchupRecap } from "./matchup-writeup";
import { evaluateExecutedTrade } from "./trade-impact";
import { orderRecaps, pickMatchups, recapKeyPart } from "./select-matchup";
import type { BuildAsset } from "@/lib/trade-impact/types";
import type { RelayLeague, RelayTeam } from "./types";

type Admin = SupabaseClient<Database>;

/**
 * The relay: sync every community league, then say what changed.
 *
 * WHY THE SYNC IS NOT `pulseLeague(force: true)`. Forcing recomputes the power
 * rankings, Power Pulse and the Positional WAR curve on every call, and those
 * are the three expensive things in a league sync. On a fifteen-minute cadence
 * that is ninety-six full recomputes a day per league, for models whose INPUTS
 * (nightly player values, weekly projections) change at most once a day.
 *
 * So the two halves are called separately:
 *
 *   pulseLeagueCore(force: true)             refetch the league, rosters,
 *                                            members and drafts. Cheap, and the
 *                                            only part that has to be fresh.
 *   pulseLeagueDerived(resynced: true)       sync transactions, and let every
 *                                            derived model keep its OWN TTL
 *                                            gate (24h rankings, 12h Power
 *                                            Pulse, 12h Positional WAR).
 *
 * That is the same contract a page load has, which is exactly the point: a
 * community league is a league somebody is looking at every fifteen minutes
 * instead of once a day. It costs no more per view than a reader would.
 *
 * NOTHING BEFORE THE WATERMARK IS EVER POSTED. A league nominated in November
 * has a season of stored transactions and none of them are news.
 */

export interface RelayRunResult {
  ok: boolean;
  leaguesConsidered: number;
  leaguesSynced: number;
  posted: number;
  skipped: number;
  errors: number;
  /** One line per league, for the cron log and the admin panel. */
  notes: string[];
}

/** Bounds one run's wall clock, well under the route's maxDuration. */
const RUN_BUDGET_MS = 240_000;

/** How many weeks of projections a waiver writeup averages over. */
const WAIVER_PROJECTION_WEEKS = 3;

interface CommunityRow {
  id: string;
  league_id: string;
  sleeper_league_id: string;
  watermark_at: string;
}

/**
 * Run the relay.
 *
 * Never throws: a cron that dies on one bad league leaves every other league
 * unsynced until the next tick, which is the failure mode that turns a small
 * outage into a silent day.
 */
export async function runLeagueRelay(
  admin: Admin,
  opts: { now?: Date; leagueId?: string; dryRun?: boolean } = {},
): Promise<RelayRunResult> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const result: RelayRunResult = {
    ok: true,
    leaguesConsidered: 0,
    leaguesSynced: 0,
    posted: 0,
    skipped: 0,
    errors: 0,
    notes: [],
  };

  const settings = await loadLeagueRelaySettings(admin);
  if (!settings.enabled) {
    result.notes.push("League Relay is switched off.");
    return result;
  }

  let query = admin
    .from("community_leagues")
    .select("id, league_id, sleeper_league_id, watermark_at")
    .eq("is_active", true)
    // Least recently synced first, so a capped run rotates through the list
    // rather than always taking the same head of it.
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(settings.sync.max_leagues_per_run);
  if (opts.leagueId) query = query.eq("league_id", opts.leagueId);

  const { data: rows, error } = await query;
  if (error) {
    return { ...result, ok: false, notes: [`Could not read community leagues: ${error.message}`] };
  }
  const leagues = (rows ?? []) as CommunityRow[];
  result.leaguesConsidered = leagues.length;

  for (const row of leagues) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      result.notes.push("Ran out of time; the rest go on the next tick.");
      break;
    }
    try {
      const note = await relayOneLeague(admin, settings, row, now, opts.dryRun ?? false, result);
      result.notes.push(note);
    } catch (err) {
      result.errors += 1;
      result.ok = false;
      result.notes.push(
        `${row.sleeper_league_id}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  return result;
}

/**
 * Everything about a league that every builder needs, read once.
 *
 * Shared by the live run and by the admin preview, on purpose: a preview that
 * gathered its facts differently would show an admin a message the channel is
 * not going to get, which is worse than having no preview at all.
 */
export interface LeagueFacts {
  league: RelayLeague;
  teams: Map<number, RelayTeam>;
  pulseRanks: Map<number, number>;
  context: Awaited<ReturnType<typeof resolveRelayContext>>;
  sleeperLeague: SleeperLeague;
  playoffWeekStart: number;
  currentWeek: number;
}

export async function gatherLeagueFacts(
  admin: Admin,
  leagueRowId: string,
  watermarkAt: string,
): Promise<LeagueFacts | null> {
  const league = await loadRelayLeague(admin, leagueRowId, watermarkAt);
  if (!league) return null;

  const [teams, pulseRanks, context] = await Promise.all([
    loadRelayTeams(admin, league.id),
    loadPulseRanks(admin, league.id, league.season),
    resolveRelayContext(admin, league),
  ]);

  const nflState = await getNflState();
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  // Sleeper's own setting, defaulted to 15 only when the league object has not
  // been captured. Never guessed from the season length: a 14-week regular
  // season is common and would put two playoff weeks inside the preview run.
  const playoffWeekStart = Number(
    (sleeperLeague as { settings?: { playoff_week_start?: unknown } })?.settings
      ?.playoff_week_start ?? 15,
  );
  const currentWeek = resolveCurrentWeek(nflState, league.season, playoffWeekStart);

  return { league, teams, pulseRanks, context, sleeperLeague, playoffWeekStart, currentWeek };
}

async function relayOneLeague(
  admin: Admin,
  settings: LeagueRelaySettings,
  row: CommunityRow,
  now: Date,
  dryRun: boolean,
  result: RelayRunResult,
): Promise<string> {
  /* -------------------------------------------------------------- 1. sync */
  const core = await pulseLeagueCore(admin, row.sleeper_league_id, { force: true });
  if (!core.ok) {
    await admin
      .from("community_leagues")
      .update({
        last_synced_at: now.toISOString(),
        sync_status: "error",
        sync_detail: core.error.slice(0, 500),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    result.errors += 1;
    return `${row.sleeper_league_id}: sync failed (${core.error})`;
  }
  // Transactions get refreshed; every derived model keeps its own TTL gate.
  await pulseLeagueDerived(admin, core.leagueRowId, { force: false, resynced: true });
  result.leaguesSynced += 1;

  await admin
    .from("community_leagues")
    .update({
      last_synced_at: now.toISOString(),
      sync_status: "ok",
      sync_detail: null,
      updated_at: now.toISOString(),
    })
    .eq("id", row.id);

  /* ------------------------------------------------------------- 2. facts */
  const facts = await gatherLeagueFacts(admin, core.leagueRowId, row.watermark_at);
  if (!facts) return `${row.sleeper_league_id}: the league row disappeared mid-run.`;
  const { league, teams, pulseRanks, context, sleeperLeague, playoffWeekStart, currentWeek } =
    facts;

  const url = settings.voice.link_back ? `${SITE.url}/leagues/${league.sleeperLeagueId}` : null;
  const outcomes: SendOutcome[] = [];
  const budget = settings.sync.max_messages_per_league_per_run;

  /* ------------------------------------------------- 3. transaction stream */
  if (outcomes.length < budget) {
    const txOutcomes = await relayTransactions(admin, {
      settings,
      league,
      teams,
      pulseRanks,
      context,
      currentWeek,
      sleeperLeague,
      url,
      now,
      dryRun,
      budget: budget - outcomes.length,
    });
    outcomes.push(...txOutcomes);
  }

  /* ------------------------------------------------------- 4. the matchups */
  const wantsPreview =
    settings.channels.matchup_preview.enabled &&
    isPreviewWindow(now, settings.matchups);
  const wantsRecap =
    settings.channels.matchup_recap.enabled && isRecapWindow(now, settings.matchups);

  if (wantsPreview || wantsRecap) {
    // The schedule has to be current before either can be written, and the
    // matchup sync is gated behind the two windows on purpose: it is a Sleeper
    // round trip per volatile week, and the other ninety-odd ticks of the week
    // have no use for it.
    await syncLeagueMatchups(
      admin,
      league.id,
      league.sleeperLeagueId,
      league.season,
      currentWeek,
    );

    const board = await loadScheduleBoard(admin, {
      leagueRowId: league.id,
      season: league.season,
      playoffWeekStart,
      currentWeek,
    });

    if (wantsPreview) {
      outcomes.push(
        ...(await relayPreviews(admin, {
          settings,
          league,
          board,
          currentWeek,
          playoffWeekStart,
          url,
          dryRun,
        })),
      );
    }
    if (wantsRecap) {
      outcomes.push(
        ...(await relayRecaps(admin, {
          settings,
          league,
          board,
          currentWeek,
          playoffWeekStart,
          url,
          now,
          dryRun,
        })),
      );
    }
  }

  for (const o of outcomes) {
    if (o.status === "posted") result.posted += 1;
    else if (o.status === "error") result.errors += 1;
    else if (o.status === "skipped") result.skipped += 1;
  }

  const posted = outcomes.filter((o) => o.status === "posted").length;
  return `${league.name}: synced, ${posted} posted, ${outcomes.length - posted} not.`;
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

export interface TxParams {
  settings: LeagueRelaySettings;
  league: RelayLeague;
  teams: Map<number, RelayTeam>;
  pulseRanks: Map<number, number>;
  context: Awaited<ReturnType<typeof resolveRelayContext>>;
  currentWeek: number;
  sleeperLeague: SleeperLeague;
  url: string | null;
  now: Date;
  dryRun: boolean;
  budget: number;
}

/**
 * Every transaction since the watermark that has not already been written up.
 *
 * THE AGE CAP IS NOT THE WATERMARK. The watermark stops a newly nominated
 * league replaying its season. This stops an OUTAGE doing the same thing: four
 * hours of failed crons should post the four hours of moves that happened, not
 * forty. Anything older is passed over silently.
 */
async function relayTransactions(admin: Admin, p: TxParams): Promise<SendOutcome[]> {
  const wantTrade = p.settings.channels.trade.enabled;
  const wantWaiver = p.settings.channels.waiver.enabled;
  if (!wantTrade && !wantWaiver) return [];

  const types = [wantTrade ? "trade" : null, ...(wantWaiver ? ["waiver", "free_agent"] : [])].filter(
    (t): t is string => t !== null,
  );

  const ageFloor = new Date(
    p.now.getTime() - p.settings.sync.max_transaction_age_hours * 3_600_000,
  ).toISOString();
  const floor = ageFloor > p.league.watermarkAt ? ageFloor : p.league.watermarkAt;

  const { data: rows } = await admin
    .from("league_transactions")
    .select(
      "id, sleeper_transaction_id, type, status, week, season, adds, drops, draft_picks, waiver_budget, roster_ids, metadata, created_at_sleeper",
    )
    .eq("league_id", p.league.id)
    .eq("season", p.league.season)
    .in("type", types)
    .eq("status", "complete")
    .gt("created_at_sleeper", floor)
    // Oldest first, so a burst of eleven claims is written up in the order it
    // happened across however many ticks it takes.
    .order("created_at_sleeper", { ascending: true })
    .limit(50);

  const pending = rows ?? [];
  if (pending.length === 0) return [];

  // Which of these have already been handled. ONE read for the batch: asking
  // per transaction would be fifty round trips to learn there is nothing to do,
  // which is the common case on every tick.
  const keys = pending.map((t) => dedupeKeyFor(t.type, p.league.id, t.sleeper_transaction_id));
  const { data: existing } = await admin
    .from("league_relay_posts")
    .select("dedupe_key")
    .in("dedupe_key", keys);
  const handled = new Set((existing ?? []).map((e) => e.dedupe_key));

  const fresh = pending.filter(
    (t) => !handled.has(dedupeKeyFor(t.type, p.league.id, t.sleeper_transaction_id)),
  );
  if (fresh.length === 0) return [];

  const outcomes: SendOutcome[] = [];
  const trades = fresh.filter((t) => t.type === "trade") as unknown as TxRow[];
  const wireMoves = fresh.filter((t) => t.type !== "trade") as unknown as TxRow[];

  /* ------------------------------------------------------------- the wire */
  // Grouped BEFORE anything is loaded or built, because the grouping decides
  // how many messages there are and therefore how much of the budget the wire
  // needs. A run of eleven claims is one message, not eleven.
  const runs = groupIntoRuns(
    wireMoves.map((t) => ({
      sleeperTransactionId: t.sleeper_transaction_id,
      type: t.type === "waiver" ? ("waiver" as const) : ("free_agent" as const),
      createdAtSleeper: t.created_at_sleeper,
      week: t.week,
      row: t,
    })),
  );
  const byId = new Map(wireMoves.map((t) => [t.sleeper_transaction_id, t]));

  // Digest runs are already claimed under their own key, so a run that has been
  // digested on an earlier tick must not be rebuilt as individual reviews.
  const digestKeys = runs
    .filter((r) => runIsDigest(r, p.settings.waivers.digest_threshold))
    .map((r) => runDigestKey(p.league.id, r));
  const digestedAlready = new Set<string>();
  if (digestKeys.length > 0) {
    const { data } = await admin
      .from("league_relay_posts")
      .select("dedupe_key")
      .in("dedupe_key", digestKeys);
    for (const row of data ?? []) digestedAlready.add(row.dedupe_key);
  }

  // Player facts for every wire move in the tick, read ONCE. See load.ts.
  const playerIds = new Set<string>();
  for (const t of wireMoves) {
    for (const id of Object.keys((t.adds ?? {}) as Record<string, unknown>)) playerIds.add(id);
    for (const id of Object.keys((t.drops ?? {}) as Record<string, unknown>)) playerIds.add(id);
  }
  const weeks = Array.from({ length: WAIVER_PROJECTION_WEEKS }, (_, i) => p.currentWeek + i).filter(
    (w) => w >= 1 && w <= 18,
  );

  const [players, faabMedian] = await Promise.all([
    playerIds.size > 0
      ? loadWaiverPlayers(admin, {
          sleeperPlayerIds: Array.from(playerIds),
          season: p.league.season,
          weeks,
          scoring:
            (p.sleeperLeague as { scoring_settings?: Record<string, number> })?.scoring_settings ??
            null,
          formatConfigId: p.context.formatConfigId,
          sourceSlug: p.context.sourceSlug,
        })
      : Promise.resolve(new Map()),
    wireMoves.length > 0
      ? loadFaabMedian(admin, p.league.id, p.league.season)
      : Promise.resolve(null),
  ]);
  const faabBudget = readFaabBudget(p.sleeperLeague);
  const waiverChannel = p.settings.channels.waiver;

  let budget = p.budget;

  for (const run of runs) {
    if (budget <= 0) break;
    const rows = run.moves
      .map((m) => byId.get(m.sleeperTransactionId))
      .filter((r): r is TxRow => Boolean(r));

    if (!runIsDigest(run, p.settings.waivers.digest_threshold)) {
      // A quiet run: every claim gets its own review.
      for (const tx of rows) {
        if (budget <= 0) break;
        const dedupeKey = dedupeKeyFor(tx.type, p.league.id, tx.sleeper_transaction_id);
        if (p.dryRun) {
          outcomes.push({ status: "skipped", dedupeKey, reason: "dry run" });
          continue;
        }
        outcomes.push(
          await claimAndSend(admin, {
            leagueId: p.league.id,
            messageType: "waiver",
            dedupeKey,
            season: tx.season,
            week: tx.week,
            channel: waiverChannel,
            build: async () =>
              buildWaiverFor(p, tx, players, faabBudget, faabMedian, dedupeKey),
          }),
        );
        budget -= 1;
      }
      continue;
    }

    // A busy run: ONE message for the lot.
    const digestKey = runDigestKey(p.league.id, run);
    if (p.dryRun) {
      outcomes.push({ status: "skipped", dedupeKey: digestKey, reason: "dry run" });
      continue;
    }
    if (!digestedAlready.has(digestKey)) {
      outcomes.push(
        await claimAndSend(admin, {
          leagueId: p.league.id,
          messageType: "waiver",
          dedupeKey: digestKey,
          season: p.league.season,
          week: run.week,
          channel: waiverChannel,
          build: async () =>
            buildWaiverDigest({
              league: p.league,
              moves: rows
                .map((tx) => toWaiverMove(p, tx, players))
                .filter((m): m is WaiverMove => m !== null),
              kind: run.type,
              week: run.week,
              faabBudget,
              faabMedian,
              snark: p.settings.voice.snark,
              showNumbers: p.settings.voice.show_numbers,
              url: p.url,
              seedKey: digestKey,
            }),
        }),
      );
      budget -= 1;
    }

    // EVERY MOVE IN THE RUN IS MARKED HANDLED, whether the digest went out or
    // not. Without this the next tick would find the same eleven claims still
    // unhandled, group them again (into a smaller run once some had aged out),
    // and post them a second time as individual reviews. The ledger row is the
    // record that they were covered, and it names what covered them.
    await markCoveredByDigest(admin, p.league.id, rows, digestKey);
  }

  /* ----------------------------------------------------------- the trades */
  // Trades come last only because the wire has already been grouped; they are
  // one message each either way, and a trade is never folded into a digest.
  for (const tx of trades) {
    if (budget <= 0) break;
    const dedupeKey = dedupeKeyFor("trade", p.league.id, tx.sleeper_transaction_id);
    if (p.dryRun) {
      outcomes.push({ status: "skipped", dedupeKey, reason: "dry run" });
      continue;
    }
    outcomes.push(
      await claimAndSend(admin, {
        leagueId: p.league.id,
        messageType: "trade",
        dedupeKey,
        season: tx.season,
        week: tx.week,
        channel: p.settings.channels.trade,
        build: () => buildTradeFor(admin, p, tx, dedupeKey),
      }),
    );
    budget -= 1;
  }

  return outcomes;
}

/**
 * File every move in a digested run as covered, so nothing is posted twice.
 *
 * Written as 'skipped' with the digest named in `error`, which is the honest
 * description: no message went out for this transaction on its own, and the
 * reason is not a failure. The admin panel shows the sentence rather than an
 * empty row.
 *
 * `upsert` with `ignoreDuplicates`, because a row may already exist (this tick
 * may have raced another, or an earlier tick may have reviewed the move before
 * the run grew past the threshold). An existing row is already the record we
 * want and must not be overwritten: it may say 'posted'.
 */
async function markCoveredByDigest(
  admin: Admin,
  leagueId: string,
  rows: TxRow[],
  digestKey: string,
): Promise<void> {
  if (rows.length === 0) return;
  await admin.from("league_relay_posts").upsert(
    rows.map((tx) => ({
      league_id: leagueId,
      message_type: "waiver",
      dedupe_key: dedupeKeyFor(tx.type, leagueId, tx.sleeper_transaction_id),
      season: tx.season,
      week: tx.week,
      status: "skipped",
      error: `Covered by the run digest (${digestKey}).`,
    })),
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
}

export function dedupeKeyFor(type: string, leagueId: string, sleeperTransactionId: string): string {
  const prefix = type === "trade" ? "trade" : "waiver";
  return `${prefix}:${leagueId}:${sleeperTransactionId}`;
}

export type TxRow = {
  id: string;
  sleeper_transaction_id: string;
  created_at_sleeper: string | null;
  type: string;
  week: number | null;
  season: number | null;
  adds: unknown;
  drops: unknown;
  draft_picks: unknown;
  waiver_budget: unknown;
  metadata: unknown;
};

/** The two rosters in a trade, lowest Sleeper roster id first. */
function tradeRosterPair(adds: unknown, picks: unknown[]): [number, number] | null {
  const set = new Set<number>();
  for (const rid of Object.values((adds ?? {}) as Record<string, unknown>)) {
    const n = Number(rid);
    if (Number.isFinite(n)) set.add(n);
  }
  for (const pick of picks) {
    const owner = Number((pick as { owner_id?: unknown })?.owner_id);
    if (Number.isFinite(owner)) set.add(owner);
  }
  const ids = Array.from(set).sort((x, y) => x - y);
  return ids.length === 2 ? [ids[0], ids[1]] : null;
}

export async function buildTradeFor(admin: Admin, p: TxParams, tx: TxRow, seedKey: string) {
  const picks = Array.isArray(tx.draft_picks) ? (tx.draft_picks as unknown[]) : [];
  const pair = tradeRosterPair(tx.adds, picks);
  // Three-team trades and one-sided salary dumps are not written up. Signal
  // Check orders exactly two sides, and a writeup that names two of three
  // participants describes a trade nobody made.
  if (!pair) return null;

  const [rosterA, rosterB] = pair;
  const teamA = p.teams.get(rosterA);
  const teamB = p.teams.get(rosterB);
  if (!teamA || !teamB) return null;

  const tradeInput: LeagueTradeInput = {
    sleeperTransactionId: tx.sleeper_transaction_id,
    adds: (tx.adds ?? {}) as Record<string, number>,
    draftPicks: picks,
    createdAtSleeper: tx.created_at_sleeper,
  };

  const analysis = await analyzeLeagueTrades(admin, {
    sleeperLeague: p.sleeperLeague,
    trades: [tradeInput],
    rosterLabels: { [rosterA]: teamA.name, [rosterB]: teamB.name },
    leagueRowId: p.league.id,
  });
  const graded = analysis.results.get(tx.sleeper_transaction_id);
  // A trade Signal Check cannot grade has no verdict, and a trade writeup with
  // no verdict is a list of names. Left unposted rather than half-written.
  if (!graded) return null;

  // The season impact, from the same model the Trade Ideas builder uses. Null
  // when an asset has already moved on; the writeup then runs on values alone
  // and says so.
  const impact = await evaluateExecutedTrade(admin, {
    sleeperLeagueId: p.league.sleeperLeagueId,
    sourceSlug: p.context.sourceSlug,
    rosterA,
    rosterB,
    aReceived: buildAssetsFor(graded.assetMeta.a),
    bReceived: buildAssetsFor(graded.assetMeta.b),
  });

  return buildTradeWriteup({
    league: p.league,
    teamA,
    teamB,
    view: graded.view,
    assetMeta: graded.assetMeta,
    impact: impact.ok ? impact.impact : null,
    week: tx.week,
    snark: p.settings.voice.snark,
    showNumbers: p.settings.voice.show_numbers,
    url: p.url,
    seedKey,
  });
}

/**
 * Signal Check's asset metadata, turned into the impact model's input.
 *
 * The mapping already exists: `analyzeLeagueTrades` resolved every Sleeper id
 * to an FF Beacon player id and every pick to its season, round and slot, so
 * doing it again here would be a second, divergent resolution of the same
 * trade. An asset it could not resolve is dropped, which is safe because the
 * impact model re-derives ownership anyway and would reject a bad one.
 */
function buildAssetsFor(meta: Array<{ kind: string; playerId?: string | null; season?: number | null; round?: number | null; pickPosition?: string | null }>): BuildAsset[] {
  const out: BuildAsset[] = [];
  for (const m of meta) {
    if (m.kind === "player" && m.playerId) {
      out.push({ kind: "player", playerId: m.playerId });
    } else if (m.kind === "pick" && m.season && m.round) {
      const slot = m.pickPosition;
      out.push({
        kind: "pick",
        season: m.season,
        round: m.round,
        pickPosition:
          slot === "early" || slot === "mid" || slot === "late" ? slot : "unknown",
      });
    }
  }
  return out;
}

/**
 * One stored transaction, resolved into the shape both wire writeups read.
 *
 * Shared by the single review and by the digest, so the two can never disagree
 * about who moved what. Null when the row is not a wire move this feature knows
 * how to describe.
 */
export function toWaiverMove(
  p: TxParams,
  tx: TxRow,
  players: Map<string, WaiverPlayer>,
): WaiverMove | null {
  const adds = (tx.adds ?? {}) as Record<string, number>;
  const drops = (tx.drops ?? {}) as Record<string, number>;

  // A wire move belongs to ONE roster. Sleeper occasionally writes a
  // multi-roster row (a commissioner action, say); those are not waiver claims
  // and are left alone rather than attributed to whoever appears first.
  const rosterIds = new Set<number>([
    ...Object.values(adds).map(Number),
    ...Object.values(drops).map(Number),
  ]);
  if (rosterIds.size !== 1) return null;
  const rosterId = Array.from(rosterIds)[0];
  const team = p.teams.get(rosterId);
  if (!team) return null;

  const added = Object.keys(adds)
    .map((id) => players.get(id))
    .filter((x): x is WaiverPlayer => Boolean(x));
  const dropped = Object.keys(drops)
    .map((id) => players.get(id))
    .filter((x): x is WaiverPlayer => Boolean(x));

  return {
    team,
    pulseRank: p.pulseRanks.get(rosterId) ?? null,
    kind: tx.type === "waiver" ? "waiver" : "free_agent",
    added,
    dropped,
    faabSpent: readFaabBid(tx.metadata as never, tx.waiver_budget as never),
    week: tx.week,
    seedKey: dedupeKeyFor(tx.type, p.league.id, tx.sleeper_transaction_id),
  };
}

export function buildWaiverFor(
  p: TxParams,
  tx: TxRow,
  players: Map<string, WaiverPlayer>,
  faabBudget: number | null,
  faabMedian: number | null,
  seedKey: string,
) {
  const move = toWaiverMove(p, tx, players);
  if (!move) return null;

  // A move that drops somebody and adds nobody. Settings decide whether that is
  // news; it is by default, now that a busy run is digested rather than posted
  // one message at a time.
  if (move.added.length === 0 && !p.settings.waivers.include_bare_drops) return null;

  return buildWaiverWriteup({
    ...move,
    league: p.league,
    faabBudget,
    faabMedian,
    // Filled by a later pass when the positional board is loaded; naming a
    // weakest position we have not measured would be an invented fact.
    weakestPosition: null,
    snark: p.settings.voice.snark,
    showNumbers: p.settings.voice.show_numbers,
    url: p.url,
    seedKey,
  });
}

/* -------------------------------------------------------------------------- */
/* Matchups                                                                   */
/* -------------------------------------------------------------------------- */

interface MatchupParams {
  settings: LeagueRelaySettings;
  league: RelayLeague;
  board: Awaited<ReturnType<typeof loadScheduleBoard>>;
  currentWeek: number;
  playoffWeekStart: number;
  url: string | null;
  dryRun: boolean;
}

/**
 * The Wednesday previews.
 *
 * REGULAR SEASON ONLY, and that gate is the whole reason the week is checked
 * rather than simply taken. A preview posted in July describes a slate nobody
 * has set a lineup for, and a preview posted in the playoffs describes a game
 * half the league is not in.
 */
async function relayPreviews(admin: Admin, p: MatchupParams): Promise<SendOutcome[]> {
  if (p.currentWeek < 1 || p.currentWeek >= p.playoffWeekStart) return [];
  if (p.board.noScheduleYet) return [];

  const week = p.board.weeks.find((w) => w.week === p.currentWeek);
  if (!week || week.isPlayoffWeek) return [];

  const picks = pickMatchups(week, p.league.totalRosters, {
    headline: p.settings.matchups.preview_headline,
    undercard: p.settings.matchups.preview_undercard,
  });

  const outcomes: SendOutcome[] = [];
  for (const pick of picks) {
    const dedupeKey = `preview:${p.league.id}:${p.league.season}:${week.week}:${pick.slot}`;
    if (p.dryRun) {
      outcomes.push({ status: "skipped", dedupeKey, reason: "dry run" });
      continue;
    }
    outcomes.push(
      await claimAndSend(admin, {
        leagueId: p.league.id,
        messageType: "matchup_preview",
        dedupeKey,
        season: p.league.season,
        week: week.week,
        channel: p.settings.channels.matchup_preview,
        build: async () => {
          const detail = await loadMatchupDetail(admin, admin, {
            leagueRowId: p.league.id,
            season: p.league.season,
            week: week.week,
            sleeperRosterId: pick.matchup.home.sleeperRosterId,
            currentWeek: p.currentWeek,
          });
          if (!detail.ok) return null;
          return buildMatchupPreview({
            league: p.league,
            view: detail.view,
            slot: pick.slot,
            snark: p.settings.voice.snark,
            showNumbers: p.settings.voice.show_numbers,
            url: p.url,
            seedKey: dedupeKey,
          });
        },
      }),
    );
  }
  return outcomes;
}

/**
 * The Tuesday recaps: one game an hour.
 *
 * TWO CLAIMS, AND BOTH ARE NEEDED. The HOUR claim stops all four ticks inside
 * one Eastern hour from each picking the next uncovered game; the GAME claim
 * stops the same fixture being written twice across hours. Either alone leaves
 * a hole: without the hour claim a Tuesday posts the whole slate at eleven, and
 * without the game claim an hour that fails halfway posts a duplicate later.
 *
 * The hour is claimed FIRST and is never released, even when no game is left to
 * write. An hour spent discovering there is nothing to do is an hour correctly
 * spent, and releasing it would let the next tick discover the same thing three
 * more times.
 */
async function relayRecaps(
  admin: Admin,
  p: MatchupParams & { now: Date },
): Promise<SendOutcome[]> {
  // The week that just finished: the LAST week our own rows mark final, not
  // arithmetic on Sleeper's live week. Sleeper advances that at its own pace on
  // a Tuesday morning, and a recap run keyed to it would cover the wrong week
  // for whichever hours fell on the wrong side.
  const finalWeeks = p.board.weeks.filter((w) => w.isFinal && !w.isPlayoffWeek);
  const week = finalWeeks[finalWeeks.length - 1];
  if (!week) return [];

  const moment = easternMoment(p.now);
  const hourKey = `recap-hour:${p.league.id}:${moment.hourKey}`;
  if (p.dryRun) return [{ status: "skipped", dedupeKey: hourKey, reason: "dry run" }];

  // The hour, before anything else. A claim taken after the work is a claim
  // that does not stop the work.
  if (!(await claimHour(admin, p.league.id, hourKey))) {
    return [{ status: "duplicate", dedupeKey: hourKey }];
  }

  const games = orderRecaps(week);
  if (games.length === 0) return [];

  const keys = games.map(
    (m) => `recap:${p.league.id}:${p.league.season}:${week.week}:${recapKeyPart(m)}`,
  );
  const { data: existing } = await admin
    .from("league_relay_posts")
    .select("dedupe_key")
    .in("dedupe_key", keys);
  const handled = new Set((existing ?? []).map((e) => e.dedupe_key));

  const index = keys.findIndex((k) => !handled.has(k));
  // Everything covered. The hour claim stays taken, which is correct: the run
  // is finished for this week and re-checking three more times this hour would
  // learn nothing.
  if (index === -1) return [];

  const game = games[index];
  const dedupeKey = keys[index];

  return [
    await claimAndSend(admin, {
      leagueId: p.league.id,
      messageType: "matchup_recap",
      dedupeKey,
      season: p.league.season,
      week: week.week,
      channel: p.settings.channels.matchup_recap,
      build: async () => {
        const detail = await loadMatchupDetail(admin, admin, {
          leagueRowId: p.league.id,
          season: p.league.season,
          week: week.week,
          sleeperRosterId: game.home.sleeperRosterId,
          currentWeek: p.currentWeek,
        });
        if (!detail.ok) return null;
        return buildMatchupRecap({
          league: p.league,
          view: detail.view,
          slot: null,
          snark: p.settings.voice.snark,
          showNumbers: p.settings.voice.show_numbers,
          url: p.url,
          seedKey: dedupeKey,
        });
      },
    }),
  ];
}
