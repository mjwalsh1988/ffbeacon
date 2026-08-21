/**
 * The small formatters and the two surface constants every Schedule component
 * needs, in one place.
 *
 * WHY THIS FILE EXISTS AT ALL
 *   Four of the eight components render a win-loss record, three of them build
 *   a link that has to carry `?username=` forward, and every one of them draws
 *   the beacon hairline. Copying a record formatter four times is how "6-2" and
 *   "6-2-0" end up on the same page, and copying a 120 character gradient
 *   string is how one of them quietly drifts to a different purple. Nothing in
 *   here holds state, touches the network, or imports a data module: it is
 *   types plus arithmetic, so both the server components and the two client
 *   ones can pull from it.
 *
 * THE NULL RULE, RESTATED
 *   None of these helpers turn a null into a number. `fmtPoints` takes a real
 *   number and nothing else, so a caller holding a null has to decide what
 *   words go there. That is deliberate: a helper that returned "0.0" for a
 *   missing projection would put an answer on the screen where there is none,
 *   which is the exact failure lib/league-schedule/types.ts was written to
 *   prevent.
 */

import type { ScheduleMatchup, ScheduleMatchupSide } from "@/lib/league-schedule/types";

/** The decorative top-edge hairline every panel surface on this page carries. */
export const HAIRLINE_STYLE = {
  backgroundImage:
    "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
} as const;

/**
 * The corner wash reserved for the ONE primary surface on a screen (the current
 * week's matchup card). Everything else stays flat, which is the whole reason
 * this reads as the thing to look at.
 */
export const ELEVATED_WASH = {
  backgroundImage:
    "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 62%)",
} as const;

export const ELEVATED_BORDER =
  "border-line-accent shadow-[0_0_70px_-45px_rgba(168,85,247,0.9)]";

export const FLAT_BORDER = "border-line";

/** The shared chip shell. Paired with a word every time it is used. */
export const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-muted";

export const EYEBROW =
  "text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan";

/**
 * Carry the looked-up Sleeper handle across every link on the page.
 *
 * A reader who arrived from /tools/league-pulse without signing in is
 * identified only by that query string. Drop it on one link and their next
 * page cannot tell which team is theirs.
 */
