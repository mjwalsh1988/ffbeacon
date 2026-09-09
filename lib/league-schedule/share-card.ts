/**
 * The matchup share card, as data.
 *
 * One matchup rendered as a tall image somebody drops into a group chat: both
 * lineups slot against slot, the two totals, and one line saying what state the
 * week is in. The route that draws it (`/api/og/matchup/[league_id]/[week]/
 * [roster_id]/share`) does layout and nothing else, so every decision about
 * WHICH number belongs on the card lives here, where it can be tested without a
 * renderer.
 *
 * THE CARD IS A STILL IMAGE WITH NO ALT TEXT OF ITS OWN, which is the reason
 * for two rules that shape most of this file:
 *
 *   NOTHING IS SAID ONLY BY COLOUR OR ONLY BY POSITION. The side that is ahead
 *   is named in a word, the state of the week is a word, and the basis of every
 *   number is a word. A tint is a scanning aid on top of a sentence, never
 *   instead of one.
 *
 *   THE CARD CARRIES ITS OWN DESCRIPTION. `describeShareCard` builds the
 *   sentence the copy button announces and the page's own link uses, so a
 *   reader who never sees the picture still gets the score.
 *
 * A PROJECTION AND A RESULT ARE NOT THE SAME KIND OF NUMBER, and neither is a
 * zero. `MatchupView.resultsVisible` decides which one leads: a week with points
 * on the board shows the score with the projection beneath it, a week that has
 * not started shows the projection alone. A slot with no published number prints
 * a dash, never 0.0, because a zero on a screenshot is the version of the number
 * that gets argued about and it would be wrong.
 */

import type {
  MatchupSide,
  MatchupSlotEntry,
  MatchupView,
  SlotGroup,
} from "./types";
import { orderSlotsForDisplay, shortSlotLabel } from "./slots";
// The same venue formatter the on-page table uses. It is arithmetic over two
// strings with no state and no imports of its own, which is exactly why it was
// put in a shared file: a second copy here is how one surface starts printing
// "vs" on a game whose venue we do not know.
import { opponentLabel } from "@/components/league-schedule/format";
// The name ladder is shared with the team share image, which hit the same
// problem the moment both cards moved onto a heavier typeface: a fixed column
// and a face wide enough to overflow it. One copy, so a name shortens the same
// way whichever picture it lands on.
import { clip, displayName } from "@/lib/og/display-name";

export { displayName };

/** One player on one side of one row. Null everywhere the slot is empty. */
export type ShareCardCell = {
  name: string;
  /** Sleeper id, so the renderer can find a headshot. */
  sleeperId: string;
  /** Position code, which is what tells a team defence apart from a player. */
  position: string;
  /** "QB, GB (vs SF)". Position leads, because the slot badge is shared. */
  meta: string;
  /** The headline number for this cell: a score once the week has started. */
  points: number | null;
  /**
   * The projection, kept beside a score rather than replaced by it. Null before
   * the week starts, when the projection IS `points` and printing it twice would
   * say nothing.
   */
  projected: number | null;
  /** True on the higher of the two cells in this row. Never true on both. */
  leading: boolean;
};

/** One slot, both sides. */
export type ShareCardRow = {
  key: string;
  /** The badge in the middle column: "QB", "SF", "W/T". */
  slotLabel: string;
  group: SlotGroup;
  home: ShareCardCell | null;
  away: ShareCardCell | null;
};

export type ShareCardSide = {
  teamName: string;
  ownerHandle: string | null;
  avatarId: string | null;
  /** "5-2" or "5-2-1". */
  record: string;
  /** The headline total. Null when there is nothing honest to print. */
  total: number | null;
  /** The projection under a live or final score. Null before the week starts. */
  projected: number | null;
  /** 0 to 100. Null once the games have started, and on an unpaired roster. */
  winPct: number | null;
  leading: boolean;
};

