/**
 * The block library's registry: every kind an edition may place, which
 * dataset kinds each accepts, and the zod schema for its options.
 *
 * A block carries no rows of its own. The run places a block by kind and
 * dataset id, writes its caption and its one-sentence conclusion, and picks
 * options the schema below allows. Everything rendered inside a block comes
 * from the bundle's dataset, so the run has no path to put an invented number
 * on a page. New kinds are added here, with a schema and a test, and appear in
 * the bundle's block_kinds automatically; the run cannot add one.
 *
 * Pure. No I/O.
 */

import { z } from "zod";

export const EDITION_FORMAT_SLUGS = ["dynasty-ppr-sflex", "redraft-ppr-std"] as const;
export type EditionFormatSlug = (typeof EDITION_FORMAT_SLUGS)[number];

export const SECTION_ICONS = [
  "injury",
  "transaction",
  "contract",
  "depth-chart",
  "coaching",
  "scoreboard",
  "values",
  "waiver",
  "trade",
  "draft",
  "calendar",
  "faq",
] as const;
export type SectionIcon = (typeof SECTION_ICONS)[number];

export const DATASET_KINDS = [
  "week_stat_tiles",
  "value_movers_up",
  "value_movers_down",
  "value_movers_by_format",
  "top_scorers",
  "box_score_lines",
  "injury_timeline",
  "waiver_targets",
] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

