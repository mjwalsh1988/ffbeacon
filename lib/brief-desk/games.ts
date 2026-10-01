/**
 * The game-by-game datasets behind the premium edition (plan section 23):
 * one card per NFL game, the week-in-numbers awards, and the projection
 * report card.
 *
 *   week_games         one row per game: both teams, the final, the settled
 *                      line (spread, total, moneylines, open and close), and
 *                      what the line implied against what happened
 *   game_player_lines  one row per notable offensive player per game, keyed by
 *                      game_key: the box score as a sentence, PPR points, the
 *                      published projection, and the value move over the
 *                      edition's period in both edition formats
 *   week_awards        the week's superlatives, plus the bench-points figures
 *                      from the Manager Ledger across every graded league
 *   projection_report  how the projection did this week by position, and the
 *                      season's most and least reliable players against it
 *
 * Every builder is PURE: it takes rows the bundle already loaded and returns a
 * BundleDataset of plain cells, so a block renders exactly these figures and
 * the desk run has no path to put a number of its own on a card. The run
 * writes each game's headline, recap and fun-stat sentence (draft.games); the
 * numbers on the card are all here.
 *
 * Offense only. No value source prices a defender, a defender's projection is
 * a different scoring system, and a card that mixed them would need a second
 * set of columns to stay honest; the existing box_score_lines block still
 * carries defenders for the sections that cite one.
 *
 * Venue is CLAIMED here, unlike the schedule pages: the line's home team comes
 * from ESPN's scoreboard, which names a home side, so "ATL at GB" is a fact
 * this data actually holds.
 */

import { OFFENSE_POSITIONS } from "@/lib/site";
import type { BundleDataset, BundleWeekResult } from "./types";
import type { WeekLine } from "./datasets";

type Row = Record<string, string | number | null>;

/** The positions a card lists. Kickers and team defenses score, but are not who a reader came to see. */
export const CARD_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/** At most this many player rows travel per game; the card shows fewer. */
const PLAYERS_PER_GAME = 16;

/** A player row joins a card when he scored this many PPR points or was projected for this many. */
const CARD_MIN_POINTS = 3;
const CARD_MIN_PROJECTION = 6;

/** The bench-points figures need at least this many graded teams to say anything. */
export const BENCH_MIN_TEAMS = 40;

/** A "biggest miss" is only a miss when the projection was a real expectation. */
const MISS_MIN_PROJECTION = 10;

/** Season reliability lists need this many graded games per player. */
const SEASON_MIN_GRADED = 2;

/** Season laggards are only listed among players projected for this many a game. */
const LAGGARD_MIN_AVG_PROJECTION = 8;

/** Season leaders likewise: beating a two-point projection every week is not reliability. */
const LEADER_MIN_AVG_PROJECTION = 6;

export interface GameLineInput {
  espn_event_id: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  provider: string | null;
  open_home_spread: number | null;
  close_home_spread: number | null;
  open_game_total: number | null;
  close_game_total: number | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
}

export interface GameTeamInput {
  abbreviation: string;
  name: string;
  primary_color: string | null;
}

export interface ValueMove {
  start: number | null;
  end: number | null;
}

export interface GamePlayerInput {
  player_id: string;
  name: string;
  slug: string;
  position: string | null;
  /** The team he played FOR that week (player_stats.metadata.team), not today's team. */
  team: string | null;
  sleeper_id: string | null;
  line: WeekLine & { pass_lng?: number | null; rush_lng?: number | null; rec_lng?: number | null; gp?: number | null };
  /** The published projection for the week in PPR, or null when none was published. */
  projected: number | null;
  /** Keyed by edition format slug. */
  values: Record<string, ValueMove>;
}

export interface BenchWeekEntry {
  leagueId: string;
  pointsLeft: number;
  outcome: string | null;
  bestLineupOutcome: string | null;
  /**
   * The week's single best swap for that team. Only a swap with a real player
   * on the way out: the ledger also records a starter left in an EMPTY slot
   * ("an empty slot", no player id), which is a different mistake and is not a
   * bench call, so the loader drops it.
   */
  biggestMiss: { gain: number; inName: string; outName: string; inPoints: number; outPoints: number } | null;
}

export interface SeasonGradeInput {
  player_id: string;
  name: string;
  slug: string;
  position: string | null;
  team: string | null;
  sleeper_id: string | null;
  /** One entry per week the player had BOTH a published projection and a game. */
  weeks: Array<{ week: number; projected: number; actual: number }>;
}

