/**
 * Fitting a trade into a Discord poll.
 *
 * Discord's limits are hard rejections, not truncations: 300 characters for the
 * question, 55 for EACH answer, and a payload over either is refused outright
 * (https://docs.discord.com/developers/resources/poll). 55 is not much. Two
 * receivers and a first-round pick already use most of it.
 *
 * THE QUESTION CARRIES THE FORMAT, because a trade cannot be judged without
 * knowing the league it happened in. A first-round pick in a 10-team redraft is
 * not the asset it is in a 12-team superflex dynasty, and the poll button is
 * where a reader is actually deciding. 300 characters is generous for that, so
 * it is written in short forms for scanning rather than to save space.
 *
 * THE ANSWERS CARRY THE ASSETS, and 55 characters is where the work is. Full
 * player names are the goal, so the answer is condensed only as far as it has to
 * be, one rung at a time, and the first rung that fits wins:
 *
 *   1. Full names, every pick spelled out       Ja'Marr Chase, 27 1 (E), 27 1 (E)
 *   2. Identical picks grouped                  Ja'Marr Chase, 2x27 1 (E)
 *   3. First initial and surname                J. Chase, 2x27 1 (E)
 *   4. Picks grouped without their slot         J. Chase, 3x27 1
 *   5. Surnames only                            Chase, 3x27 1
 *   6. Picks as a count                         Chase, 4 picks
 *
 * THE LOSSLESS RUNG COMES BEFORE THE LOSSY ONE. Grouping two identical picks
 * says exactly what listing them twice said; shortening a name does not. Doing
 * the name first cost both: "Ja'Marr Chase, 27 1 (E), 27 1 (E), 27 2 (M),
 * 27 2 (M)" is 53 characters, so the ladder shortened the name to fit, when
 * "Ja'Marr Chase, 2x27 1 (E), 2x27 2 (M)" is 37 and keeps it.
 *
 * If rung 6 still does not fit, this returns null and the caller picks a
 * different trade. Nothing is ever silently dropped from a side: an answer that
 * listed three of five players would be a different trade from the one being
 * voted on, and a reader has no way to tell that from the real thing.
 *
 * A rung that would make two people indistinguishable is skipped rather than
 * used. Two Browns on one side become "Brown, Brown" at rung 5, which is not a
 * shorter way of saying the same thing, it is a worse thing to say.
 */

import type { SleeperLeague } from "@/lib/sleeper";
import { categorizeLeague } from "@/lib/league-category";
import { deriveKeeperStyle, deriveLeagueFormat } from "@/lib/sleeper-to-format";

/** Discord's own caps. A poll past either of these is rejected outright. */
export const POLL_QUESTION_MAX = 300;
export const POLL_ANSWER_MAX = 55;

/** "A: " and "B: ", which tie each button to the side named in the message body. */
export const ANSWER_PREFIX: Record<"a" | "b", string> = { a: "A: ", b: "B: " };

/** What a side receives, reduced to what the poll button needs. */
export type PollAsset =
  | { kind: "player"; name: string }
  | {
      kind: "pick";
      /** Full draft year, e.g. 2027. Null when the label did not carry one. */
      season: number | null;
      round: number | null;
      /** Where in the round it lands, or null when unknown. */
      slot: "early" | "mid" | "late" | null;
      /** The long label, used only when the season and round are both missing. */
      label: string;
    };

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------

/** Slot letters. One character each, in brackets, so "(E)" reads as a slot. */
const SLOT_LETTER: Record<"early" | "mid" | "late", string> = {
  early: "E",
  mid: "M",
  late: "L",
};

/**
 * Roster slots nobody starts. Everything else is a starting spot, KICKER AND
 * DEFENCE INCLUDED.
 *
 * The site's own "Start N" chip excludes K and DEF (lib/league-format-tags.ts).
 * This surface does not, because it also PRINTS the lineup, and a body listing
 * a kicker under a heading that did not count it invites a reader to add the
 * line up and get a different number.
 */
const NOT_A_STARTER = new Set(["BN", "IR", "TAXI"]);

/** Short names for the slots Sleeper uses, so a lineup fits on one line. */
const SLOT_NAME: Record<string, string> = {
  SUPER_FLEX: "SF",
  REC_FLEX: "W/T FLEX",
  WRRB_FLEX: "W/R FLEX",
  IDP_FLEX: "IDP",
  DST: "DEF",
};

function startingSlots(rosterPositions: unknown): string[] {
  if (!Array.isArray(rosterPositions)) return [];
  return rosterPositions.filter(
    (p): p is string => typeof p === "string" && !NOT_A_STARTER.has(p),
  );
}

function startingSlotCount(rosterPositions: unknown): number {
  return startingSlots(rosterPositions).length;
}

/**
 * "1 QB, 2 RB, 3 WR, 2 TE, 2 FLEX, 1 SF".
 *
 * In the order the league lists them, which is the order the lineup is set in,
 * rather than a position order of our own. A count of one is still written out,
 * because "QB, 2 RB" reads as a typo next to "1 QB, 2 RB".
 */
