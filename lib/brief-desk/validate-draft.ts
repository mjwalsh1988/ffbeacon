/**
 * The draft validator (plan section 9.3): every rule that needs the bundle.
 *
 * Rejections come back as reasons the run can act on; warnings land in
 * brief_editions.validation_report for the owner. Pure and tested. The zod
 * shape check (./draft-schema.ts) runs before this and is not repeated here.
 *
 * The important refusals: a Relay not in the bundle, a block whose kind or
 * dataset the bundle did not offer, options that fail the kind's schema (a
 * block carries no rows of its own, so there is no free-typed number for the
 * run to invent), raw HTML or a script in markdown, a citation URL that was
 * never fetched, and the banned characters and phrases from the owner's
 * writing rules.
 */

import { countArticleWords } from "@/lib/beacon-brief/index-quality";
import {
  blockAcceptsDataset,
  isBlockKind,
  isSectionIcon,
  parseBlockOptions,
  REQUIRED_IN_SEASON_BLOCKS,
  type DatasetKind,
} from "./blocks";
import { isInSeasonPhase, KEBAB_SLUG, requiredSlugPrefix } from "./slug";
import type { Draft, ValidationReport } from "./types";
import type { RelayPhase } from "@/lib/relays/week";

export interface ValidationContext {
  period: {
    season: string;
    week: number | null;
    phase: RelayPhase;
    preSeasonWeek: number | null;
    periodStart: string;
    periodEnd: string;
  };
  /** Every Relay in the bundle, with its tier. */
  relays: Array<{ id: string; relevance_tier: number; headline: string }>;
  /** Dataset id to kind. */
  datasets: Record<string, DatasetKind>;
  /** Player ids the bundle carries. */
  playerIds: Set<string>;
  /** Article and Relay slugs already taken. */
  existingSlugs: Set<string>;
}

/**
 * Characters the writing rules forbid, written as escapes so this file is pure
 * ASCII on disk. Literal characters here would be invisible in a diff and a
 * re-encode or an editor autofix could silently disable the check by replacing
 * them, which is the one way this guard can fail without anyone noticing.
 */
const BANNED_CHARACTERS: Array<[RegExp, string]> = [
  [/—/g, "an em dash"],
  [/–/g, "an en dash"],
  [/[‘’]/g, "a curly apostrophe"],
  [/[“”]/g, "a curly quote"],
  [/…/g, "an ellipsis character"],
  [/ /g, "a non-breaking space"],
  [/·/g, "a middle dot"],
  [/\p{Extended_Pictographic}/gu, "an emoji"],
];

/** Phrases from the owner's AI-writing list, matched case-insensitively. */
export const BANNED_PHRASES = [
  "it's worth noting",
  "it is worth noting",
  "in today's",
  "in an era",
  "not just a",
  "not only a",
  "game-changer",
  "game changer",
  "delve",
  "tapestry",
  "testament to",
  "moreover",
  "furthermore",
  "ultimately,",
  "in summary",
  "let's dive",
  "seamless",
  "robust",
  "cutting-edge",
  "underscor",
  "landscape",
  "elevate your",
  "unlock",
  "leverage",
];

const RAW_HTML = /<\/?[a-z][^>]*>/i;

/** Roughly what a search result shows before it truncates. */
export const SERP_TITLE_MAX = 60;
export const SERP_DESCRIPTION_MAX = 155;

/** How many FAQ entries the editorial instructions ask for (plan 8.4 item 4). */
export const FAQ_RANGE: [number, number] = [3, 6];

export const WORD_RANGES: Record<"in_season" | "off_season", [number, number]> = {
  in_season: [1800, 4000],
  off_season: [1200, 2500],
};

/**
 * The banned-character, banned-phrase and raw-HTML check on one string, for a
 * caller outside the validator. The owner's edit at approval rewrites the same
 * strings the validator checked, and an edit that reintroduces an em dash is
 * the same defect arriving by a different door.
 */
export function textProblemsIn(text: string, where: string): string[] {
  const out: string[] = [];
  textProblems(text, where, out);
  return out;
}

function textProblems(text: string, where: string, out: string[]): void {
  for (const [re, label] of BANNED_CHARACTERS) {
    re.lastIndex = 0;
    if (re.test(text)) out.push(`${where} contains ${label}`);
  }
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) out.push(`${where} contains the banned phrase "${phrase}"`);
  }
  if (RAW_HTML.test(text)) out.push(`${where} contains raw HTML`);
}

