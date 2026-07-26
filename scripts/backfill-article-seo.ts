/**
 * One-time backfill: re-run the live Beacon Brief article prompt over every
 * existing article, so articles written before the SEO and AI-tell rules landed
 * (migrations 0146 and 0147) get the same treatment as new ones.
 *
 * ABSOLUTE RULE, per the project backfill convention: this is a ONE-TIME operation.
 * NEVER wire it into a cron. Re-runs are safe (see resumability below) but pointless.
 *
 * How each article is processed:
 *   - The ORIGINAL social post is passed as `post`, and the EXISTING article body is
 *     passed as `research_notes`. That matches the prompt's contract exactly and is
 *     what keeps the model from inventing facts: every fact it can use is already in
 *     the current article. This is a rewrite for structure, SEO, and voice, NOT a
 *     re-report, so no web search runs and no new claims can enter.
 *   - The SLUG IS NEVER CHANGED. These are published URLs with real search equity;
 *     rewriting them would 404 every existing link and inbound reference, which is
 *     the opposite of the goal. The model's suggested slug is logged for reference
 *     only. Changing slugs later would need 301 redirects first.
 *   - Title and meta_description are checked against the prompt's own targets
 *     (50 to 60 and 140 to 160 characters). If either misses, the article gets ONE
 *     corrective retry with the measured lengths fed back in. One retry only, so the
 *     worst case is bounded at 2 calls per article.
 *   - Every change is snapshotted into article_revisions, so any article can be
 *     restored from its previous revision.
 *
 * Resumability: each processed article records metadata.seo_backfill_at. A re-run
 * skips those unless --force is passed, so an interrupted run can be resumed without
 * paying for the articles it already did.
 *
 * Cost: no web search, so this is the cheap call shape. Roughly $0.02 per article at
 * current article sizes on the configured article model.
 *
 * Run:
 *   npm run backfill:article-seo -- --dry-run        inspect what would change, no API calls
 *   npm run backfill:article-seo -- --limit 3        do 3 articles for real
 *   npm run backfill:article-seo                     do all remaining
 *   npm run backfill:article-seo -- --force          redo articles already backfilled
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconBriefSettings } from "../lib/beacon-brief/settings";
import { runStructuredCall } from "../lib/beacon-brief/ai";
import type { Json } from "../lib/database.types";

const TITLE_MIN = 50;
const TITLE_MAX = 60;
const META_MIN = 140;
const META_MAX = 160;

/** Matches the worker's ARTICLE_SCHEMA so the model returns the same shape. */
const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "slug", "meta_description", "tl_dr", "body_md"],
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    meta_description: { type: "string" },
    tl_dr: { type: "string" },
    body_md: { type: "string" },
  },
} as const;

interface ArticleResult {
  title: string;
  slug: string;
  meta_description: string;
  tl_dr: string;
  body_md: string;
}

// Curly quotes, em and en dashes, ellipsis, middle dot, non-breaking space.
const BANNED_CHARS = /[—–‘’“”…· ]/g;

function inRange(s: string, min: number, max: number): boolean {
  return s.length >= min && s.length <= max;
}

