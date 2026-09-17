/**
 * The zod schema for POST /api/brief-desk/drafts (plan section 9.3).
 *
 * Shape only. The rules that need the bundle (Relay ids, dataset ids, the
 * open period, word counts, banned characters) live in ./validate-draft.ts.
 * Every object is strict so a stray key, which is where an invented figure
 * would hide, is a rejection rather than a silent pass-through.
 */

import { z } from "zod";
import { KEBAB_SLUG } from "./slug";

const uuid = z.string().uuid();
const kebab = z.string().min(3).max(120).regex(KEBAB_SLUG, "must be kebab-case");
const httpsUrl = z.string().max(2000).regex(/^https:\/\//, "must be an https URL");

export const citationSchema = z.object({ url: httpsUrl, claim: z.string().min(3).max(400) }).strict();

export const sectionSchema = z
  .object({
    id: kebab,
    heading: z.string().min(3).max(140),
    icon: z.string().max(40),
    eyebrow: z.string().max(80),
    body_md: z.string().min(1).max(30_000),
    relay_ids: z.array(uuid).max(60).default([]),
    block_refs: z.array(z.string().min(1).max(60)).max(12).default([]),
    citations: z.array(citationSchema).max(40).default([]),
  })
  .strict();

export const blockSchema = z
  .object({
    id: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "block ids are kebab-case"),
    kind: z.string().max(40),
    dataset_id: z.string().max(80).nullable().default(null),
    caption: z.string().max(300).default(""),
    conclusion: z.string().max(300).default(""),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const titleOptionSchema = z
  .object({
    title: z.string().min(40).max(110),
    slug: kebab,
    target_queries: z.array(z.string().min(3).max(120)).min(1).max(10),
    rationale: z.string().min(10).max(400),
  })
  .strict();

export const researchLogEntrySchema = z
  .object({
    claim: z.string().min(3).max(400),
    url: httpsUrl,
    fetched_at: z.string().max(40),
    note: z.string().max(600).default(""),
    kind: z.enum(["check", "keywords"]).default("check"),
  })
  .strict();

export const draftSchema = z
  .object({
    edition: z
      .object({
        season: z.string().regex(/^\d{4}$/),
        week: z.number().int().min(1).max(22).nullable(),
        period_start: z.string().max(40),
        period_end: z.string().max(40),
      })
      .strict(),
    title: z.string().min(40).max(110),
    slug: kebab,
    title_options: z.array(titleOptionSchema).optional(),
    meta_description: z.string().min(80).max(165),
    tl_dr: z.string().min(120).max(1500),
    format_note: z.string().min(20).max(300),
    sections: z.array(sectionSchema).min(3).max(20),
    blocks: z.array(blockSchema).max(40).default([]),
    faq: z
      .array(z.object({ question: z.string().min(8).max(200), answer_md: z.string().min(20).max(3000) }).strict())
      .max(8)
      .default([]),
    players: z.array(uuid).max(250).default([]),
    teams: z.array(z.string().min(2).max(4)).max(32).default([]),
    research_log: z.array(researchLogEntrySchema).max(300).default([]),
    run: z
      .object({
        source: z.enum(["cloud_routine", "local_run", "manual"]),
        run_id: z.string().max(200).nullable().optional(),
        model: z.string().max(100).nullable().optional(),
      })
      .strict(),
  })
  .strict();