/** Every string inside a parsed options object, with a dotted path to it. */
function optionStrings(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path || "value", value]];
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => optionStrings(entry, path ? `${path}[${i}]` : `[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      optionStrings(entry, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

export function validateDraft(draft: Draft, ctx: ValidationContext): ValidationReport & { ok: boolean } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inSeason = isInSeasonPhase(ctx.period.phase);

  // The edition must be the open period, exactly.
  const e = draft.edition;
  if (
    e.season !== ctx.period.season ||
    e.week !== ctx.period.week ||
    new Date(e.period_start).getTime() !== new Date(ctx.period.periodStart).getTime() ||
    new Date(e.period_end).getTime() !== new Date(ctx.period.periodEnd).getTime()
  ) {
    errors.push(
      `edition does not match the open period (${ctx.period.season}, week ${ctx.period.week ?? "off-season"}, ${ctx.period.periodStart} to ${ctx.period.periodEnd}); fetch the bundle again`,
    );
  }

  // Slug and title rules.
  const prefix = requiredSlugPrefix(ctx.period);
  if (prefix && !draft.slug.startsWith(prefix)) {
    errors.push(`slug must start with "${prefix}" in season`);
  }
  if (ctx.existingSlugs.has(draft.slug)) errors.push(`slug "${draft.slug}" is already taken`);
  if (inSeason && draft.title_options) {
    errors.push("title_options are not accepted in season; the title pattern is fixed");
  }
  if (!inSeason) {
    if (!draft.title_options || draft.title_options.length !== 3) {
      errors.push("an off-season draft must carry exactly three title_options");
    } else {
      for (const [i, opt] of draft.title_options.entries()) {
        if (!KEBAB_SLUG.test(opt.slug)) errors.push(`title_options[${i}].slug is not kebab-case`);
        if (ctx.existingSlugs.has(opt.slug)) errors.push(`title_options[${i}].slug "${opt.slug}" is already taken`);
        textProblems(opt.title, `title_options[${i}].title`, errors);
      }
    }
  }

  // Relays: every cited id is in the bundle; every tier 3 story is cited somewhere (warning).
  const relayIds = new Set(ctx.relays.map((r) => r.id));
  const cited = new Set<string>();
  for (const s of draft.sections) {
    for (const id of s.relay_ids) {
      if (!relayIds.has(id)) errors.push(`section "${s.id}" cites relay ${id}, which is not in the bundle`);
      cited.add(id);
    }
  }
  for (const r of ctx.relays) {
    if (r.relevance_tier >= 3 && !cited.has(r.id)) {
      warnings.push(`tier 3 relay not cited anywhere: "${r.headline}" (${r.id})`);
    }
  }

  // Blocks: known kind, offered dataset, options that parse, accepted dataset kind.
  const blockIds = new Map<string, Draft["blocks"][number]>();
  for (const b of draft.blocks) {
    if (blockIds.has(b.id)) errors.push(`duplicate block id "${b.id}"`);
    blockIds.set(b.id, b);
    if (!isBlockKind(b.kind)) {
      errors.push(`block "${b.id}" names kind "${b.kind}", which is not in block_kinds`);
      continue;
    }
    const datasetKind = b.dataset_id ? (ctx.datasets[b.dataset_id] ?? null) : null;
    if (b.dataset_id && datasetKind === null) {
      errors.push(`block "${b.id}" names dataset "${b.dataset_id}", which is not in datasets`);
    } else if (!blockAcceptsDataset(b.kind, datasetKind)) {
      errors.push(`block "${b.id}" (${b.kind}) does not accept dataset "${b.dataset_id ?? "none"}"`);
    }
    const parsed = parseBlockOptions(b.kind, b.options);
    if (!parsed.ok) {
      errors.push(`block "${b.id}" options: ${parsed.error}`);
    } else {
      const o = parsed.options as { player_ids?: string[]; items?: Array<{ player_id: string }>; relay_id?: string };
      for (const pid of o.player_ids ?? []) {
        if (!ctx.playerIds.has(pid)) errors.push(`block "${b.id}" names player ${pid}, who is not in the bundle`);
      }
      for (const item of o.items ?? []) {
        if (!ctx.playerIds.has(item.player_id)) errors.push(`block "${b.id}" names player ${item.player_id}, who is not in the bundle`);
      }
      if (o.relay_id && !relayIds.has(o.relay_id)) errors.push(`block "${b.id}" quotes relay ${o.relay_id}, which is not in the bundle`);
      // Plan 11.2: every string the run writes inside a block's options goes
      // through the same check as body text. An action_list note is 160 free
      // characters and it renders on the public page, so an em dash or a curly
      // apostrophe there reaches a reader exactly as one in a paragraph would.
      // Walking the parsed options covers any future kind that adds a string.
      for (const [path, value] of optionStrings(parsed.options)) {
        textProblems(value, `block "${b.id}" options.${path}`, errors);
      }
    }
    textProblems(b.caption, `block "${b.id}" caption`, errors);
    textProblems(b.conclusion, `block "${b.id}" conclusion`, errors);
  }

  // Sections: icon in the set, at least one figure or citation, refs resolve, text rules.
  const fetched = new Set(draft.research_log.map((r) => r.url));
  const sectionIds = new Set<string>();
  let words = countArticleWords(draft.tl_dr);
  for (const s of draft.sections) {
    if (sectionIds.has(s.id)) errors.push(`duplicate section id "${s.id}"`);
    sectionIds.add(s.id);
    if (!isSectionIcon(s.icon)) errors.push(`section "${s.id}" icon "${s.icon}" is not in section_icons`);
    if (s.block_refs.length === 0 && s.citations.length === 0) {
      errors.push(`section "${s.id}" carries no block and no citation; a section with no bundle figure to carry is cut, not padded`);
    }
    for (const ref of s.block_refs) {
      if (!blockIds.has(ref)) errors.push(`section "${s.id}" refers to block "${ref}", which does not exist`);
    }
    for (const c of s.citations) {
      if (!fetched.has(c.url)) errors.push(`section "${s.id}" cites ${c.url}, which is not in research_log; only a page fetched during this run may be cited`);
    }
    textProblems(s.heading, `section "${s.id}" heading`, errors);
    textProblems(s.body_md, `section "${s.id}" body`, errors);
    if (/<script/i.test(s.body_md)) errors.push(`section "${s.id}" body contains a script`);
    words += countArticleWords(s.body_md);
  }
  for (const [i, f] of draft.faq.entries()) {
    textProblems(f.question, `faq[${i}].question`, errors);
    textProblems(f.answer_md, `faq[${i}].answer`, errors);
    words += countArticleWords(f.answer_md);
  }
  // Plan 8.4 item 4 asks for three to six questions. The schema allows zero to
  // eight and the rejection list in 9.3 does not name it, so a thin or bloated
  // FAQ is a warning the owner sees at review rather than a refusal.
  if (draft.faq.length < FAQ_RANGE[0] || draft.faq.length > FAQ_RANGE[1]) {
    warnings.push(
      `faq has ${draft.faq.length} ${draft.faq.length === 1 ? "question" : "questions"}; the instructions ask for ${FAQ_RANGE[0]} to ${FAQ_RANGE[1]}`,
    );
  }
  textProblems(draft.title, "title", errors);
  textProblems(draft.meta_description, "meta_description", errors);
  // Display limits, as warnings: the owner edits both at approval, and a title
  // a reader never sees the end of is a weaker result than a shorter one.
  if (draft.title.length > SERP_TITLE_MAX) {
    warnings.push(`title is ${draft.title.length} characters; a search result shows about ${SERP_TITLE_MAX}`);
  }
  if (draft.meta_description.length > SERP_DESCRIPTION_MAX) {
    warnings.push(
      `meta_description is ${draft.meta_description.length} characters; a search result shows about ${SERP_DESCRIPTION_MAX}`,
    );
  }
  textProblems(draft.tl_dr, "tl_dr", errors);
  textProblems(draft.format_note, "format_note", errors);

  // Required in-season blocks (errors in season, warnings off-season). The
  // scoreboard block is the exception: the bundle only builds a week-line
  // dataset for the regular and post seasons, so through the pre-season that
  // requirement is a warning too. Demanding a block whose only dataset does not
  // exist is a rule no pre-season edition can satisfy.
  const hasWeekLines = ctx.period.phase === "regular" || ctx.period.phase === "post";
  const kinds = new Set(draft.blocks.map((b) => b.kind));
  for (const req of REQUIRED_IN_SEASON_BLOCKS) {
    if (!req.kinds.some((k) => kinds.has(k))) {
      const required = inSeason && (!req.needsWeekLines || hasWeekLines);
      (required ? errors : warnings).push(`missing ${req.label}`);
    }
  }
  // Every block placed must be referenced by a section, or it renders nowhere.
  const referenced = new Set(draft.sections.flatMap((s) => s.block_refs));
  for (const id of blockIds.keys()) {
    if (!referenced.has(id)) warnings.push(`block "${id}" is not referenced by any section and will not render`);
  }

  // Length.
  const [min, max] = WORD_RANGES[inSeason ? "in_season" : "off_season"];
  if (words < min) errors.push(`word count ${words} is under the ${inSeason ? "in-season" : "off-season"} minimum of ${min}`);
  if (words > max) errors.push(`word count ${words} is over the ${inSeason ? "in-season" : "off-season"} maximum of ${max}`);

  return { ok: errors.length === 0, errors, warnings, word_count: words };
}