export type ShareCard = {
  leagueName: string;
  week: number;
  season: number;
  /**
   * "Final", "In progress", "This week", "Upcoming". The STATE, and never the
   * week number: the line it sits on already says which week this is, and the
   * first version of this printed "week 1, week 1".
   *
   * The four words are the SAME four the matchup page prints above its heading.
   * A reader who presses the copy button and hears a different word for the week
   * than the one on the screen in front of them has no way to tell which of the
   * two is wrong.
   */
  stateLabel: string;
  /** What the two big numbers are: "Scored" or "Projected". */
  basisLabel: string;
  home: ShareCardSide;
  away: ShareCardSide | null;
  rows: ShareCardRow[];
  /**
   * The margin between the two totals, and who holds it. Null when either side
   * has no total, and null on a tie, because a tie is not a lead.
   */
  margin: { teamName: string; points: number } | null;
  /** One line under the rows saying what the numbers are and what they exclude. */
  footnote: string;
};

function recordLabel(record: { wins: number; losses: number; ties: number }): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

/**
 * The line under a player's name.
 *
 * Position and NFL team, plus the opponent when we hold one. Venue is left to
 * `opponentLabel`, which prints a bare code when `nflIsHome` is null: Sleeper's
 * own `opponent` field carries no venue marker, and claiming a home game for
 * every road game is worse than saying nothing about where it is played.
 */
function cellMeta(position: string, team: string | null, opponent: string | null, isHome: boolean | null): string {
  const head = team ? `${position}, ${team}` : position || "Unknown position";
  return `${head} ${opponentLabel(opponent, isHome)}`;
}

function buildCell(
  entry: MatchupSlotEntry | null,
  showsResults: boolean,
): ShareCardCell | null {
  const player = entry?.player;
  if (!player) return null;

  const points = showsResults ? player.actual : player.projected;
  return {
    name: displayName(player.name),
    sleeperId: player.sleeperId,
    position: player.position,
    meta: cellMeta(player.position, player.team, player.nflOpponent, player.nflIsHome),
    points,
    // Only worth a second line once it is standing NEXT TO something. Before
    // the week starts the projection is already the headline.
    projected: showsResults ? player.projected : null,
    leading: false,
  };
}

function buildSide(
  side: MatchupSide,
  showsResults: boolean,
  winPct: number | null,
  leading: boolean,
): ShareCardSide {
  return {
    teamName: side.teamName,
    ownerHandle: side.ownerHandle,
    avatarId: side.ownerAvatarId,
    record: recordLabel(side.record),
    total: showsResults ? side.scoredTotal : side.projectedTotal,
    projected: showsResults ? side.projectedTotal : null,
    winPct,
    leading,
  };
}

/**
 * Build the whole card from a matchup view.
 *
 * Pure, and it queries nothing: the view already holds every figure. The rows
 * come out in the same order the on-page table renders them
 * (`orderSlotsForDisplay`), so the card and the page can never disagree about
 * which quarterback is QB1.
 */
export function buildShareCard(
  view: MatchupView,
  leagueName: string,
): ShareCard {
  const showsResults = view.resultsVisible;
  const { home, away } = view;

  const homeTotal = showsResults ? home.scoredTotal : home.projectedTotal;
  const awayTotal = away ? (showsResults ? away.scoredTotal : away.projectedTotal) : null;
  const lead = leadingSide(homeTotal, awayTotal);

  // A win chance is a FORECAST, so it comes off the card the moment there are
  // real points to look at instead. Leaving it up would put a whole-week
  // probability directly above a score that has already half happened.
  const homePct =
    showsResults || view.homeWinProb === null ? null : Math.round(view.homeWinProb * 100);
  const awayPct = homePct === null ? null : 100 - homePct;

  const orderedHome = orderSlotsForDisplay(home.slots);
  const rows: ShareCardRow[] = orderedHome.map((entry, index) => {
    // Both sides come from the same roster_positions, so the ALIGNMENT index is
    // what pairs them. `slot.order` is that index, and it survives the display
    // reordering above, which is why the away slot is looked up by it rather
    // than by this row's position in the ordered list.
    const awayEntry = away ? (away.slots[entry.slot.order] ?? null) : null;

    const homeCell = buildCell(entry, showsResults);
    const awayCell = buildCell(awayEntry, showsResults);
    const rowLead = leadingSide(homeCell?.points ?? null, awayCell?.points ?? null);

    return {
      key: `${entry.slot.token}-${entry.slot.order}-${index}`,
      slotLabel: shortSlotLabel(entry.slot.label),
      group: entry.slot.group,
      home: homeCell ? { ...homeCell, leading: rowLead === "home" } : null,
      away: awayCell ? { ...awayCell, leading: rowLead === "away" } : null,
    };
  });

  return {
    leagueName,
    week: view.week,
    season: view.season,
    stateLabel: view.isFinal
      ? "Final"
      : showsResults
        ? "In progress"
        : view.isCurrent
          ? "This week"
          : "Upcoming",
    basisLabel: showsResults ? "Scored" : "Projected",
    home: buildSide(home, showsResults, homePct, lead === "home"),
    away: away ? buildSide(away, showsResults, awayPct, lead === "away") : null,
    rows,
    margin: buildMargin(view, homeTotal, awayTotal, lead),
    footnote: buildFootnote(view),
  };
}

