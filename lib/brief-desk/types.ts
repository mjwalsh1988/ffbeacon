/**
 * Shapes shared by the bundle builder, the two desk routes, the validator and
 * the reader page (docs/beacon-brief/relays-and-briefs-plan.md, section 9).
 */

import type { z } from "zod";
import type { EditionPeriod } from "./cadence";
import type { BlockKindMeta, DatasetKind, SectionIcon } from "./blocks";
import type { draftSchema } from "./draft-schema";
import type { RelayFact } from "@/lib/relays/types";

export type Draft = z.infer<typeof draftSchema>;
export type DraftSection = Draft["sections"][number];
export type DraftBlock = Draft["blocks"][number];

export interface BundleRelay {
  id: string;
  slug: string;
  permalink: string;
  kind: string;
  headline: string;
  facts: RelayFact[];
  timeline: string | null;
  availability: string | null;
  relevance_tier: number;
  source_handle: string;
  source_url: string;
  source_posted_at: string;
  players: string[];
  /**
   * The players the Relay is about (relay_players.is_primary), or its only
   * player when none is flagged; empty when neither applies. availability and
   * timeline describe THESE players. A report can have several ("15 players
   * ruled out for Sunday"); the rest are named in passing ("Mayer's role
   * expected to grow") and must not inherit the status.
   */
  subject_player_ids: string[];
  teams: string[];
  follows_relay_id: string | null;
  status: "published" | "hidden";
}

export interface BundleFormatValue {
  current: number | null;
  change_7d: number | null;
  change_30d: number | null;
  rank_in_format: number | null;
  /** The source actually used for this format, after fall-through. */
  source_slug: string | null;
  source_display: string | null;
  /**
   * "not_covered" for a defensive player: no value source prices defenders,
   * so every figure above is null by design, not missing (plan R-21). The
   * instructions tell the desk how to say it.
   */
  coverage?: "not_covered";
}

export interface BundlePlayer {
  slug: string;
  full_name: string;
  position: string | null;
  team: string | null;
  value: Record<string, BundleFormatValue>;
  week_line: Record<string, number | string | null> | null;
  season_to_date: {
    games: number;
    /** Null for a defender, whose offensive points mean nothing. */
    pts_ppr: number | null;
    /** A defender's Sleeper default IDP points (plan IDP-213). */
    pts_idp123?: number;
    /** 1-based, among the position, on pts_ppr (offense) or pts_idp123 (defense). */
    rank_at_position: number | null;
    /** Which points rank_at_position ranks on. */
    scoring?: "ppr" | "idp123";
  } | null;
  next_week: { week: number; opponent: string | null; projected_pts: number | null; beat_rate: number | null } | null;
  positional_war_note: string | null;
}

export interface BundleDataset {
  id: string;
  kind: DatasetKind;
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  source_note: string;
  computed_at: string;
}

/**
 * One team's game in the edition's week, or null when the period has no week
 * (off-season, pre-season) or the team did not play (a bye). Derived from the
 * two team-defense stat lines in player_stats (./week-results.ts), so it is
 * as final as the box scores beside it.
 */
export interface BundleWeekResult {
  opponent: string;
  points_for: number;
  points_against: number;
  outcome: "W" | "L" | "T";
  game_date: string | null;
}

export interface BundleTeam {
  name: string;
  week_result: BundleWeekResult | null;
}

export interface Bundle {
  due: true;
  edition: {
    season: string;
    week: number | null;
    phase: EditionPeriod["phase"];
    /** Pre-season only: weeks to kickoff. The validator's period needs it. */
    pre_season_week: number | null;
    cadence: EditionPeriod["cadence"];
    period_start: string;
    period_end: string;
    suggested_slug: string;
    suggested_title: string;
    /** In season: the slug must start with this. */
    required_slug_prefix: string | null;
  };
  context: {
    formats: Array<{ slug: string; display: string }>;
    source_slug: string | null;
    source_display: string | null;
    nfl_state: { season: string; season_type: string | null; week: number | null };
  };
  instructions: string;
  relays: BundleRelay[];
  players: Record<string, BundlePlayer>;
  teams: Record<string, BundleTeam>;
  league_wide: {
    top_scorers_by_position: Record<string, Array<{ player_id: string; name: string; pts_ppr: number }>>;
    value_movers: { up: Array<{ player_id: string; name: string; change_7d: number }>; down: Array<{ player_id: string; name: string; change_7d: number }> };
    dvp_notes: string[];
  };
  datasets: Record<string, BundleDataset>;
  /**
   * The week's carded games (plan section 23): one entry per row of the
   * week_games dataset, with the ESPN game page to research the recap from and
   * the player ids on the card (a fun_stat must name one of them). Empty when
   * the period has no week or no game with a final and a line.
   */
  game_index: Array<{ game_key: string; away: string; home: string; recap_url: string | null; player_ids: string[] }>;
  block_kinds: BlockKindMeta[];
  section_icons: readonly SectionIcon[];
  example: { slug: string; draft_payload: unknown } | null;
  previous_editions: Array<{ slug: string; title: string; published_at: string | null }>;
  previous_attempt: { notes: string | null; rejected_at: string | null; draft_payload: unknown } | null;
  /** How to send the draft back, restated so the run cannot get it wrong. */
  submit: { method: "POST"; path: "/api/brief-desk/drafts"; content_type: "application/json" };
}

export interface BundleNotDue {
  due: false;
  reason: string;
  next_close: string | null;
  next_period: EditionPeriod | null;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  word_count: number;
}