export interface EditionFormatRef {
  slug: string;
  display: string;
  sourceDisplay: string | null;
}

function round1(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/** 4577 as "4,577". Values run into five figures and read better grouped. */
export function grouped(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [whole, frac] = String(Math.abs(n)).split(".");
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

function signed(n: number | null, digits = 1): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  const r = digits === 0 ? Math.round(n) : Math.round(n * 10 ** digits) / 10 ** digits;
  return r > 0 ? `+${grouped(r)}` : grouped(r);
}

/** "ATL-GB": away first, the way the line is read aloud. */
export function gameKey(away: string, home: string): string {
  return `${away.toUpperCase()}-${home.toUpperCase()}`;
}

export const GAME_KEY_PATTERN = /^[A-Z]{2,4}-[A-Z]{2,4}$/;

/** "GB -4.5", "PK", or null with no line. Home-relative input, favourite-relative output. */
export function spreadText(home: string, away: string, homeSpread: number | null): string | null {
  if (homeSpread === null || !Number.isFinite(homeSpread)) return null;
  if (homeSpread === 0) return "PK";
  return homeSpread < 0 ? `${home} ${homeSpread}` : `${away} -${homeSpread}`;
}

/** American odds as text, "+195" or "-238". */
export function moneylineText(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return n > 0 ? `+${n}` : String(n);
}

export type CoverResult = { team: string | null; text: string };

/**
 * Who covered. The home side covers when its margin plus its spread is above
 * zero (a 4.5-point home favourite who wins by 7 covers by 2.5).
 */
export function coverResult(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  homeSpread: number | null,
): CoverResult | null {
  if (homeSpread === null || !Number.isFinite(homeSpread)) return null;
  const ats = homeScore - awayScore + homeSpread;
  if (ats === 0) return { team: null, text: "Push against the spread" };
  const team = ats > 0 ? home : away;
  const line = ats > 0 ? homeSpread : -homeSpread;
  return { team, text: `${team} covered ${line > 0 ? `+${line}` : line === 0 ? "PK" : String(line)}` };
}

export function totalResult(points: number, total: number | null): "over" | "under" | "push" | null {
  if (total === null || !Number.isFinite(total)) return null;
  return points > total ? "over" : points < total ? "under" : "push";
}

/** The implied team totals a closing total and spread carry (lib/nfl-odds.ts impliedTotals, restated so this file stays I/O-free). */
function implied(total: number | null, homeSpread: number | null): { home: number | null; away: number | null } {
  if (total === null || homeSpread === null) return { home: null, away: null };
  return { home: total / 2 - homeSpread / 2, away: total / 2 + homeSpread / 2 };
}

export interface WeekGamesInput {
  season: number;
  week: number;
  lines: GameLineInput[];
  results: Map<string, BundleWeekResult>;
  teams: Map<string, GameTeamInput>;
  computedAt: string;
}

/**
 * week_games: one row per game that has BOTH a line row (which names the home
 * side) and a final score for each team. A game missing either is left out
 * rather than half-drawn; the source note counts how many were left out.
 */
export function buildWeekGamesDataset(input: WeekGamesInput): BundleDataset {
  const rows: Row[] = [];
  let missing = 0;
  const sorted = [...input.lines].sort(
    (a, b) => (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? "") || a.home_team.localeCompare(b.home_team),
  );
  for (const g of sorted) {
    const home = g.home_team.toUpperCase();
    const away = g.away_team.toUpperCase();
    const homeResult = input.results.get(home);
    const awayResult = input.results.get(away);
    if (!homeResult || !awayResult || homeResult.opponent !== away) {
      missing += 1;
      continue;
    }
    const homeScore = homeResult.points_for;
    const awayScore = awayResult.points_for;
    const combined = homeScore + awayScore;
    const cover = coverResult(home, away, homeScore, awayScore, g.close_home_spread);
    const ou = totalResult(combined, g.close_game_total);
    const imp = implied(g.close_game_total, g.close_home_spread);
    const winner = homeScore > awayScore ? home : awayScore > homeScore ? away : null;
    const winnerLine = winner === home ? g.home_moneyline : winner === away ? g.away_moneyline : null;
    const homeTeam = input.teams.get(home);
    const awayTeam = input.teams.get(away);
    rows.push({
      game_key: gameKey(away, home),
      season: input.season,
      week: input.week,
      espn_event_id: g.espn_event_id,
      kickoff_at: g.kickoff_at,
      away,
      home,
      away_name: awayTeam?.name ?? away,
      home_name: homeTeam?.name ?? home,
      away_color: awayTeam?.primary_color ?? null,
      home_color: homeTeam?.primary_color ?? null,
      away_score: awayScore,
      home_score: homeScore,
      winner,
      combined_points: combined,
      provider: g.provider,
      spread_text: spreadText(home, away, g.close_home_spread),
      open_spread_text: spreadText(home, away, g.open_home_spread),
      close_home_spread: g.close_home_spread,
      open_home_spread: g.open_home_spread,
      close_total: g.close_game_total,
      open_total: g.open_game_total,
      home_moneyline: g.home_moneyline,
      away_moneyline: g.away_moneyline,
      home_moneyline_text: moneylineText(g.home_moneyline),
      away_moneyline_text: moneylineText(g.away_moneyline),
      cover_team: cover?.team ?? null,
      cover_text: cover?.text ?? null,
      total_result: ou,
      home_implied: round1(imp.home),
      away_implied: round1(imp.away),
      // An underdog by the closing moneyline who won outright.
      upset: winner !== null && winnerLine !== null && winnerLine > 0 ? "yes" : "no",
      winner_moneyline: winnerLine,
      recap_url: g.espn_event_id ? `https://www.espn.com/nfl/game/_/gameId/${g.espn_event_id}` : null,
    });
  }
  return {
    id: "week_games",
    kind: "week_games",
    title: `Week ${input.week}, game by game`,
    columns: [
      "game_key", "season", "week", "espn_event_id", "kickoff_at", "away", "home", "away_name", "home_name",
      "away_color", "home_color", "away_score", "home_score", "winner", "combined_points", "provider",
      "spread_text", "open_spread_text", "close_home_spread", "open_home_spread", "close_total", "open_total",
      "home_moneyline", "away_moneyline", "home_moneyline_text", "away_moneyline_text", "cover_team",
      "cover_text", "total_result", "home_implied", "away_implied", "upset", "winner_moneyline", "recap_url",
    ],
    rows,
    source_note: `Finals are derived from the two team-defense stat lines of each game. Lines are the closing numbers ${
      rows.find((r) => r.provider)?.provider ? `${rows.find((r) => r.provider)?.provider} posted, as ESPN reports them` : "as ESPN reports them"
    }; the implied team totals are the closing total split by the closing spread.${
      missing > 0 ? ` ${missing} game${missing === 1 ? " is" : "s are"} left out because a final or a line was not available.` : ""
    }`,
    computed_at: input.computedAt,
  };
}

/** A line read aloud: "22 of 31, 287 yards, 2 TD, 1 INT; 4 carries, 18 yards". */
export function statLineText(position: string | null, line: GamePlayerInput["line"]): string {
  const parts: string[] = [];
  const pos = (position ?? "").toUpperCase();
  const pass = () => {
    if ((line.pass_att ?? 0) <= 0) return;
    const bits = [`${line.pass_cmp} of ${line.pass_att}`, `${line.pass_yd} passing yards`];
    if (line.pass_td) bits.push(`${line.pass_td} TD`);
    if (line.pass_int) bits.push(`${line.pass_int} INT`);
    parts.push(bits.join(", "));
  };
  const rush = () => {
    if ((line.rush_att ?? 0) <= 0) return;
    const bits = [`${line.rush_att} ${line.rush_att === 1 ? "carry" : "carries"}`, `${line.rush_yd} rushing yards`];
    if (line.rush_td) bits.push(`${line.rush_td} TD`);
    parts.push(bits.join(", "));
  };
  const rec = () => {
    // Yards or a score with no catch is a lateral (Deebo Samuel's 80-yard
    // touchdown in week 3 of 2026), and is still part of the line.
    if ((line.rec ?? 0) <= 0 && (line.rec_tgt ?? 0) <= 0 && !line.rec_yd && !line.rec_td) return;
    const catches = `${line.rec} ${line.rec === 1 ? "catch" : "catches"}`;
    const bits = [line.rec_tgt ? `${catches} on ${line.rec_tgt} ${line.rec_tgt === 1 ? "target" : "targets"}` : catches, `${line.rec_yd} receiving yards`];
    if (line.rec_td) bits.push(`${line.rec_td} TD`);
    parts.push(bits.join(", "));
  };
  if (pos === "QB") {
    pass();
    rush();
    rec();
  } else if (pos === "RB") {
    rush();
    rec();
    pass();
  } else {
    rec();
    rush();
    pass();
  }
  if (line.fum_lost) parts.push(`${line.fum_lost} lost ${line.fum_lost === 1 ? "fumble" : "fumbles"}`);
  return parts.length > 0 ? parts.join("; ") : "No touches";
}

function valueDelta(move: ValueMove | undefined): number | null {
  if (!move || move.start === null || move.end === null) return null;
  return Math.round(move.end - move.start);
}

export interface GamePlayerLinesInput {
  week: number;
  /** game_key by team code, from week_games. */
  gameByTeam: Map<string, string>;
  players: GamePlayerInput[];
  formats: EditionFormatRef[];
  projectionDisplay: string;
  periodStart: string;
  periodEnd: string;
  computedAt: string;
}

/**
 * game_player_lines: the notable offensive players of every game, at most
 * PLAYERS_PER_GAME a game, by PPR points. The value columns are named
 * "{format_slug}.value" and "{format_slug}.change" and measure the move over
 * the edition's period from player_value_history, so a backfilled week reads
 * that week's move rather than today's.
 */
export function buildGamePlayerLinesDataset(input: GamePlayerLinesInput): BundleDataset {
  const byGame = new Map<string, Row[]>();
  for (const p of input.players) {
    const pos = (p.position ?? "").toUpperCase();
    if (!(CARD_POSITIONS as readonly string[]).includes(pos)) continue;
    const key = p.team ? input.gameByTeam.get(p.team.toUpperCase()) : undefined;
    if (!key) continue;
    if ((p.line.gp ?? 1) <= 0) continue;
    const pts = round1(p.line.pts_ppr);
    const proj = round1(p.projected);
    if ((pts ?? 0) < CARD_MIN_POINTS && (proj ?? 0) < CARD_MIN_PROJECTION) continue;
    const row: Row = {
      game_key: key,
      player_id: p.player_id,
      name: p.name,
      slug: p.slug,
      position: pos,
      team: p.team!.toUpperCase(),
      sleeper_id: p.sleeper_id,
      pts_ppr: pts,
      projected: proj,
      vs_projection: pts !== null && proj !== null && proj > 0 ? round1(pts - proj) : null,
      beat_projection: pts !== null && proj !== null && proj > 0 ? (pts >= proj ? "yes" : "no") : null,
      stat_line: statLineText(pos, p.line),
      pass_yd: p.line.pass_yd,
      pass_td: p.line.pass_td,
      rush_yd: p.line.rush_yd,
      rush_td: p.line.rush_td,
      rec: p.line.rec,
      rec_tgt: p.line.rec_tgt,
      rec_yd: p.line.rec_yd,
      rec_td: p.line.rec_td,
      longest_play: Math.max(p.line.pass_lng ?? 0, p.line.rush_lng ?? 0, p.line.rec_lng ?? 0) || null,
    };
    for (const f of input.formats) {
      const move = p.values[f.slug];
      row[`${f.slug}.value`] = move?.end ?? null;
      row[`${f.slug}.change`] = valueDelta(move);
    }
    byGame.set(key, [...(byGame.get(key) ?? []), row]);
  }
  const rows: Row[] = [];
  for (const list of byGame.values()) {
    list.sort((a, b) => Number(b.pts_ppr ?? 0) - Number(a.pts_ppr ?? 0) || String(a.name).localeCompare(String(b.name)));
    rows.push(...list.slice(0, PLAYERS_PER_GAME));
  }
  const valueColumns = input.formats.flatMap((f) => [`${f.slug}.value`, `${f.slug}.change`]);
  const formatsNote = input.formats
    .map((f) => `${f.display}${f.sourceDisplay ? ` on ${f.sourceDisplay}` : ""}`)
    .join(" and ");
  return {
    id: "game_player_lines",
    kind: "game_player_lines",
    title: `Week ${input.week} fantasy lines by game`,
    columns: [
      "game_key", "player_id", "name", "slug", "position", "team", "sleeper_id", "pts_ppr", "projected",
      "vs_projection", "beat_projection", "stat_line", "pass_yd", "pass_td", "rush_yd", "rush_td", "rec",
      "rec_tgt", "rec_yd", "rec_td", "longest_play", ...valueColumns,
    ],
    rows,
    source_note: `PPR points from the week's box scores. Projected is the ${input.projectionDisplay} projection published for week ${input.week}, before any FF Beacon adjustment. Value moves are ${formatsNote}, from the last value on or before ${input.periodStart.slice(0, 10)} to the last on or before ${input.periodEnd.slice(0, 10)}.`,
    computed_at: input.computedAt,
  };
}

/** The bench-points roll-up for one week across every graded league. Pure. */
export function aggregateBenchWeek(entries: BenchWeekEntry[]): {
  teams: number;
  leagues: number;
  avgPointsLeft: number | null;
  flipped: number;
  costliest: BenchWeekEntry["biggestMiss"];
} {
  const teams = entries.length;
  const leagues = new Set(entries.map((e) => e.leagueId)).size;
  const total = entries.reduce((s, e) => s + (Number.isFinite(e.pointsLeft) ? e.pointsLeft : 0), 0);
  const flipped = entries.filter((e) => e.outcome === "loss" && e.bestLineupOutcome === "win").length;
  let costliest: BenchWeekEntry["biggestMiss"] = null;
  for (const e of entries) {
    if (e.biggestMiss && (!costliest || e.biggestMiss.gain > costliest.gain)) costliest = e.biggestMiss;
  }
  return { teams, leagues, avgPointsLeft: teams > 0 ? round1(total / teams) : null, flipped, costliest };
}

export interface WeekAwardsInput {
  week: number;
  games: BundleDataset;
  playerLines: BundleDataset;
  /** The dynasty edition format, for the value awards. */
  dynastySlug: string | null;
  dynastyDisplay: string | null;
  bench: ReturnType<typeof aggregateBenchWeek> | null;
  projectionDisplay: string;
  computedAt: string;
}

function playerAward(id: string, label: string, row: Row, value: string, detail: string | null): Row {
  return {
    id,
    label,
    value,
    detail,
    player_id: row.player_id ?? null,
    name: row.name ?? null,
    slug: row.slug ?? null,
    position: row.position ?? null,
    team: row.team ?? null,
    sleeper_id: row.sleeper_id ?? null,
    game_key: row.game_key ?? null,
  };
}

function plainAward(id: string, label: string, value: string, detail: string | null, gameKeyValue: string | null = null): Row {
  return { id, label, value, detail, player_id: null, name: null, slug: null, position: null, team: null, sleeper_id: null, game_key: gameKeyValue };
}

/**
 * week_awards: the "week in numbers" tiles. Every tile is one label, one
 * value string and an optional detail sentence, built here from the two game
 * datasets and the bench roll-up, so the block never formats a number.
 */
export function buildWeekAwardsDataset(input: WeekAwardsInput): BundleDataset {
  const lines = input.playerLines.rows;
  const rows: Row[] = [];
  const byPts = [...lines].sort((a, b) => Number(b.pts_ppr ?? 0) - Number(a.pts_ppr ?? 0));
  const top = byPts[0];
  if (top) rows.push(playerAward("top_scorer", "Top scorer", top, `${top.name}, ${top.pts_ppr} PPR points`, String(top.stat_line)));
  for (const pos of CARD_POSITIONS) {
    const best = byPts.find((r) => r.position === pos);
    if (best && best !== top) rows.push(playerAward(`top_${pos.toLowerCase()}`, `Top ${pos}`, best, `${best.name}, ${best.pts_ppr}`, String(best.stat_line)));
  }
  const graded = lines.filter((r) => r.vs_projection !== null && r.projected !== null);
  const beat = [...graded].sort((a, b) => Number(b.vs_projection) - Number(a.vs_projection))[0];
  if (beat && Number(beat.vs_projection) > 0) {
    rows.push(
      playerAward("projection_beat", "Biggest beat of the projection", beat, `${beat.name}, ${signed(Number(beat.vs_projection))}`, `Projected ${beat.projected}, scored ${beat.pts_ppr} (${input.projectionDisplay} projection).`),
    );
  }
  const miss = graded
    .filter((r) => Number(r.projected) >= MISS_MIN_PROJECTION)
    .sort((a, b) => Number(a.vs_projection) - Number(b.vs_projection))[0];
  if (miss && Number(miss.vs_projection) < 0) {
    rows.push(
      playerAward("projection_miss", "Biggest miss of the projection", miss, `${miss.name}, ${signed(Number(miss.vs_projection))}`, `Projected ${miss.projected}, scored ${miss.pts_ppr} (${input.projectionDisplay} projection).`),
    );
  }
  if (input.dynastySlug) {
    const col = `${input.dynastySlug}.change`;
    const moved = lines.filter((r) => typeof r[col] === "number" && r[col] !== 0);
    const up = [...moved].sort((a, b) => Number(b[col]) - Number(a[col]))[0];
    const down = [...moved].sort((a, b) => Number(a[col]) - Number(b[col]))[0];
    // Among the players on the game cards, so a player who did not play (a
    // backup quarterback repriced on someone else's injury) cannot win it.
    // The label says so: the edition's movers chart, which covers everyone,
    // can name a bigger move.
    if (up && Number(up[col]) > 0) rows.push(playerAward("value_riser", `Biggest value jump of anyone who played, ${input.dynastyDisplay}`, up, `${up.name}, ${signed(Number(up[col]), 0)}`, `Now ${grouped(Number(up[`${input.dynastySlug}.value`]))}.`));
    if (down && Number(down[col]) < 0) rows.push(playerAward("value_faller", `Biggest value drop of anyone who played, ${input.dynastyDisplay}`, down, `${down.name}, ${signed(Number(down[col]), 0)}`, `Now ${grouped(Number(down[`${input.dynastySlug}.value`]))}.`));
  }
  const games = input.games.rows;
  const shootout = [...games].sort((a, b) => Number(b.combined_points) - Number(a.combined_points))[0];
  if (shootout) {
    rows.push(
      plainAward(
        "shootout",
        "Highest-scoring game",
        `${shootout.away} ${shootout.away_score}, ${shootout.home} ${shootout.home_score}`,
        `${shootout.combined_points} points${shootout.close_total !== null ? ` against a closing total of ${shootout.close_total}` : ""}.`,
        String(shootout.game_key),
      ),
    );
  }
  const upset = games.filter((g) => g.upset === "yes").sort((a, b) => Number(b.winner_moneyline) - Number(a.winner_moneyline))[0];
  if (upset) {
    rows.push(
      plainAward(
        "upset",
        "Biggest upset",
        `${upset.winner} won as a ${moneylineText(Number(upset.winner_moneyline))} underdog`,
        `${upset.away} ${upset.away_score}, ${upset.home} ${upset.home_score}${upset.spread_text ? `; the closing line was ${upset.spread_text}` : ""}.`,
        String(upset.game_key),
      ),
    );
  }
  const bench = input.bench;
  if (bench && bench.teams >= BENCH_MIN_TEAMS && bench.avgPointsLeft !== null) {
    rows.push(
      plainAward(
        "bench_points",
        "Points left on the bench, per team",
        String(bench.avgPointsLeft),
        `Across ${bench.teams} teams in ${bench.leagues} leagues synced to FF Beacon, measured against each team's best legal lineup.`,
      ),
    );
    rows.push(
      plainAward(
        "bench_flips",
        "Losses the bench would have won",
        String(bench.flipped),
        `Teams that lost in week ${input.week} with a lineup on their own roster that would have won.`,
      ),
    );
    if (bench.costliest) {
      const c = bench.costliest;
      rows.push(
        plainAward(
          "bench_costliest",
          "Costliest bench call",
          `${c.inName} sat for ${c.outName}`,
          // The swing only: exact points per player could be matched to one
          // public league page, and no league or manager is ever named here.
          `A swing of ${round1(c.gain)} points in that league's own scoring, the biggest single benching across every graded league.`,
        ),
      );
    }
  }
  return {
    id: "week_awards",
    kind: "week_awards",
    title: `Week ${input.week} in numbers`,
    columns: ["id", "label", "value", "detail", "player_id", "name", "slug", "position", "team", "sleeper_id", "game_key"],
    rows,
    source_note: `Built from the game-by-game tables below.${
      bench && bench.teams >= BENCH_MIN_TEAMS
        ? ` Bench figures are the Manager Ledger's settled week ${input.week} grades for every league synced to FF Beacon that has one, reported as totals only; no league or manager is named.`
        : ""
    }`,
    computed_at: input.computedAt,
  };
}

export interface ProjectionReportInput {
  week: number;
  /** This week's graded rows: projected > 0 and the player took the field. */
  weekRows: Array<{ position: string; projected: number; actual: number }>;
  season: SeasonGradeInput[];
  projectionDisplay: string;
  computedAt: string;
  listSize?: number;
}

function gradeRow(position: string, rows: Array<{ projected: number; actual: number }>): Row {
  const n = rows.length;
  const beat = rows.filter((r) => r.actual >= r.projected).length;
  const mae = n > 0 ? rows.reduce((s, r) => s + Math.abs(r.actual - r.projected), 0) / n : null;
  const bias = n > 0 ? rows.reduce((s, r) => s + (r.actual - r.projected), 0) / n : null;
  return {
    row_type: "position",
    position,
    graded: n,
    beat,
    beat_pct: n > 0 ? Math.round((beat / n) * 100) : null,
    mean_abs_error: round1(mae),
    mean_error: round1(bias),
    player_id: null,
    name: null,
    slug: null,
    team: null,
    sleeper_id: null,
    games_graded: null,
    games_beat: null,
    avg_projected: null,
    avg_vs_projection: null,
  };
}

/**
 * projection_report: one "position" row per card position plus "ALL", then
 * the season's most reliable players ("leader": beat the projection most
 * often, ties broken by the average margin) and the least ("laggard": the
 * furthest below it on average, among players the projection expected
 * something from).
 */
export function buildProjectionReportDataset(input: ProjectionReportInput): BundleDataset {
  const size = input.listSize ?? 5;
  const rows: Row[] = [];
  for (const pos of CARD_POSITIONS) {
    rows.push(gradeRow(pos, input.weekRows.filter((r) => r.position === pos)));
  }
  rows.push(gradeRow("ALL", input.weekRows));

  const summarized = input.season
    .filter((p) => p.weeks.length >= SEASON_MIN_GRADED)
    .map((p) => {
      const n = p.weeks.length;
      const beat = p.weeks.filter((w) => w.actual >= w.projected).length;
      const avgProj = p.weeks.reduce((s, w) => s + w.projected, 0) / n;
      const avgVs = p.weeks.reduce((s, w) => s + (w.actual - w.projected), 0) / n;
      return { p, n, beat, avgProj, avgVs };
    });
  const person = (rowType: string, s: (typeof summarized)[number]): Row => ({
    row_type: rowType,
    position: (s.p.position ?? "").toUpperCase(),
    graded: null,
    beat: null,
    beat_pct: Math.round((s.beat / s.n) * 100),
    mean_abs_error: null,
    mean_error: null,
    player_id: s.p.player_id,
    name: s.p.name,
    slug: s.p.slug,
    team: s.p.team,
    sleeper_id: s.p.sleeper_id,
    games_graded: s.n,
    games_beat: s.beat,
    avg_projected: round1(s.avgProj),
    avg_vs_projection: round1(s.avgVs),
  });
  const leaders = [...summarized]
    .filter((s) => s.avgProj >= LEADER_MIN_AVG_PROJECTION && s.beat / s.n >= 0.75)
    .sort((a, b) => b.beat / b.n - a.beat / a.n || b.avgVs - a.avgVs)
    .slice(0, size);
  const laggards = [...summarized]
    .filter((s) => s.avgProj >= LAGGARD_MIN_AVG_PROJECTION && s.avgVs < 0)
    .sort((a, b) => a.avgVs - b.avgVs)
    .slice(0, size);
  for (const s of leaders) rows.push(person("leader", s));
  for (const s of laggards) rows.push(person("laggard", s));

  return {
    id: "projection_report",
    kind: "projection_report",
    title: `How the projections did, week ${input.week}`,
    columns: [
      "row_type", "position", "graded", "beat", "beat_pct", "mean_abs_error", "mean_error", "player_id", "name",
      "slug", "team", "sleeper_id", "games_graded", "games_beat", "avg_projected", "avg_vs_projection",
    ],
    rows,
    source_note: `Graded against the ${input.projectionDisplay} projection published for each week, in PPR, before any FF Beacon adjustment. A graded game is one where a projection above zero was published and the player took the field. Mean error is actual minus projected: above zero means the projection ran low. Season lists need ${SEASON_MIN_GRADED} graded games; the reliable list counts players projected for ${LEADER_MIN_AVG_PROJECTION} or more a game and the laggard list ${LAGGARD_MIN_AVG_PROJECTION} or more.`,
    computed_at: input.computedAt,
  };
}

/** Offense positions the projection report grades, re-exported so a test can pin them to the site list. */
export const GRADED_POSITIONS: readonly string[] = OFFENSE_POSITIONS.filter((p) =>
  (CARD_POSITIONS as readonly string[]).includes(p),
);