function buildMargin(
  view: MatchupView,
  homeTotal: number | null,
  awayTotal: number | null,
  lead: "home" | "away" | null,
): ShareCard["margin"] {
  if (lead === null || homeTotal === null || awayTotal === null) return null;
  const side = lead === "home" ? view.home : view.away;
  if (!side) return null;
  return {
    teamName: side.teamName,
    points: Math.abs(homeTotal - awayTotal),
  };
}

/**
 * The one line under the rows.
 *
 * It says what the numbers ARE, because a screenshot travels without the page
 * it came from, and it says what they leave out, because a league running IDP
 * slots has totals that do not add up from the visible rows and a reader
 * checking the arithmetic deserves to know why.
 */
function buildFootnote(view: MatchupView): string {
  // Counted from the SLOT DEFINITIONS rather than from the filled players: an
  // empty IDP slot is still a slot the totals cannot include.
  const unprojectable = view.home.slots.filter((entry) => !entry.slot.projectable).length;
  // The live wording carries the 0.0 caveat because the picture cannot be asked
  // about it later. Sleeper's per-player map holds a real zero for a player
  // whose game has not kicked off, which is indistinguishable on the card from a
  // player who has finished and scored nothing.
  const base = view.isFinal
    ? "Final scores from Sleeper"
    : view.resultsVisible
      ? "Live scores from Sleeper, with each projection beside it. A player yet to kick off reads 0.0"
      : "Projected in this league's own scoring";

  if (!view.hasUnprojectableSlots || unprojectable === 0) return base;
  return `${base}. Totals exclude ${unprojectable} IDP ${
    unprojectable === 1 ? "slot" : "slots"
  }, which Sleeper publishes no projections for`;
}

function leadingSide(home: number | null, away: number | null): "home" | "away" | null {
  if (home === null || away === null) return null;
  if (home === away) return null;
  return home > away ? "home" : "away";
}

/**
 * The card, in a sentence.
 *
 * Used as the copy button's announcement and as the image's own description
 * wherever one can be attached. A picture of a scoreboard that a screen reader
 * cannot read is not a share of the scoreboard, it is a share of a rectangle,
 * so the score itself is in here rather than a summary of what the card looks
 * like.
 */
export function describeShareCard(card: ShareCard): string {
  // A missing total becomes a CLAUSE, not a word dropped into the slot where a
  // number goes. "Team A no total, Team B 91.4, scored" is not a sentence, and
  // this string is heard rather than skimmed.
  const scoreOf = (name: string, n: number | null) =>
    n === null ? `no total available for ${name}` : `${name} ${n.toFixed(1)}`;
  const basis = card.basisLabel.toLowerCase();
  const state = card.stateLabel.toLowerCase();

  if (!card.away) {
    const solo =
      card.home.total === null
        ? `no total available for ${card.home.teamName}`
        : `${basis} ${card.home.total.toFixed(1)}`;
    // The state is named here too. The paired branch always said it and this one
    // did not, so an unpaired roster never said whether the week was over.
    return `Week ${card.week} of ${card.leagueName}, ${state}. ${card.home.teamName} has no opponent this week, ${solo}.`;
  }

  const head = `Week ${card.week} of ${card.leagueName}, ${state}. ${scoreOf(card.home.teamName, card.home.total)}, ${scoreOf(card.away.teamName, card.away.total)}, ${basis}.`;

  if (card.margin) {
    return `${head} ${card.margin.teamName} ahead by ${card.margin.points.toFixed(1)}.`;
  }
  return head;
}
