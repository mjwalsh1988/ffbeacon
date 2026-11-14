/**
 * Playoff state: what the stored Sleeper bracket says has happened, and what
 * each team's place in it is.
 *
 * Pure. lib/power-pulse/load.ts reads the brackets off leagues.metadata (the
 * league sync merges them in under `brackets`) and hands them here as plain
 * data, and the engine and the orchestrator both call these helpers so the
 * playoff answer is worked out one way.
 *
 * What the brackets look like, confirmed against production on 2026-11-13: a
 * match carries `r` (round), `m` (id), `t1`/`t2` (roster ids, null until
 * known), `w`/`l` (null until played), an optional `p` (the place the match
 * decides: 1 is the title game, 3 and 5 decide lower places) and optional
 * `t1_from`/`t2_from` links ({ w: m } or { l: m }) in a fixed bracket. A
 * reseeded bracket has no links in its later rounds, and its losers' games
 * carry no `p` either, so a match is a TITLE game only when nobody in it has
 * already lost one and it is not fed by a loser.
 */

import type { SleeperBracketMatch } from "@/lib/sleeper";
import { divisionsFor, pairKey, seedIndices } from "./simulate";

/** Where a league is in its season, as the Power Pulse page draws it. */
export type PlayoffPhase = "regular" | "playoffs" | "complete";

/** One team's place in the postseason. */
export type TeamPlayoffState = {
  phase: PlayoffPhase;
  /** Seed in the field once the regular season is over. Null before that and for a team that missed. */
  seed: number | null;
  /**
   * Null in the regular season. "alive" still has a title chance, "eliminated"
   * lost a title game, "missed" did not make the field, "champion" won it.
   */
  status: "alive" | "eliminated" | "missed" | "champion" | null;
  /** The final place, 1 for the champion, once the title game is played. Null before. */
  finalPlace: number | null;
};

/** What a winners bracket says has already happened. */
export type BracketFacts = {
  /** Title games with a result, keyed by pairKey, to the winner. */
  played: Map<string, number>;
  /** Rosters that have lost a title game. */
  eliminated: Set<number>;
  /** Every roster that appears in a title game, in bracket order. */
  field: number[];
  championRosterId: number | null;
  runnerUpRosterId: number | null;
};

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

function linkOrNull(v: unknown): { w?: number; l?: number } | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as Record<string, unknown>;
  const w = intOrNull(raw.w);
  const l = intOrNull(raw.l);
  if (w !== null) return { w };
  if (l !== null) return { l };
  return null;
}

/**
 * A stored bracket, checked. Null when it is absent or not an array; matches
 * without a numeric round and id are dropped.
 */
export function parseBracket(raw: unknown): SleeperBracketMatch[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SleeperBracketMatch[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const m = intOrNull(e.m);
    const r = intOrNull(e.r);
    if (m === null || r === null) continue;
    const p = intOrNull(e.p);
    out.push({
      m,
      r,
      t1: intOrNull(e.t1),
      t2: intOrNull(e.t2),
      w: intOrNull(e.w),
      l: intOrNull(e.l),
      ...(p !== null ? { p } : {}),
      t1_from: linkOrNull(e.t1_from),
      t2_from: linkOrNull(e.t2_from),
    });
  }
  return out;
}

/** Read the played title games, the eliminated, the field and the champion. */
export function bracketFacts(
  bracket: readonly SleeperBracketMatch[] | null | undefined,
): BracketFacts {
  const facts: BracketFacts = {
    played: new Map(),
    eliminated: new Set(),
    field: [],
    championRosterId: null,
    runnerUpRosterId: null,
  };
  if (!bracket || bracket.length === 0) return facts;

  const sorted = [...bracket].sort((a, b) => a.r - b.r || a.m - b.m);
  const titleMatch = new Set<number>();
  const inField = new Set<number>();
  const rounds = [...new Set(sorted.map((m) => m.r))];

  for (const round of rounds) {
    const losersThisRound: number[] = [];
    for (const match of sorted.filter((m) => m.r === round)) {
      if (match.p !== undefined && match.p !== null && match.p !== 1) continue;
      const links = [match.t1_from, match.t2_from].filter(
        (l): l is { w?: number; l?: number } => Boolean(l),
      );
      if (links.some((l) => l.l !== undefined)) continue;
      if (links.some((l) => l.w !== undefined && !titleMatch.has(l.w))) continue;
      const sides = [match.t1, match.t2].filter((t): t is number => t !== null);
      if (sides.some((t) => facts.eliminated.has(t))) continue;

      titleMatch.add(match.m);
      for (const t of sides) {
        if (!inField.has(t)) {
          inField.add(t);
          facts.field.push(t);
        }
      }
      if (match.w !== null && match.l !== null && match.t1 !== null && match.t2 !== null) {
        facts.played.set(pairKey(match.t1, match.t2), match.w);
        losersThisRound.push(match.l);
        if (match.p === 1) {
          facts.championRosterId = match.w;
          facts.runnerUpRosterId = match.l;
        }
      }
    }
    for (const l of losersThisRound) facts.eliminated.add(l);
  }
  return facts;
}

