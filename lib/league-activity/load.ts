import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { teamLabelParts } from "@/lib/team-label";
import { resolveSleeperPlayers } from "@/lib/sleeper-player-lookup";
import { buildActivityCard } from "./writeup";
import {
  ACTIVITY_CATEGORY_OF,
  isActivityCategory,
  type ActivityCard,
  type ActivityCategory,
  type ActivityContext,
  type ActivityEvent,
  type ActivityKind,
  type ActivityPrecision,
} from "./types";

/**
 * Reading the feed.
 *
 * THREE QUERIES, ALWAYS, whatever the filters are:
 *
 *   1. the events in the window
 *   2. one probe row older than the window, so the footer knows whether "load
 *      more" has anything to load
 *   3. the league's rosters and members, for the names on the cards
 *
 * plus a fourth for the players named in the rows we actually returned. That
 * last one is bounded by what is on screen, not by the size of the log.
 *
 * THE WINDOW IS DAYS, NOT AN OFFSET, and that is a product decision rather than
 * a convenience. A reader asking for more history means "show me further back",
 * not "show me rows 26 to 50". A day window is also stable while the league is
 * syncing underneath it: an offset shifts every time a new event lands at the
 * top, so page two silently repeats or skips rows. A date cutoff cannot.
 *
 * NOTHING HERE COMPUTES ANYTHING. Every number a card shows was settled when
 * the event was written. No valuation runs on this path, no projection, no
 * lineup optimisation. That is what lets the panel sit above the power rankings
 * without slowing the page down: it is one indexed read and some string work.
 */

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * The ladder "load more" climbs.
 *
 * Fourteen days is the default because it covers a fortnight of a season: last
 * week's results, this week's moves, and the lineup churn in between. Each rung
 * roughly doubles, so three presses reach a full season without a control that
 * needs a number typed into it.
 */
// 7 exists so NARROWING has somewhere to go from the default.
//
// The panel offers a narrower window when the row cap has truncated the view,
// because widening would return the same rows. With 14 as both the default and
// the bottom rung, narrowerRung(14) had nothing below it and returned 14: the
// footer rendered a link reading "Narrow to the last 14 days" pointing at the
// window the reader was already on. Following it reloaded identical content and
// moved focus to the panel heading, which is indistinguishable from a broken
// control because it was one. That branch became the common case when the log
// stopped having a full-length page to escape to.
export const ACTIVITY_WINDOW_LADDER = [7, 14, 30, 60, 120] as const;

/** Zero means the whole log, which is the last rung. */
export const ACTIVITY_WINDOW_ALL = 0;

export const ACTIVITY_DEFAULT_DAYS = 14;

/**
 * The most cards one render will paint.
 *
 * A league that has been synced all season can hold a few thousand events, and
 * "show me everything" must not mean "serialise four thousand cards into the
 * page". When the cap bites, the footer says so rather than quietly stopping.
 */
export const ACTIVITY_MAX_ROWS = 200;

/** What the compact overview panel shows before its own footer link. */
export const ACTIVITY_PANEL_ROWS = 40;

export interface ActivityQuery {
  leagueRowId: string;
  sleeperLeagueId: string;
  /** Days back from now. `ACTIVITY_WINDOW_ALL` for the whole log. */
  days: number;
  category: ActivityCategory | null;
  /** Sleeper roster id, when the reader has narrowed to one team. */
  rosterId: number | null;
  limit: number;
  searchedUsername: string | null;
  /** Fixed by the caller so every card on one page agrees about "now". */
  nowMs?: number;
}

export interface LoadedActivity {
  cards: ActivityCard[];
  /** How many events the window holds, before the row cap. */
  shown: number;
  /** True when at least one event exists before the window's cutoff. */
  hasOlder: boolean;
  /** True when the row cap truncated the window. */
  truncated: boolean;
  /** The next rung of the ladder, or null at the end of it. */
  nextDays: number | null;
  /** Every category present in the window, for the filter chips. */
  availableCategories: ActivityCategory[];
  /** The teams in this league, for the team filter. */
  teams: Array<{ rosterId: number; label: string }>;
  /** Null when the log is genuinely empty for this league. */
  oldestShown: string | null;
}

