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
  teams: Record<string, { name: string; week_result: null }>;
  league_wide: {
    top_scorers_by_position: Record<string, Array<{ player_id: string; name: string; pts_ppr: number }>>;
    value_movers: { up: Array<{ player_id: string; name: string; change_7d: number }>; down: Array<{ player_id: string; name: string; change_7d: number }> };
    dvp_notes: string[];
  };
  datasets: Record<string, BundleDataset>;
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