/**
 * Places the brackets decide. A winners bracket match with `p` gives its
 * winner `p` and its loser `p + 1`. A consolation losers bracket
 * (playoff_type 1) decides the places after the field the same way; a toilet
 * bowl (playoff_type 0) is played for the bottom and its `w` does not mean a
 * higher place, so it decides nothing here.
 */
export function bracketPlacements(
  winners: readonly SleeperBracketMatch[] | null | undefined,
  losers: readonly SleeperBracketMatch[] | null | undefined,
  playoffType: number | undefined,
  fieldSize: number,
): Map<number, number> {
  const places = new Map<number, number>();
  const take = (matches: readonly SleeperBracketMatch[] | null | undefined, offset: number) => {
    for (const match of matches ?? []) {
      if (match.p === undefined || match.p === null) continue;
      if (match.w === null || match.l === null) continue;
      if (!places.has(match.w)) places.set(match.w, offset + match.p);
      if (!places.has(match.l)) places.set(match.l, offset + match.p + 1);
    }
  };
  take(winners, 0);
  if (playoffType === 1) take(losers, fieldSize);
  return places;
}

export type PlayoffTeamInput = {
  sleeperRosterId: number;
  wins: number;
  ties: number;
  pointsFor: number;
  division?: number | null;
};

export type PlayoffLeagueInput = {
  playoffTeams: number;
  divisions?: number;
  playoffType?: number;
  winnersBracket?: readonly SleeperBracketMatch[] | null;
  losersBracket?: readonly SleeperBracketMatch[] | null;
};

/**
 * Every team's playoff state.
 *
 * `regularSeasonOver` is the engine's own answer (no regular season week left
 * to play). Before that every team reads "regular". After it, the field is the
 * stored bracket's when it names the full field, else the top seeds of the
 * final standings, and once the title game is played the champion and the
 * final order are the real ones.
 */
export function playoffStates(
  teams: readonly PlayoffTeamInput[],
  league: PlayoffLeagueInput,
  regularSeasonOver: boolean,
): { phase: PlayoffPhase; states: Map<number, TeamPlayoffState>; facts: BracketFacts } {
  const facts = bracketFacts(league.winnersBracket);
  const states = new Map<number, TeamPlayoffState>();
  const phase: PlayoffPhase =
    facts.championRosterId !== null ? "complete" : regularSeasonOver ? "playoffs" : "regular";

  if (phase === "regular") {
    for (const t of teams) {
      states.set(t.sleeperRosterId, { phase, seed: null, status: null, finalPlace: null });
    }
    return { phase, states, facts };
  }

  const n = teams.length;
  const fieldSize = Math.max(0, Math.min(league.playoffTeams, n));
  const wins = teams.map((t) => t.wins + t.ties * 0.5);
  const points = teams.map((t) => t.pointsFor);
  const byRecord = seedIndices(n, wins, points, null, fieldSize);
  const order = seedIndices(n, wins, points, divisionsFor(teams, league.divisions), fieldSize);

  const ids = teams.map((t) => t.sleeperRosterId);
  const known = new Set(ids);
  const bracketField = facts.field.filter((id) => known.has(id));
  const field =
    bracketField.length === fieldSize
      ? order.map((i) => ids[i]).filter((id) => bracketField.includes(id))
      : order.slice(0, fieldSize).map((i) => ids[i]);
  const seedOf = new Map(field.map((id, i) => [id, i + 1]));

  let finalPlaceOf = new Map<number, number>();
  if (phase === "complete") {
    const placed = bracketPlacements(
      league.winnersBracket,
      league.losersBracket,
      league.playoffType,
      field.length,
    );
    // The champion and runner-up from the title game itself, whatever else
    // the bracket carries.
    if (facts.championRosterId !== null) placed.set(facts.championRosterId, 1);
    if (facts.runnerUpRosterId !== null) placed.set(facts.runnerUpRosterId, 2);
    // Everyone the brackets did not place, in order: the field first by seed,
    // then the rest of the league by record, into the places left open.
    const used = new Set(placed.values());
    const rest = [
      ...field.filter((id) => !placed.has(id)),
      ...byRecord.map((i) => ids[i]).filter((id) => !placed.has(id) && !seedOf.has(id)),
    ];
    let next = 1;
    for (const id of rest) {
      while (used.has(next)) next += 1;
      placed.set(id, next);
      used.add(next);
    }
    finalPlaceOf = placed;
  }

  for (const id of ids) {
    const seed = seedOf.get(id) ?? null;
    let status: TeamPlayoffState["status"];
    if (seed === null) status = "missed";
    else if (phase === "complete") status = id === facts.championRosterId ? "champion" : "eliminated";
    else status = facts.eliminated.has(id) ? "eliminated" : "alive";
    states.set(id, {
      phase,
      seed,
      status,
      finalPlace: phase === "complete" ? (finalPlaceOf.get(id) ?? null) : null,
    });
  }
  return { phase, states, facts };
}