export async function loadLeagueActivity(
  supabase: AnySupabase,
  query: ActivityQuery,
): Promise<LoadedActivity> {
  const db = supabase as SupabaseClient<Database>;
  const nowMs = query.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(query.limit, ACTIVITY_MAX_ROWS));
  const cutoff =
    query.days > 0 ? new Date(nowMs - query.days * 86_400_000).toISOString() : null;

  let rowsQuery = db
    .from("league_activity")
    .select(
      "id, kind, category, occurred_at, occurred_at_precision, observed_from, season, week, roster_ids, player_ids, payload",
    )
    .eq("league_id", query.leagueRowId)
    .order("occurred_at", { ascending: false })
    // One extra, purely to detect that the cap bit. Dropped before rendering.
    .limit(limit + 1);

  if (cutoff) rowsQuery = rowsQuery.gte("occurred_at", cutoff);
  if (query.category) rowsQuery = rowsQuery.eq("category", query.category);
  if (query.rosterId != null) rowsQuery = rowsQuery.contains("roster_ids", [query.rosterId]);

  // The probe. One row, or none. A count would have to walk the whole tail to
  // answer a question the footer only needs a yes or no for.
  const olderProbe = cutoff
    ? (() => {
        let q = db
          .from("league_activity")
          .select("id")
          .eq("league_id", query.leagueRowId)
          .lt("occurred_at", cutoff)
          .limit(1);
        if (query.category) q = q.eq("category", query.category);
        if (query.rosterId != null) q = q.contains("roster_ids", [query.rosterId]);
        return q;
      })()
    : null;

  const [rowsResult, olderResult, identities] = await Promise.all([
    rowsQuery,
    olderProbe ?? Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    loadTeamIdentities(db, query.leagueRowId),
  ]);

  if (rowsResult.error) {
    throw new Error(`load league_activity failed: ${rowsResult.error.message}`);
  }

  const raw = rowsResult.data ?? [];
  const truncated = raw.length > limit;
  const rows = truncated ? raw.slice(0, limit) : raw;

  const events: ActivityEvent[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as ActivityKind,
    category: (isActivityCategory(r.category)
      ? r.category
      : ACTIVITY_CATEGORY_OF[r.kind as ActivityKind]) as ActivityCategory,
    occurredAt: r.occurred_at,
    precision: r.occurred_at_precision as ActivityPrecision,
    observedFrom: r.observed_from,
    season: r.season,
    week: r.week,
    rosterIds: Array.isArray(r.roster_ids) ? r.roster_ids.map(Number) : [],
    playerIds: Array.isArray(r.player_ids) ? r.player_ids : [],
    payload: asRecord(r.payload),
  }));

  // Only the players actually on screen. A card names at most a dozen, so this
  // is one small query however long the log is.
  const playerIds = new Set<string>();
  for (const e of events) {
    for (const id of e.playerIds) playerIds.add(id);
    for (const id of collectPayloadPlayerIds(e.payload)) playerIds.add(id);
  }
  const players = await resolveSleeperPlayers(db, [...playerIds]);

  const ctx: ActivityContext = {
    sleeperLeagueId: query.sleeperLeagueId,
    teams: identities.byRoster,
    players,
    searchedUsername: query.searchedUsername,
    nowMs,
  };

  const cards = events.map((e) => buildActivityCard(e, ctx));

  return {
    cards,
    shown: cards.length,
    hasOlder: (olderResult.data?.length ?? 0) > 0,
    truncated,
    nextDays: nextRung(query.days),
    availableCategories: [...new Set(events.map((e) => e.category))],
    teams: identities.list,
    oldestShown: events.length > 0 ? events[events.length - 1].occurredAt : null,
  };
}

/** The rung after this one, or null when there is nothing further back to ask for. */
export function nextRung(days: number): number | null {
  if (days === ACTIVITY_WINDOW_ALL) return null;
  const next = ACTIVITY_WINDOW_LADDER.find((d) => d > days);
  return next ?? ACTIVITY_WINDOW_ALL;
}