function lineupSummary(rosterPositions: unknown): string | null {
  const slots = startingSlots(rosterPositions);
  if (slots.length === 0) return null;
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([slot, n]) => `${n} ${SLOT_NAME[slot] ?? slot}`)
    .join(", ");
}

/**
 * The league in as few words as still say what it is.
 *
 * "Dynasty 12T SF PPR TEP, start 9". Every part is dropped when it does not
 * apply rather than stated as a negative: a league that is not superflex says
 * nothing about superflex, because "SF No" costs characters to tell a reader
 * something they assume.
 *
 * Keeper leagues are named as keeper. They PRICE as redraft, which is why
 * `deriveLeagueFormat` folds them in, but a keeper manager reading "Redraft"
 * would think the trade came out of a different league than it did.
 */
export function compactLeagueFormat(league: {
  metadata: unknown;
  total_rosters: number | null;
  roster_positions: unknown;
}): string {
  const sleeper = (league.metadata ?? {}) as SleeperLeague;
  const hasSettings = Boolean(sleeper && typeof sleeper === "object" && sleeper.settings);

  const parts: string[] = [];

  if (hasSettings) {
    const category = categorizeLeague(sleeper);
    const bestBall = category.startsWith("best-ball");
    const keeper = deriveKeeperStyle(sleeper);
    const base =
      keeper === "dynasty" ? "Dynasty" : keeper === "keeper" ? "Keeper" : "Redraft";
    parts.push(bestBall ? `BB ${base}` : base);
  }

  const teams = league.total_rosters;
  if (teams != null && Number.isFinite(teams) && teams > 0) parts.push(`${teams}T`);

  if (hasSettings) {
    const derived = deriveLeagueFormat(sleeper);
    if (derived.is_superflex) parts.push("SF");
    parts.push(
      derived.scoring_type === "ppr"
        ? "PPR"
        : derived.scoring_type === "half_ppr"
          ? "Half PPR"
          : "Std",
    );
    if (derived.is_tep) parts.push("TEP");
  }

  const starters = startingSlotCount(league.roster_positions);
  const head = parts.join(" ");
  if (starters > 0) return head ? `${head}, start ${starters}` : `Start ${starters}`;
  // Nothing derivable at all, which happens only for a league whose Sleeper
  // object has not been stored. Better than an empty question.
  return head || "Fantasy football";
}

/**
 * The same facts as `compactLeagueFormat`, one per line, for the message body.
 *
 * The body has 2000 characters rather than 300, so nothing is abbreviated here:
 * a reader deciding a trade should not have to know that TEP means tight ends
 * are paid extra. The league's NAME is deliberately absent, from this and from
 * the whole message. It identifies the room the trade came out of, and this
 * game names nobody.
 */
export function leagueFormatBullets(league: {
  metadata: unknown;
  total_rosters: number | null;
  roster_positions: unknown;
  season?: number | null;
}): string[] {
  const sleeper = (league.metadata ?? {}) as SleeperLeague;
  const hasSettings = Boolean(sleeper && typeof sleeper === "object" && sleeper.settings);
  const bullets: string[] = [];

  if (hasSettings) {
    const bestBall = categorizeLeague(sleeper).startsWith("best-ball");
    const keeper = deriveKeeperStyle(sleeper);
    const base =
      keeper === "dynasty" ? "Dynasty" : keeper === "keeper" ? "Keeper" : "Redraft";
    bullets.push(bestBall ? `${base} best ball` : base);
  }

  if (league.season != null && Number.isFinite(league.season)) {
    bullets.push(`${league.season} season`);
  }

  const teams = league.total_rosters;
  if (teams != null && Number.isFinite(teams) && teams > 0) {
    bullets.push(`${teams} teams`);
  }

  if (hasSettings) {
    const derived = deriveLeagueFormat(sleeper);
    if (derived.is_superflex) bullets.push("Superflex");
    bullets.push(
      derived.scoring_type === "ppr"
        ? "PPR"
        : derived.scoring_type === "half_ppr"
          ? "Half PPR"
          : "Standard scoring",
    );
    if (derived.is_tep) {
      const bonus = Number(
        (sleeper.scoring_settings as Record<string, unknown> | undefined)?.bonus_rec_te ?? 0,
      );
      bullets.push(
        bonus > 0 ? `TE premium, plus ${bonus} per catch` : "TE premium",
      );
    }
  }

  const lineup = lineupSummary(league.roster_positions);
  if (lineup) bullets.push(`Starting lineup: ${lineup}`);

  // Never an empty block. A heading with nothing under it reads as a bug.
  return bullets.length > 0 ? bullets : ["Format not recorded"];
}

/** "Who wins? Dynasty 12T SF PPR TEP, start 9", inside Discord's 300. */
export function buildPollQuestion(formatLabel: string): string {
  const question = `Who wins? ${formatLabel}`;
  return question.length <= POLL_QUESTION_MAX
    ? question
    : `${question.slice(0, POLL_QUESTION_MAX - 3).trimEnd()}...`;
}

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

/** Suffixes that carry no identifying weight once a first name is already gone. */
const NAME_SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;

