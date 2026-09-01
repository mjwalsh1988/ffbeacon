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
}

export type { RelayMessageType, RelayHeader };