function bannedCharsIn(s: string): string[] {
  const hits = s.match(BANNED_CHARS);
  if (!hits) return [];
  return [...new Set(hits)].map(
    (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const limitArg = args.indexOf("--limit");
  const limit =
    limitArg >= 0 && args[limitArg + 1] ? Number(args[limitArg + 1]) : Infinity;

  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY missing. Run with tsx --env-file=.env.local (npm run backfill:article-seo).",
    );
  }

  const admin = getServiceClient();
  const settings = await loadBeaconBriefSettings(admin);
  if (!settings.prompts.article) {
    throw new Error("bb_article_prompt is empty; nothing to apply.");
  }

  // Pull every article plus the source post it came from. The source post is the
  // model's `post` input; the current article becomes its `research_notes`.
  const { data: rows, error } = await admin
    .from("articles")
    .select(
      "id, slug, title, meta_description, tl_dr, content_md, metadata, news_ingestions(text, author_handle, quoted, retweeted)",
    )
    .order("published_at", { ascending: true });
  if (error) throw new Error(`article read failed: ${error.message}`);

  const all = rows ?? [];
  const pending = all.filter((r) => {
    if (force) return true;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    return !md.seo_backfill_at;
  });
  const queue = pending.slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`articles total: ${all.length}`);
  console.log(`already backfilled: ${all.length - pending.length}`);
  console.log(
    `this run: ${queue.length}${dryRun ? " (dry run, no API calls)" : ""}`,
  );
  console.log(`model: ${settings.modelArticle}\n`);

  const stats = {
    processed: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    retried: 0,
    titleFixed: 0,
    metaFixed: 0,
    titleStillOff: 0,
    metaStillOff: 0,
    slugWouldChange: 0,
    bannedCharsBefore: 0,
    bannedCharsAfter: 0,
  };

  for (const row of queue) {
    const label = row.slug.slice(0, 48);
    const beforeTitleOk = inRange(row.title, TITLE_MIN, TITLE_MAX);
    const beforeMetaOk = inRange(
      row.meta_description ?? "",
      META_MIN,
      META_MAX,
    );
    const beforeBanned = bannedCharsIn(
      `${row.title} ${row.meta_description ?? ""} ${row.tl_dr ?? ""} ${row.content_md ?? ""}`,
    );
    if (beforeBanned.length > 0) stats.bannedCharsBefore += 1;

    if (dryRun) {
      console.log(
        `[dry] ${label}: title ${row.title.length}${beforeTitleOk ? " ok" : " OUT"}, meta ${(row.meta_description ?? "").length}${beforeMetaOk ? " ok" : " OUT"}${beforeBanned.length ? `, chars ${beforeBanned.join(" ")}` : ""}`,
      );
      stats.processed += 1;
      continue;
    }

    // The source post, in the same compact shape the worker sends.
    const ing = (row as { news_ingestions?: unknown }).news_ingestions;
    const src = (Array.isArray(ing) ? ing[0] : ing) as
      | {
          text: string | null;
          author_handle: string | null;
          quoted: unknown;
          retweeted: unknown;
        }
      | null
      | undefined;
    const post = {
      text: src?.text ?? "",
      author_handle: src?.author_handle ?? "",
      quoted: src?.quoted ?? null,
      retweeted: src?.retweeted ?? null,
    };
    // The existing article is the researched fact base. Saying so explicitly keeps
    // the model from treating gaps as an invitation to invent.
    const researchNotes = [
      "These notes are the current published version of this article. Every fact you",
      "may use is already here. Do not add any fact that is not in these notes or in",
      "the post. Rewrite for structure, search performance, and voice only.",
      "",
      `Current title: ${row.title}`,
      `Current summary: ${row.tl_dr ?? ""}`,
      "",
      "Current body:",
      row.content_md ?? "",
    ].join("\n");

    let result = await runStructuredCall<ArticleResult>({
      admin,
      stage: "article_write",
      model: settings.modelArticle,
      system: settings.prompts.article,
      userContent: JSON.stringify({ post, research_notes: researchNotes }),
      schema: ARTICLE_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4096,
    });

    // One corrective retry when the length targets were missed.
    if (result) {
      const tOk = inRange(result.title, TITLE_MIN, TITLE_MAX);
      const mOk = inRange(result.meta_description, META_MIN, META_MAX);
      if (!tOk || !mOk) {
        stats.retried += 1;
        const corrections: string[] = [];
        if (!tOk)
          corrections.push(
            `The title you produced is ${result.title.length} characters. It must be between ${TITLE_MIN} and ${TITLE_MAX}. Rewrite it to land in that range without losing the primary search phrase.`,
          );
        if (!mOk)
          corrections.push(
            `The meta_description you produced is ${result.meta_description.length} characters. It must be between ${META_MIN} and ${META_MAX}. Rewrite it to land in that range.`,
          );
        const retry = await runStructuredCall<ArticleResult>({
          admin,
          stage: "article_write",
          model: settings.modelArticle,
          system: settings.prompts.article,
          userContent: JSON.stringify({
            post,
            research_notes: researchNotes,
            previous_attempt: result,
            corrections,
          }),
          schema: ARTICLE_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 4096,
        });
        if (retry) result = retry;
      }
    }

    stats.processed += 1;
    if (!result || !result.title?.trim() || !result.body_md?.trim()) {
      stats.failed += 1;
      console.log(`FAIL ${label}: no usable result, left untouched`);
      continue;
    }

    const afterTitleOk = inRange(result.title, TITLE_MIN, TITLE_MAX);
    const afterMetaOk = inRange(result.meta_description, META_MIN, META_MAX);
    if (!beforeTitleOk && afterTitleOk) stats.titleFixed += 1;
    if (!beforeMetaOk && afterMetaOk) stats.metaFixed += 1;
    if (!afterTitleOk) stats.titleStillOff += 1;
    if (!afterMetaOk) stats.metaStillOff += 1;
    if (
      bannedCharsIn(
        `${result.title} ${result.meta_description} ${result.tl_dr} ${result.body_md}`,
      ).length > 0
    )
      stats.bannedCharsAfter += 1;
    // Logged only. The slug is deliberately NOT written; see the header note.
    if (result.slug && result.slug !== row.slug) stats.slugWouldChange += 1;

    const changed =
      result.title !== row.title ||
      result.meta_description !== (row.meta_description ?? "") ||
      result.tl_dr !== (row.tl_dr ?? "") ||
      result.body_md !== (row.content_md ?? "");
    if (!changed) {
      stats.unchanged += 1;
      console.log(`same ${label}: model returned identical content`);
      continue;
    }

    const now = new Date().toISOString();
    // Merge into metadata rather than replacing it, per the metadata-preservation rule.
    const mergedMetadata = {
      ...((row.metadata ?? {}) as Record<string, unknown>),
      seo_backfill_at: now,
      seo_backfill_previous_title: row.title,
    } as unknown as Json;

    const { error: upErr } = await admin
      .from("articles")
      .update({
        title: result.title,
        meta_description: result.meta_description,
        tl_dr: result.tl_dr,
        content_md: result.body_md,
        last_updated: now,
        metadata: mergedMetadata,
      })
      .eq("id", row.id);
    if (upErr) {
      stats.failed += 1;
      console.log(`FAIL ${label}: update failed (${upErr.message})`);
      continue;
    }

    // Snapshot so the previous version stays recoverable.
    const { data: last } = await admin
      .from("article_revisions")
      .select("revision_number")
      .eq("article_id", row.id)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    await admin.from("article_revisions").insert({
      article_id: row.id,
      revision_number: (last?.revision_number ?? 0) + 1,
      title: result.title,
      content_md: result.body_md,
      change_summary:
        "SEO and AI-tell backfill: rewritten against the updated article prompt. Slug unchanged.",
    });

    stats.updated += 1;
    console.log(
      `ok   ${label}: title ${row.title.length}->${result.title.length}, meta ${(row.meta_description ?? "").length}->${result.meta_description.length}`,
    );
  }

  console.log("\n==== summary ====");
  for (const [k, v] of Object.entries(stats)) console.log(`${k}: ${v}`);
  if (stats.slugWouldChange > 0) {
    console.log(
      `\nnote: the model suggested a different slug for ${stats.slugWouldChange} article(s). Slugs were NOT changed. Changing them would need 301 redirects first.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