/** Whatever arrived in the URL, clamped to a rung we actually serve. */
export function parseWindowDays(value: unknown): number {
  if (value === "all") return ACTIVITY_WINDOW_ALL;
  const n = Number(value);
  if (!Number.isFinite(n)) return ACTIVITY_DEFAULT_DAYS;
  if (n === ACTIVITY_WINDOW_ALL) return ACTIVITY_WINDOW_ALL;
  // Snap to the ladder rather than honouring an arbitrary number, so a crafted
  // link cannot ask for a window nobody designed a footer sentence for.
  return ACTIVITY_WINDOW_LADDER.includes(n as (typeof ACTIVITY_WINDOW_LADDER)[number])
    ? n
    : ACTIVITY_DEFAULT_DAYS;
}

/**
 * A Sleeper roster id from the URL, or null.
 *
 * THE RANGE CHECK IS THE POINT. `roster_ids` is `integer[]`, so Postgres rejects
 * anything outside int4 outright, and `loadLeagueActivity` throws on a query
 * error. Since the panel lives on the league OVERVIEW, `?ateam=99999999999`
 * took down that whole page rather than just the log:
 *
 *   ERROR 22003: value "99999999999" is out of range for type integer
 *
 * `Number.isFinite` alone accepts it, and `1e21` parses to 1 under parseInt but
 * reaches Postgres as "1e+21" if passed through unparsed. A league cannot have
 * more rosters than int2 holds, so the ceiling is generous and still safe.
 */
export function parseRosterId(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n <= 32767 ? n : null;
}

/** "the last 14 days", "the whole log". Used in the panel helper and the footer. */
export function describeWindow(days: number): string {
  return days === ACTIVITY_WINDOW_ALL ? "everything on record" : `the last ${days} days`;
}

/* -------------------------------------------------------------------------- */
/* Identities                                                                 */
/* -------------------------------------------------------------------------- */

async function loadTeamIdentities(
  db: SupabaseClient<Database>,
  leagueRowId: string,
): Promise<{
  byRoster: ActivityContext["teams"];
  list: Array<{ rosterId: number; label: string }>;
}> {
  const [{ data: rosterRows }, { data: userRows }] = await Promise.all([
    db
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true }),
    db
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
  ]);

  const userById = new Map((userRows ?? []).map((u) => [u.sleeper_user_id, u]));
  const byRoster: ActivityContext["teams"] = {};
  const list: Array<{ rosterId: number; label: string }> = [];

  for (const r of rosterRows ?? []) {
    const u = r.owner_user_id ? userById.get(r.owner_user_id) : null;
    // One formatter for every team name on the site. See lib/team-label.ts.
    const parts = teamLabelParts({
      teamName: u?.team_name ?? null,
      username: u?.display_name ?? null,
      sleeperRosterId: r.sleeper_roster_id,
    });
    byRoster[r.sleeper_roster_id] = {
      label: parts.primary,
      owner: parts.owner,
      avatarId: u?.avatar ?? null,
    };
    list.push({ rosterId: r.sleeper_roster_id, label: parts.primary });
  }

  return { byRoster, list };
}

/* -------------------------------------------------------------------------- */
/* Payload readers                                                            */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Player ids buried inside a payload.
 *
 * `player_ids` on the row is the index for a future per-player view and is
 * deliberately not populated for every kind: a trade's players live inside its
 * `sides`, and a waiver's inside `adds` and `drops`. The renderer needs names
 * for all of them, so this walks the two shapes that carry them.
 */
function collectPayloadPlayerIds(payload: Record<string, unknown>): string[] {
  const out: string[] = [];

  const push = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const v of value) if (typeof v === "string" && v) out.push(v);
  };

  push(payload.adds);
  push(payload.drops);
  push(payload.started);
  push(payload.benched);
  push(payload.toReserve);
  push(payload.fromReserve);
  push(payload.toTaxi);
  push(payload.fromTaxi);

  if (Array.isArray(payload.sides)) {
    for (const side of payload.sides) {
      if (side && typeof side === "object") push((side as Record<string, unknown>).players);
    }
  }

  return out;
}
