/**
 * Shared shapes for League Relay.
 *
 * A BUILDER produces a `Writeup`, which is prose plus a stat block plus an
 * optional poll, and knows nothing about Discord. `render.ts` turns a Writeup
 * into a message and is the only place Discord's limits are applied. Keeping
 * those apart is what lets the admin preview show the exact text the channel
 * will get without a webhook existing, and what lets the fitting rules be
 * tested without a fixture full of embed JSON.
 */

import type { Section } from "./limits";
import type { RelayMessageType } from "./default-settings";
import type { RelayHeader } from "./header";

/** The stat block under the prose. One Discord embed field each. */
export interface WriteupField {
  name: string;
  value: string;
  inline?: boolean;
  /** Dropped before prose is, when the embed total budget is tight. Higher goes first. */
  priority: number;
}

/** A poll to attach. Answers are already inside Discord's 55 characters. */
export interface WriteupPoll {
  question: string;
  answers: string[];
}

/** What a builder returns. Pure data: no Discord shapes, no side effects. */
export interface Writeup {
  type: RelayMessageType;
  /**
   * The header, on EVERY message. Not optional, because a channel can carry
   * more than one community league and a message that does not name its own is
   * unidentifiable in a scrollback. See lib/league-relay/header.ts.
   */
  header: RelayHeader;
  /** The embed title. Inside 256 characters by construction. */
  title: string;
  /** The prose, in droppable pieces. See lib/league-relay/limits.ts. */
  sections: Section[];
  /** The numbers. Dropped whole, never trimmed. */
  fields: WriteupField[];
  /** The small print under the embed. */
  footer: string | null;
  /** Where the writeup points. Null when there is nowhere useful to send anyone. */
  url: string | null;
  poll: WriteupPoll | null;
}

/** The league facts every builder needs. Read once per league per run. */
export interface RelayLeague {
  /** leagues.id */
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
  totalRosters: number;
  /**
   * How many teams POWER PULSE ACTUALLY SCORED, which is the denominator every
   * "9th of 12" in a writeup belongs over.
   *
   * Not `totalRosters`. A Power Pulse rank is a position among the rows in
   * `league_power_pulse_cache`, and a league where the model skipped two
   * rosters ranks only to ten. Saying "10th of 12" about a ranking that ran to
   * ten is wrong by two places and reads as a standings position, which is the
   * defect this field exists to close. `lib/league-power-pulse-data.ts` makes
   * exactly the same choice for the same reason.
   *
   * Null when Power Pulse has no rows for the league, in which case no writeup
   * has a rank to print anyway.
   */
  pulseRankedTeams: number | null;
  rosterPositions: string[];
  /** The raw Sleeper league object, as synced. Null when never captured. */
  metadata: unknown;
  /** community_leagues.watermark_at */
  watermarkAt: string;
  /**
   * The league name and format line every message carries.
   *
   * Built ONCE per league per run rather than per message: a busy Wednesday is
   * a dozen messages from one league and the header is identical on all of
   * them.
   */
  header: RelayHeader;
}

/** A team, as every writeup names one. */
export interface RelayTeam {
  sleeperRosterId: number;
  /**
   * WHAT EVERY WRITEUP CALLS THIS MANAGER: their Sleeper username.
   *
   * Not the team name. See the note on `loadRelayTeams` for why. Falls back to
   * the team name for an unclaimed roster, then to "Team 4".
   */
  name: string;
  /** The manager's Sleeper handle. Null when the roster is unclaimed. */
  handle: string | null;
  /** Their team name, when they set one. Kept, but not what messages use. */
  teamName: string | null;
  record: { wins: number; losses: number; ties: number };
  /** Points scored so far. Sleeper's own first tiebreak, and the one used here. */
  pointsFor: number;
  /**
   * WHERE THEY ACTUALLY SIT IN THE TABLE: wins first, then points scored.
   *
   * A separate fact from the Power Pulse rank and routinely a different number,
   * because Power Pulse ranks a team on what it should win FROM HERE and the
   * table ranks it on what it has already won. A 1-0 team can be last by Power
   * Pulse, and a writeup that prints only the second one beside a record has
   * told the reader something that looks false and is not checkable.
   *
   * Null only when the roster row carries no record at all.
   */
  standingsRank: number | null;
}

export type { RelayMessageType, RelayHeader };
