/**
 * NO `import "server-only"` HERE, DELIBERATELY.
 *
 * This module is reached from `lib/league-pulse.ts`, which is imported by CLI
 * scripts (`npm run pulse:league`, the relay runner, the power-rankings recalc)
 * that run under tsx with no Next.js resolver. `server-only` does not resolve
 * there, so adding the guard breaks every one of those scripts at import time
 * rather than protecting anything. league-pulse itself omits it for the same
 * reason. The service-role client is passed in by the caller, so nothing here
 * can reach a secret on its own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { normalizeDraftPicks } from "@/lib/sleeper-draft-picks";
import { writeActivity } from "./record";
import type { ActivityKind, ActivityPickRef, PendingActivity } from "./types";

/**
 * Turning what we already store into activity.
 *
 * Two of the five categories need no detection at all, because the facts are
 * already on disk with timestamps we can stand behind:
 *
 *   TRANSACTIONS carry Sleeper's own `created_at_sleeper`, to the second. Those
 *   events are marked `exact` and the card prints the time.
 *
 *   RESULTS are settled scores in `league_matchups`. What we do NOT have is the
 *   moment the game ended, so the timestamp is derived from the NFL week (see
 *   `nflWeekEndUtc`) and the card leads with "Week 6, final" instead of a clock
 *   time nobody measured.
 *
 * WHY PROJECT AT ALL RATHER THAN READING THOSE TABLES IN THE FEED. One ordering
 * and one cursor. A feed that mixes three sources has three cursors and no
 * stable sort, and "the next twenty things" stops being expressible. The cost
 * is one bounded insert per sync, and the unique index makes a repeat free.
 *
 * BACK HISTORY IS FILLED IN FULL, on purpose, and this is where the on-site log
 * deliberately differs from League Relay. The relay has a watermark because
 * replaying September into a Discord channel in November would be spam. A page
 * a reader scrolls has the opposite need: they want the season.
 */

type ServiceClient = SupabaseClient<Database>;

/**
 * How far back a routine resync re-reads.
 *
 * Sleeper backfills. A transaction can land in our table carrying a
 * `created_at_sleeper` EARLIER than one we have already projected, because the
 * week it belongs to was refetched. Re-reading a week's worth every time picks
 * those up; the unique dedupe key makes the overlap free.
 */
const TRANSACTION_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounds a first-run backfill so one cold page load cannot read a whole era. */
const TRANSACTION_BACKFILL_LIMIT = 2000;

/** Sleeper's own ceiling. Matches MAX_MATCHUP_WEEK in lib/league-matchups.ts. */
const MAX_PROJECTED_WEEK = 18;

export interface ProjectionResult {
  transactions: number;
  results: number;
}

/**
 * Project both, and never fail the caller.
 *
 * Runs after `pulseLeagueDerived` has persisted transactions and matchups, so
 * it always reads a settled table rather than one being written underneath it.
 */