export function withUsername(path: string, username: string | null): string {
  if (!username) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}username=${encodeURIComponent(username)}`;
}

/** "6-2" normally, "6-2-1" when there is a tie to report. */
export function recordLabel(record: { wins: number; losses: number; ties: number }): string {
  const base = `${record.wins}-${record.losses}`;
  return record.ties > 0 ? `${base}-${record.ties}` : base;
}

/** One decimal, always. Fantasy points are quoted to a tenth everywhere else on the site. */
export function fmtPoints(value: number, digits = 1): string {
  return value.toFixed(digits);
}

/** "+4.3" / "-1.2" / "0.0". The sign is the point, so it is never dropped. */
export function fmtSigned(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

/** "62%" for the eye. */
export function pctLabel(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

/** "62 percent" for the ear, because a bare % sign is read inconsistently. */
export function pctWords(probability: number): string {
  return `${Math.round(probability * 100)} percent`;
}

/**
 * The NFL opponent, compact, in parentheses.
 *
 * "(vs HOU)" at home, "(@ HOU)" on the road, "(HOU)" when we do not know, and
 * "(BYE)" when there is no game. The brackets are doing real work: this sits on
 * the same line as the position and the team, and without them "WR, BUF vs HOU"
 * runs together into one string a reader has to parse.
 *
 * VENUE IS NEVER GUESSED. `isHome` comes from Sleeper's published season
 * schedule (lib/sleeper.ts getNflHomeAwayMap), because neither the weekly
 * projections nor the weekly stats carry a marker: both give `opponent` as a
 * bare code. A null means the schedule fetch did not answer, and the label drops
 * the preposition rather than defaulting to "vs", which would print a home game
 * for every road game. That default is why the first version of this printed no
 * venue at all.
 */
export function opponentLabel(code: string | null, isHome?: boolean | null): string {
  if (!code) return "(BYE)";
  const trimmed = code.trim();
  if (!trimmed) return "(BYE)";
  // A leading "@" is honoured if a source ever sends one pre-marked.
  if (trimmed.startsWith("@")) return `(@ ${trimmed.slice(1)})`;
  if (isHome === true) return `(vs ${trimmed})`;
  if (isHome === false) return `(@ ${trimmed})`;
  return `(${trimmed})`;
}

/** The same fact as a phrase, for an accessible name. */
export function opponentWords(code: string | null, isHome?: boolean | null): string {
  if (!code) return "on a bye";
  const trimmed = code.trim();
  if (!trimmed) return "on a bye";
  if (trimmed.startsWith("@")) return `away at ${trimmed.slice(1)}`;
  if (isHome === true) return `at home against ${trimmed}`;
  if (isHome === false) return `away at ${trimmed}`;
  return `against ${trimmed}`;
}

/** "5, 9 and 14". Plain "and", never an ampersand or a bullet. */
export function listWords(items: (string | number)[]): string {
  const parts = items.map(String);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "1st", "2nd", "3rd". Used wherever a rank is spoken rather than tabulated. */
export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * The side of a matchup belonging to one roster, and the side that is not.
 *
 * `home` and `away` are Sleeper's pairing order, which says nothing about whose
 * schedule is being read. The team view needs "me" and "them", so it asks here
 * rather than each row guessing.
 */
export function sidesFor(
  matchup: ScheduleMatchup,
  sleeperRosterId: number,
): { self: ScheduleMatchupSide | null; opponent: ScheduleMatchupSide | null } {
  if (matchup.home.sleeperRosterId === sleeperRosterId) {
    return { self: matchup.home, opponent: matchup.away };
  }
  if (matchup.away && matchup.away.sleeperRosterId === sleeperRosterId) {
    return { self: matchup.away, opponent: matchup.home };
  }
  return { self: null, opponent: null };
}

/**
 * The win probability belonging to one side.
 *
 * `homeWinProb` is stored once for the pair. Reading it from the away side's
 * row without flipping it is how a 38 percent underdog gets shown as a
 * favourite, so the flip happens in exactly one place.
 */
export function winProbFor(
  matchup: ScheduleMatchup,
  sleeperRosterId: number,
): number | null {
  if (matchup.homeWinProb === null) return null;
  return matchup.home.sleeperRosterId === sleeperRosterId
    ? matchup.homeWinProb
    : 1 - matchup.homeWinProb;
}

/**
 * Below this, a bench upgrade is not worth putting on a card.
 *
 * One constant rather than a number written into three components, because the
 * week board, the team view and the lineup check all have to agree on when a
 * manager is "leaving points on the bench". At a tenth of a point everyone is.
 */
export const BENCH_CHIP_THRESHOLD = 1;

/**
 * The state of one game, as a left edge.
 *
 * A list of matchup cards on a dark background runs together: every card is the
 * same surface with the same one pixel border, so the eye has to find the gap
 * rather than the edge. A thick coloured rule down the left side gives each card
 * a start, and it carries the game's state for free.
 *
 * Purple for a game still to be played, cyan for the week in progress, and a
 * flat grey for one that is done, which reads as settled precisely because it is
 * the only one of the three that is not a brand colour.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL HERE. Every card already carries "Final",
 * "This week" or "Projected" as a chip, and every team-season row already
 * carries the outcome as a word. This is reinforcement, so it stays aria-hidden
 * by virtue of being a border and nothing announces it.
 */
export function stateEdgeClass(state: {
  isFinal: boolean;
  isCurrent: boolean;
}): string {
  if (state.isFinal) return "border-l-4 border-l-line-accent";
  if (state.isCurrent) return "border-l-4 border-l-brand-cyan";
  return "border-l-4 border-l-brand-purple";
}