function surname(full: string): string {
  const trimmed = full.trim().replace(NAME_SUFFIX, "");
  const parts = trimmed.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : trimmed;
}

/**
 * "J. Chase" from "Ja'Marr Chase", and "A. St. Brown" from "Amon-Ra St. Brown".
 *
 * Everything after the first token is the surname, so a two-word surname
 * survives. The suffix is kept at this rung: "M. Harrison Jr." is who that is.
 */
function initialAndSurname(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.trim();
  const initial = Array.from(parts[0])[0] ?? "";
  return `${initial}. ${parts.slice(1).join(" ")}`;
}

/** "27 1 (E)", or "27 1" with no slot, or the long label as a last resort. */
function pickText(pick: Extract<PollAsset, { kind: "pick" }>, withSlot: boolean): string {
  if (pick.season == null || pick.round == null) return pick.label;
  const year = String(pick.season % 100).padStart(2, "0");
  const base = `${year} ${pick.round}`;
  return withSlot && pick.slot ? `${base} (${SLOT_LETTER[pick.slot]})` : base;
}

/**
 * Collapse repeats into "2x27 1 (E)".
 *
 * Only IDENTICAL strings collapse, so grouping never claims two picks land in
 * the same part of the round when they do not. Dropping the slot first (the
 * rung above) is what makes more of them identical, and that is a deliberate,
 * separate loss of detail rather than a side effect of grouping.
 */
function groupRepeats(texts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries()).map(([text, n]) => (n > 1 ? `${n}x${text}` : text));
}

/** Picks read best in draft order, whatever order the transaction listed them. */
const SLOT_RANK: Record<string, number> = { early: 0, mid: 1, late: 2 };

function sortPicks(
  picks: Array<Extract<PollAsset, { kind: "pick" }>>,
): Array<Extract<PollAsset, { kind: "pick" }>> {
  return [...picks].sort(
    (x, y) =>
      (x.season ?? 9999) - (y.season ?? 9999) ||
      (x.round ?? 99) - (y.round ?? 99) ||
      (SLOT_RANK[x.slot ?? ""] ?? 3) - (SLOT_RANK[y.slot ?? ""] ?? 3),
  );
}

/** How hard each rung squeezes, loosest first. */
type PlayerStyle = "full" | "initial" | "surname";
type PickStyle = "slotted" | "grouped" | "grouped-plain" | "count";

const RUNGS: Array<{ players: PlayerStyle; picks: PickStyle }> = [
  { players: "full", picks: "slotted" },
  // Lossless, so it goes before anything that shortens a name.
  { players: "full", picks: "grouped" },
  { players: "initial", picks: "grouped" },
  { players: "initial", picks: "grouped-plain" },
  { players: "surname", picks: "grouped-plain" },
  { players: "surname", picks: "count" },
];

function renderPlayers(names: string[], style: PlayerStyle): string[] | null {
  const rendered =
    style === "full"
      ? names
      : style === "initial"
        ? names.map(initialAndSurname)
        : names.map(surname);
  // A rung that makes two people read the same is not a shorter way of saying
  // the same thing. Refused, so the ladder moves past it.
  if (new Set(rendered).size !== rendered.length) return null;
  return rendered;
}

function renderPicks(
  picks: Array<Extract<PollAsset, { kind: "pick" }>>,
  style: PickStyle,
): string[] {
  if (picks.length === 0) return [];
  if (style === "count") {
    return [`${picks.length} ${picks.length === 1 ? "pick" : "picks"}`];
  }
  const sorted = sortPicks(picks);
  const texts = sorted.map((p) => pickText(p, style === "slotted" || style === "grouped"));
  return style === "slotted" ? texts : groupRepeats(texts);
}

export interface PollAnswerResult {
  text: string;
  /** Which rung was used, 0 being full names. For the run log. */
  rung: number;
}

/**
 * One poll answer for one side, or null when the side cannot be stated in 55
 * characters without dropping somebody.
 *
 * Null is the caller's signal to leave this trade alone and pick another. It is
 * the right answer rather than a failure: a poll button that lists three of a
 * side's five players describes a trade nobody proposed.
 */
export function buildPollAnswer(
  assets: PollAsset[],
  side: "a" | "b",
): PollAnswerResult | null {
  const prefix = ANSWER_PREFIX[side];
  const budget = POLL_ANSWER_MAX - prefix.length;

  if (assets.length === 0) {
    return { text: `${prefix}nothing`, rung: 0 };
  }

  const names = assets.flatMap((a) => (a.kind === "player" ? [a.name] : []));
  const picks = assets.flatMap((a) => (a.kind === "pick" ? [a] : []));

  for (let rung = 0; rung < RUNGS.length; rung += 1) {
    const { players, picks: pickStyle } = RUNGS[rung];
    const renderedPlayers = renderPlayers(names, players);
    if (!renderedPlayers) continue;
    const body = [...renderedPlayers, ...renderPicks(picks, pickStyle)].join(", ");
    if (body.length <= budget) return { text: `${prefix}${body}`, rung };
  }

  return null;
}