export async function projectLeagueActivity(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  /**
   * The league's own current week, from Sleeper's `settings.leg`.
   *
   * Required, and not optional, because it is what decides whether a game has
   * been played. Null means we do not know, and the result half is skipped
   * rather than guessed at.
   */
  currentWeek: number | null,
): Promise<ProjectionResult> {
  const [transactions, results] = await Promise.all([
    projectTransactions(supabase, leagueRowId).catch((err: Error) => {
      console.warn(`[league-activity] transaction projection failed: ${err.message}`);
      return 0;
    }),
    projectMatchupResults(supabase, leagueRowId, season, currentWeek).catch((err: Error) => {
      console.warn(`[league-activity] result projection failed: ${err.message}`);
      return 0;
    }),
  ]);
  return { transactions, results };
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

async function projectTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<number> {
  // The gate. One indexed row: the newest transaction already recorded. Without
  // it every sync would re-read and re-upsert the league's entire history to
  // discover that all of it is already there.
  const { data: newest } = await supabase
    .from("league_activity")
    .select("occurred_at")
    .eq("league_id", leagueRowId)
    .eq("category", "transaction")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let query = supabase
    .from("league_transactions")
    // NOT `metadata`. That column holds the FULL raw Sleeper transaction, and
    // the only thing this needs out of it is one number. Selecting the whole
    // object made a routine resync pull a couple of hundred kilobytes of JSON
    // to discover that every row was already recorded. PostgREST can project
    // the single field instead, so the row comes back with a scalar on it.
    .select(
      "sleeper_transaction_id, type, status, week, season, adds, drops, draft_picks, waiver_budget, roster_ids, created_at_sleeper, waiver_bid:metadata->settings->waiver_bid",
    )
    .eq("league_id", leagueRowId)
    .not("created_at_sleeper", "is", null)
    .order("created_at_sleeper", { ascending: false })
    .limit(TRANSACTION_BACKFILL_LIMIT);

  if (newest?.occurred_at) {
    const from = new Date(
      new Date(newest.occurred_at).getTime() - TRANSACTION_OVERLAP_MS,
    ).toISOString();
    query = query.gte("created_at_sleeper", from);
  }

  // THE KEYS WE ALREADY HOLD FOR THAT SAME WINDOW, read in the same wave.
  //
  // Without this the steady state was an `INSERT ... ON CONFLICT DO NOTHING`
  // for a week of rows that all already existed, on every sync, forever. That
  // is not free: Postgres speculatively inserts each row, detects the conflict
  // and kills the tuple, which dirties heap pages, writes WAL and leaves work
  // for autovacuum. The index-scan counter told the story plainly, 641 probes
  // against 119 stored rows. Reading the keys costs the same one round trip the
  // write cost, and in the common case there is then nothing to write at all.
  const keysQuery = newest?.occurred_at
    ? supabase
        .from("league_activity")
        .select("dedupe_key")
        .eq("league_id", leagueRowId)
        .eq("category", "transaction")
        .gte(
          "occurred_at",
          new Date(new Date(newest.occurred_at).getTime() - TRANSACTION_OVERLAP_MS).toISOString(),
        )
    : null;

  const [{ data: rows, error }, keyResult] = await Promise.all([
    query,
    keysQuery ?? Promise.resolve({ data: [] as Array<{ dedupe_key: string }>, error: null }),
  ]);
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return 0;

  const known = new Set((keyResult.data ?? []).map((r) => r.dedupe_key));
  const events: PendingActivity[] = [];
  for (const row of rows) {
    const built = buildTransactionEvent(row);
    // `writeActivity` prefixes the league id onto the key, so compare against
    // the prefixed form rather than the builder's.
    if (built && !known.has(`${leagueRowId}:${built.dedupeKey}`)) events.push(built);
  }

  return writeActivity(supabase, leagueRowId, events);
}

type TransactionRow = {
  sleeper_transaction_id: string;
  type: string;
  status: string | null;
  week: number | null;
  season: number | null;
  adds: Json;
  drops: Json;
  draft_picks: Json;
  waiver_budget: Json;
  roster_ids: Json;
  created_at_sleeper: string | null;
  /** Projected out of `metadata.settings.waiver_bid`. See the select above. */
  waiver_bid?: unknown;
};

/**
 * One transaction becomes one event.
 *
 * A FAILED waiver claim is not activity. Sleeper records every losing bid with
 * `status: 'failed'`, and a league of twelve managers bidding on one running
 * back would produce eleven cards about a player who did not move.
 */
export function buildTransactionEvent(row: TransactionRow): PendingActivity | null {
  if (!row.created_at_sleeper) return null;
  const status = (row.status ?? "").toLowerCase();
  if (status && status !== "complete") return null;

  const kind = transactionKind(row.type);
  if (!kind) return null;

  const adds = asIdMap(row.adds);
  const drops = asIdMap(row.drops);
  const rosterIds = asNumberList(row.roster_ids);
  const picks = readPicks(row.draft_picks);
  const budget = asBudget(row.waiver_budget);

  // A transaction that moves nothing at all is Sleeper bookkeeping, not news.
  if (
    Object.keys(adds).length === 0 &&
    Object.keys(drops).length === 0 &&
    picks.length === 0 &&
    budget.length === 0
  ) {
    return null;
  }

  const playerIds = [...new Set([...Object.keys(adds), ...Object.keys(drops)])];

  // A MOVE THAT TOUCHES TWO ROSTERS NEEDS TWO SIDES, whatever Sleeper calls it.
  //
  // The flat `{rosterId, adds, drops}` shape throws away the per-player roster
  // mapping `asIdMap` just built, which is fine for a waiver claim (one team)
  // and wrong for a commissioner-executed trade: with `adds = {X: 3}` and
  // `drops = {Y: 5}` the card said "Team 3 swapped X in for Y" when it was Team
  // 5 who gave Y up, and nothing in the stored payload could recover that.
  const involved = new Set<number>([
    ...rosterIds,
    ...Object.values(adds).map(Number),
    ...Object.values(drops).map(Number),
  ]);
  const twoSided = kind === "trade" || involved.size > 1;

  const payload = twoSided
    ? { sides: tradeSides(rosterIds, adds, drops, picks, budget) }
    : {
        rosterId: rosterIds[0] ?? null,
        adds: Object.keys(adds),
        drops: Object.keys(drops),
        bid: readWaiverBid(row.waiver_bid),
        status: row.status ?? null,
        // Sleeper's own word for this move, kept so the card's deep link can
        // filter the transactions page by the type that page actually stores.
        sleeperType: row.type ?? null,
      };

  return {
    kind,
    // The Sleeper transaction id is already unique and already stable, so the
    // key needs nothing else. A resync of the same week re-derives the same key
    // and the insert is a no-op.
    dedupeKey: `tx:${row.sleeper_transaction_id}`,
    occurredAt: row.created_at_sleeper,
    precision: "exact",
    observedFrom: null,
    season: row.season == null ? null : Number(row.season),
    week: row.week == null ? null : Number(row.week),
    rosterIds,
    playerIds,
    payload,
  };
}

function transactionKind(type: string): ActivityKind | null {
  switch ((type ?? "").toLowerCase()) {
    case "trade":
      return "trade";
    case "waiver":
      return "waiver";
    case "free_agent":
      return "free_agent";
    case "commissioner":
      return "commissioner_move";
    default:
      // An unknown Sleeper type is filed as a commissioner move rather than
      // dropped: it happened, and a card that names the assets is better than
      // silence even when we cannot name the mechanism. `sleeperType` on the
      // payload keeps the original word so the deep link still lands on rows.
      return "commissioner_move";
  }
}

/**
 * Who got what.
 *
 * Sleeper describes a trade as one flat set of adds and drops keyed by roster,
 * which is correct and unreadable. A card needs two columns, so the flat form
 * is regrouped per roster here, once, at write time.
 */
function tradeSides(
  rosterIds: number[],
  adds: Record<string, number>,
  drops: Record<string, number>,
  picks: Array<ActivityPickRef & { ownerRosterId: number | null }>,
  budget: Array<{ sender: number; receiver: number; amount: number }>,
): Array<{
  rosterId: number;
  players: string[];
  picks: ActivityPickRef[];
  faab: number;
}> {
  // Every roster the trade touches, including one that only sent something.
  const involved = new Set<number>(rosterIds);
  for (const rid of Object.values(adds)) involved.add(Number(rid));
  for (const rid of Object.values(drops)) involved.add(Number(rid));
  for (const p of picks) if (p.ownerRosterId != null) involved.add(p.ownerRosterId);
  for (const b of budget) {
    involved.add(b.receiver);
    involved.add(b.sender);
  }

  return [...involved]
    .filter((r) => Number.isFinite(r))
    .sort((a, b) => a - b)
    .map((rosterId) => ({
      rosterId,
      players: Object.entries(adds)
        .filter(([, rid]) => Number(rid) === rosterId)
        .map(([pid]) => pid),
      picks: picks
        .filter((p) => p.ownerRosterId === rosterId)
        .map(({ season, round, originalRosterId }) => ({
          season,
          round,
          originalRosterId,
        })),
      faab: budget
        .filter((b) => b.receiver === rosterId)
        .reduce((sum, b) => sum + (Number.isFinite(b.amount) ? b.amount : 0), 0),
    }));
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

async function projectMatchupResults(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  currentWeek: number | null,
): Promise<number> {
  if (!Number.isFinite(season) || season <= 0) return 0;
  // We cannot tell a played week from an unplayed one without knowing where the
  // league is. Skipping beats guessing: a wrong answer here invents results.
  if (currentWeek == null || !Number.isFinite(currentWeek) || currentWeek <= 1) return 0;

  // WHICH WEEKS STILL NEED READING.
  //
  // The gate used to be "the furthest week already recorded, and everything
  // after it", which permanently skipped any earlier week that became readable
  // late. `syncLeagueMatchups` tolerates and reports `failedWeeks`, so a
  // throttled fetch for week 5 while week 6 succeeded is a normal Tuesday, and
  // week 5 would then never have been looked at again. Keying on which weeks
  // are MISSING has no such hole.
  //
  // The most recently played week is re-read even when it is recorded, because
  // a game inside it can settle after we first saw the week.
  const { data: recordedRows, error: recordedErr } = await supabase
    .from("league_activity")
    .select("week")
    .eq("league_id", leagueRowId)
    .eq("kind", "matchup_result")
    .eq("season", season);
  if (recordedErr) throw new Error(recordedErr.message);

  const recorded = new Set((recordedRows ?? []).map((r) => Number(r.week)));
  const targets: number[] = [];
  for (let week = 1; week < Math.min(currentWeek, MAX_PROJECTED_WEEK + 1); week += 1) {
    if (!recorded.has(week) || week >= currentWeek - 1) targets.push(week);
  }
  if (targets.length === 0) return 0;

  const { data: rows, error } = await supabase
    .from("league_matchups")
    .select("week, matchup_id, sleeper_roster_id, points, starter_ids, player_points")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .in("week", targets)
    .not("matchup_id", "is", null);
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return 0;

  const events = buildMatchupResultEvents(season, rows);

  return writeActivity(supabase, leagueRowId, events);
}

/** One row of `league_matchups` as the grouper needs it. */
export interface MatchupRow {
  week: number;
  matchup_id: number | null;
  sleeper_roster_id: number;
  points: number | null;
  starter_ids: Json;
  player_points: Json;
}

/**
 * Rows into games, and games into events. Pure, so the rules below are testable.
 *
 * ONE CARD PER MATCHUP, carrying both the win and the loss. The two rosters in a
 * game arrive as two rows, and emitting an event per row is exactly the double
 * post this feature must not do.
 *
 * FINALITY IS DECIDED HERE, NOT READ OFF `is_final`.
 *
 * `league_matchups.is_final` is stamped at WRITE time as
 * `week < currentWeek && points > 0`, and `weeksToFetch` only refetches the
 * current week and the two ahead of it. Sleeper publishes the whole slate at
 * league creation, so after the first sync every week is already stored, and
 * week N's row is last written while N IS the current week. The flag is
 * therefore false forever for any league synced normally, and trusting it left
 * the Results category permanently empty.
 *
 * The same re-derivation fixes a second case the flag gets wrong: a manager who
 * starts nobody scores 0.0, which makes their own row non-final and would have
 * swallowed their opponent's win. A game counts as played when SOMEBODY scored.
 */
export function buildMatchupResultEvents(
  season: number,
  rows: MatchupRow[],
): PendingActivity[] {
  const games = new Map<string, MatchupRow[]>();
  for (const row of rows) {
    if (row.matchup_id == null) continue;
    const key = `${row.week}:${row.matchup_id}`;
    const bucket = games.get(key);
    if (bucket) bucket.push(row);
    else games.set(key, [row]);
  }

  const events: PendingActivity[] = [];
  for (const [, sidesRows] of games) {
    // A game with one row is a roster Sleeper left unpaired. There is no
    // opponent, so there is no result to report.
    if (sidesRows.length !== 2) continue;

    const week = Number(sidesRows[0].week);
    const sides = sidesRows
      .map((r) => ({
        rosterId: Number(r.sleeper_roster_id),
        points: round2(Number(r.points ?? 0)),
        benchPoints: benchPointsOf(r.starter_ids, r.player_points),
      }))
      .sort((a, b) => b.points - a.points || a.rosterId - b.rosterId);

    if (sides[0].points <= 0) continue;

    const margin = round2(sides[0].points - sides[1].points);

    events.push({
      kind: "matchup_result",
      // Keyed on the LOWEST roster id in the game, matching how the relay's
      // recap key is built, so the two features can never disagree about what
      // counts as one game.
      dedupeKey: `game:${season}:${week}:${Math.min(...sides.map((s) => s.rosterId))}`,
      occurredAt: nflWeekEndUtc(season, week),
      // Settled facts, unsettled clock. See the header.
      precision: "observed",
      observedFrom: null,
      season,
      week,
      rosterIds: sides.map((s) => s.rosterId),
      playerIds: [],
      payload: {
        matchupId: Number(sidesRows[0].matchup_id),
        sides,
        margin,
        tie: margin === 0,
      },
    });
  }

  return events;
}

/**
 * What the bench scored.
 *
 * The single most quoted number in fantasy football and the one Sleeper does
 * not publish: it is every player on the roster who was not in the lineup. A
 * null here is honest (Sleeper sent no per-player points for that week) and the
 * card omits the stat rather than printing a zero, which would read as "your
 * bench did nothing" when it means "we do not know".
 */
export function benchPointsOf(starterIds: Json, playerPoints: Json): number | null {
  if (!playerPoints || typeof playerPoints !== "object" || Array.isArray(playerPoints)) {
    return null;
  }
  const points = playerPoints as Record<string, unknown>;
  if (Object.keys(points).length === 0) return null;

  const starters = new Set(
    Array.isArray(starterIds)
      ? (starterIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
  );

  let total = 0;
  for (const [pid, value] of Object.entries(points)) {
    if (starters.has(pid)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return round2(total);
}

/**
 * When an NFL week ended, near enough to sort a feed by.
 *
 * The problem this solves is ORDERING, not display. A result has no timestamp
 * anywhere in our data, and using the row's `synced_at` would drop an entire
 * backfilled season onto one instant at the top of the feed, above transactions
 * that happened months earlier. So the week itself supplies the position.
 *
 * THE RULE: week 1 ends on the first Tuesday on or after September 9, and every
 * later week ends seven days after the one before it. That lands on the real
 * Tuesday after Monday Night Football for every season from 2020 through 2026,
 * because the NFL opens on the Thursday after Labor Day and Labor Day is the
 * first Monday of September. 09:00 UTC is 5am Eastern, comfortably after the
 * last snap of Monday night and before anybody's Tuesday waivers.
 *
 * The card never prints this as a clock time. It says "Week 6, final" and the
 * date, which is what we actually know.
 */
export function nflWeekEndUtc(season: number, week: number): string {
  const sept9 = new Date(Date.UTC(season, 8, 9, 9, 0, 0));
  // getUTCDay: 0 Sunday, 2 Tuesday. Walk forward to the first Tuesday.
  const daysToTuesday = (2 - sept9.getUTCDay() + 7) % 7;
  const anchor = sept9.getTime() + daysToTuesday * 86_400_000;
  const safeWeek = Number.isFinite(week) && week > 0 ? week : 1;
  return new Date(anchor + (safeWeek - 1) * 7 * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Readers                                                                    */
/* -------------------------------------------------------------------------- */

function asIdMap(value: Json): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [pid, rid] of Object.entries(value as Record<string, unknown>)) {
    // "0" is Sleeper's empty-slot placeholder, never a player.
    if (!pid || pid === "0") continue;
    const n = Number(rid);
    if (Number.isFinite(n)) out[pid] = n;
  }
  return out;
}

function asNumberList(value: Json): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function asBudget(value: Json): Array<{ sender: number; receiver: number; amount: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return {
        sender: Number(r.sender),
        receiver: Number(r.receiver),
        amount: Number(r.amount),
      };
    })
    .filter((b) => Number.isFinite(b.sender) && Number.isFinite(b.receiver));
}

/**
 * The picks a transaction moved.
 *
 * Sleeper sends `draft_picks` as an array, an object, a JSON string, or null,
 * which is why `normalizeDraftPicks` exists and why it is used here rather than
 * a fresh `Array.isArray` check.
 */
function readPicks(value: Json): Array<ActivityPickRef & { ownerRosterId: number | null }> {
  return normalizeDraftPicks(value)
    .map((raw) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      const season = Number(p.season);
      const round = Number(p.round);
      if (!Number.isFinite(season) || !Number.isFinite(round)) return null;
      const owner = Number(p.owner_id);
      // `roster_id` is the IMMUTABLE original owner, which is how a pick is
      // named ("Team 4's 2027 first"). `owner_id` is who holds it now.
      const original = Number(p.roster_id);
      return {
        season,
        round,
        originalRosterId: Number.isFinite(original) ? original : null,
        ownerRosterId: Number.isFinite(owner) ? owner : null,
      };
    })
    .filter((p): p is ActivityPickRef & { ownerRosterId: number | null } => p !== null);
}

/**
 * What a waiver claim cost.
 *
 * Sleeper puts the winning bid in `settings.waiver_bid` ON THE TRANSACTION, and
 * the query above projects exactly that field, so this receives the value
 * rather than the object.
 *
 * `waiver_budget` is a different thing entirely: FAAB moving between two
 * managers as part of a trade. Reading the second as the first would report
 * every claim as free, which is why it is nowhere near this function.
 *
 * `lib/league-relay/load.ts readFaabBid` makes the same distinction for
 * Discord. It is deliberately not imported: this runs inside the league sync,
 * and the sync must not take a dependency on a downstream feature to coerce one
 * number. If a third caller appears, promote it to a shared leaf the way
 * `normalizeDraftPicks` was promoted.
 */
function readWaiverBid(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const bid = Number(value);
  return Number.isFinite(bid) ? bid : null;
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