export const BLOCK_KINDS = [
  "stat_tiles",
  "value_movers",
  "top_scorers",
  "box_score_lines",
  "injury_timeline",
  "action_list",
  "format_toggle",
  "return_planner",
  "relay_quote",
  "callout",
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

const ACTIONS = ["waiver", "hold", "sell", "start", "sit"] as const;
const TOOLS = ["faab", "start-sit", "trade-calculator"] as const;

/** Where each action links, so a card never points at the wrong tool. */
export const ACTION_TOOL_PATHS: Record<(typeof TOOLS)[number], string> = {
  faab: "/tools/faab",
  "start-sit": "/tools/who-should-i-start",
  "trade-calculator": "/tools/trade-calculator",
};

const uuid = z.string().uuid();

export const BLOCK_OPTION_SCHEMAS = {
  stat_tiles: z.object({}).strict(),
  value_movers: z
    .object({
      direction: z.enum(["up", "down", "both"]).default("both"),
      limit: z.number().int().min(5).max(15).default(10),
    })
    .strict(),
  top_scorers: z
    .object({
      positions: z.array(z.enum(POSITIONS)).min(1).max(6).default([...POSITIONS]),
      limit: z.number().int().min(5).max(20).default(10),
    })
    .strict(),
  box_score_lines: z.object({ player_ids: z.array(uuid).min(1).max(12) }).strict(),
  injury_timeline: z.object({}).strict(),
  action_list: z
    .object({
      items: z
        .array(
          z
            .object({
              player_id: uuid,
              action: z.enum(ACTIONS),
              tool: z.enum(TOOLS),
              note: z.string().max(160),
            })
            .strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
  format_toggle: z.object({ default: z.enum(EDITION_FORMAT_SLUGS).default("dynasty-ppr-sflex") }).strict(),
  return_planner: z
    .object({
      default_weeks: z.tuple([z.number().int().min(1).max(18), z.number().int().min(1).max(18)]).default([15, 17]),
    })
    .strict()
    .refine((o) => o.default_weeks[0] <= o.default_weeks[1], "default_weeks must be from, to"),
  relay_quote: z.object({ relay_id: uuid }).strict(),
  callout: z
    .object({
      icon: z.enum(SECTION_ICONS),
      tone: z.enum(["cyan", "purple"]).default("cyan"),
    })
    .strict(),
} as const satisfies Record<BlockKind, z.ZodTypeAny>;

export interface BlockKindMeta {
  kind: BlockKind;
  description: string;
  /** Dataset kinds the block accepts; empty when it takes none. */
  accepts: DatasetKind[];
  interactive: boolean;
  /** A short description of the options, for the bundle's block_kinds. */
  options: string;
}

export const BLOCK_KIND_META: BlockKindMeta[] = [
  { kind: "stat_tiles", description: "Six league-wide figures for the period as tiles with labels.", accepts: ["week_stat_tiles"], interactive: false, options: "none" },
  { kind: "value_movers", description: "Horizontal bar chart of change_7d, up and down, with the table under a disclosure.", accepts: ["value_movers_up", "value_movers_down"], interactive: false, options: "direction: up, down or both; limit: 5 to 15" },
  { kind: "top_scorers", description: "Table per position with the week's line, sortable by column.", accepts: ["top_scorers"], interactive: true, options: "positions: subset of QB, RB, WR, TE, K, DEF; limit: 5 to 20" },
  { kind: "box_score_lines", description: "The cited players' week lines as a table.", accepts: ["box_score_lines"], interactive: false, options: "player_ids: 1 to 12 ids present in the bundle's players" },
  { kind: "injury_timeline", description: "A timeline with one marker per player at the expected return week; rows with no timeline listed under it.", accepts: ["injury_timeline"], interactive: false, options: "none" },
  { kind: "action_list", description: "Cards for waiver, hold, sell, start and sit calls, each linking to the tool.", accepts: ["waiver_targets"], interactive: false, options: "items: 1 to 8 of { player_id, action, tool, note up to 160 characters }" },
  { kind: "format_toggle", description: "A radiogroup of the two edition formats; the table below shows the chosen column.", accepts: ["value_movers_by_format"], interactive: true, options: "default: dynasty-ppr-sflex or redraft-ppr-std" },
  { kind: "return_planner", description: "The reader picks a week range; the list shows who is expected back inside it.", accepts: ["injury_timeline"], interactive: true, options: "default_weeks: [from, to] within 1 to 18" },
  { kind: "relay_quote", description: "One Relay card inline, for the story a paragraph is about.", accepts: [], interactive: false, options: "relay_id: present in the bundle" },
  { kind: "callout", description: "A short aside with an icon, for a rule of thumb or a caveat.", accepts: [], interactive: false, options: "icon: one of the section icons; tone: cyan or purple" },
];

/**
 * The block kinds an in-season draft must carry at least one of (instruction 8).
 *
 * `needsWeekLines` marks the scoreboard requirement, which can only be met when
 * the bundle actually built a week-line dataset. It does so for the regular and
 * post seasons and not for the pre-season, which has no box scores, so demanding
 * that block through the pre-season made roughly six editions a year
 * unpublishable: omitting it failed, and placing it named a dataset that was
 * never offered. The validator demotes it to a warning there, which is the
 * treatment the off-season already gets.
 */
export const REQUIRED_IN_SEASON_BLOCKS: Array<{
  label: string;
  kinds: BlockKind[];
  needsWeekLines?: boolean;
}> = [
  { label: "a stat_tiles block", kinds: ["stat_tiles"] },
  { label: "a value_movers chart", kinds: ["value_movers"] },
  { label: "a top_scorers or box_score_lines table", kinds: ["top_scorers", "box_score_lines"], needsWeekLines: true },
  { label: "an injury_timeline", kinds: ["injury_timeline"] },
  { label: "an action_list", kinds: ["action_list"] },
  { label: "an interactive (format_toggle or return_planner)", kinds: ["format_toggle", "return_planner"] },
];

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === "string" && (BLOCK_KINDS as readonly string[]).includes(value);
}

export function isSectionIcon(value: unknown): value is SectionIcon {
  return typeof value === "string" && (SECTION_ICONS as readonly string[]).includes(value);
}

export type ParsedBlockOptions = { ok: true; options: Record<string, unknown> } | { ok: false; error: string };

/** Validate and default a block's options against its kind's schema. */
export function parseBlockOptions(kind: BlockKind, options: unknown): ParsedBlockOptions {
  const schema = BLOCK_OPTION_SCHEMAS[kind];
  const result = schema.safeParse(options ?? {});
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "options"}: ${i.message}`).join("; ") };
  }
  return { ok: true, options: result.data as Record<string, unknown> };
}

/** Which dataset kind a dataset id declares, for the accepts check. */
export function blockAcceptsDataset(kind: BlockKind, datasetKind: DatasetKind | null): boolean {
  const meta = BLOCK_KIND_META.find((m) => m.kind === kind);
  if (!meta) return false;
  if (meta.accepts.length === 0) return datasetKind === null;
  return datasetKind !== null && meta.accepts.includes(datasetKind);
}
