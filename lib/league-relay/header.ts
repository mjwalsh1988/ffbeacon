/**
 * The header every relay message carries.
 *
 * WHY EVERY MESSAGE NEEDS ONE. A Discord channel can carry more than one
 * community league, and a reader scrolling back has no other way to tell which
 * league a trade belongs to. Worse, the numbers only mean something in context:
 * "adds 3.6 points a week" is a different claim in a superflex TE-premium
 * league to a 10-team standard one, and a reader who cannot see which they are
 * looking at cannot judge either.
 *
 * So the header is two things, and they sit in two different places:
 *
 *   THE LEAGUE NAME goes in the embed's AUTHOR slot, which Discord renders
 *   small, above the title. That is the line a reader's eye lands on first when
 *   scanning a channel, and it costs the writeup no room.
 *
 *   THE FORMAT LINE opens the description: how many teams, what kind of league,
 *   what the starting lineup is, and how it scores. One line, four facts, and
 *   every one of them read from the league's OWN Sleeper settings rather than
 *   from the format we happened to price it in.
 *
 * IT IS BUILT ONCE PER LEAGUE PER RUN, not once per message. A busy Wednesday
 * is a dozen messages from one league, and the header is identical on all of
 * them, so it is computed in `loadRelayLeague` and carried on `RelayLeague`.
 *
 * Pure: takes plain data, returns two strings.
 */

import { NON_STARTING_TOKENS } from "@/lib/league-schedule/slots";
import { describeLeagueScoring, type ScoringSettings } from "@/lib/league-scoring";
import { deriveLeagueFormat } from "@/lib/sleeper-to-format";
import type { SleeperLeague } from "@/lib/sleeper";

/**
 * Slot tokens rendered under a friendlier name.
 *
 * Sleeper's tokens are storage keys, not words. `SUPER_FLEX` and `WRRB_FLEX`
 * are the two a reader would actually stumble over, and `REC_FLEX` is not much
 * better. Anything not listed is printed as Sleeper wrote it, which is right
 * for QB, RB, WR, TE, K and DEF and harmless for an IDP token.
 */
const SLOT_NAMES: Record<string, string> = {
  SUPER_FLEX: "SFLEX",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  FLEX: "FLEX",
  IDP_FLEX: "IDP",
  DEF: "DEF",
};

function slotName(token: string): string {
  return SLOT_NAMES[token] ?? token;
}

/**
 * The starting lineup, counted and collapsed.
 *
 * "QB, 2 RB, 2 WR, TE, 2 FLEX, K, DEF" rather than the raw eleven tokens.
 * Order is the league's OWN `roster_positions` order, because that is the order
 * a manager sees on their own lineup screen and any other order would read as a
 * different league.
 *
 * Only bench, IR, taxi and NA are removed, using the same set the Schedule view
 * uses. Nothing else is dropped, IDP slots included: a league that starts three
 * linebackers is a league whose header should say so.
 */
export function describeStartingSlots(rosterPositions: string[]): string {
  const counts: Array<{ token: string; n: number }> = [];
  for (const raw of rosterPositions) {
    const token = String(raw ?? "").toUpperCase();
    if (!token || NON_STARTING_TOKENS.has(token)) continue;
    const last = counts[counts.length - 1];
    // Collapse only ADJACENT repeats, so a league listing RB, WR, RB keeps its
    // own shape rather than being tidied into 2 RB, WR.
    if (last && last.token === token) last.n += 1;
    else counts.push({ token, n: 1 });
  }
  if (counts.length === 0) return "no starting slots published";
  return counts.map((c) => (c.n > 1 ? `${c.n} ${slotName(c.token)}` : slotName(c.token))).join(", ");
}

export interface RelayHeader {
  /** The embed author line. The league's own name. */
  leagueName: string;
  /** The first line of every message body. Teams, format, lineup, scoring. */
  contextLine: string;
}

/**
 * Build the header for one league.
 *
 * `sleeperLeague` is the raw Sleeper object as synced. When it was never
 * captured the format and scoring halves are simply left out rather than
 * guessed: a header that states a scoring rule we did not read would be the
 * one line on the message a reader is entitled to trust completely.
 */
export function buildRelayHeader(params: {
  leagueName: string;
  season: number;
  totalRosters: number;
  rosterPositions: string[];
  sleeperLeague: SleeperLeague | null;
}): RelayHeader {
  const parts: string[] = [];

  const teams = Number(params.totalRosters);
  if (Number.isFinite(teams) && teams > 0) {
    parts.push(`${params.season}, ${teams} teams`);
  } else {
    parts.push(`${params.season}`);
  }

  if (params.sleeperLeague && typeof params.sleeperLeague === "object") {
    try {
      const derived = deriveLeagueFormat(params.sleeperLeague);
      const kind = [
        derived.league_type === "dynasty" ? "dynasty" : "redraft",
        derived.is_superflex ? "superflex" : null,
      ]
        .filter((p): p is string => p !== null)
        .join(" ");
      if (kind) parts.push(kind);
    } catch {
      // A league object we cannot read is not a reason to send no header.
    }
  }

  const slots = describeStartingSlots(params.rosterPositions);
  if (slots) parts.push(`starting ${slots}`);

  const scoring = (params.sleeperLeague as { scoring_settings?: ScoringSettings } | null)
    ?.scoring_settings;
  if (scoring) {
    const described = describeLeagueScoring(scoring);
    // describeLeagueScoring says so itself when it could not read the settings.
    // Repeating that inside a header would be noise where a fact belongs.
    if (described && !described.includes("unavailable")) parts.push(described);
  }

  return {
    leagueName: params.leagueName,
    // Italic, so it reads as a standing note about the league rather than as
    // the first sentence of the writeup.
    contextLine: `_${parts.join(" | ")}_`,
  };
}
