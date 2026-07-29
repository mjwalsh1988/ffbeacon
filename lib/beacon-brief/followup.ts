/**
 * Follow-up linking for The Beacon Brief.
 *
 * Shared by the curation pass (./curate.ts) and the queue worker (./worker.ts) so
 * both ask the same question against the same DB-backed prompt: does this source
 * post belong to a story we already have an article for?
 *
 * WHY THE CHECK RUNS IN TWO PLACES
 *
 * Curation is the natural place to ask, and for a story that develops over hours or
 * days it is the only place that needs to. But it has a blind spot. Curation walks a
 * poll batch item by item and only ENQUEUES the article write; the article itself is
 * written later by the worker. So when two posts about ONE event land in the same
 * poll window, the second post is curated while the first still has no article row,
 * the candidate list cannot offer it, and both posts take the 'create' path. That is
 * how four pairs of duplicate articles reached production, each pair published 37 to
 * 130 seconds apart (see migration 0151).
 *
 * The worker closes the gap by asking again at the last responsible moment, right
 * before it spends tokens writing. Queue jobs run sequentially inside a run, so by
 * the time the second post's job executes, the first post's article exists and its
 * ingestion row carries article_id.
 *
 * THE LATE CHECK IS DELIBERATELY NARROW
 *
 * It considers only articles created strictly AFTER the post's own ingestion row was
 * created. That is precisely the set curation could not have seen, and nothing else.
 * Every older article was already offered to the curate-time matcher, so re-asking
 * about them here would add nothing but a second chance to make a mistake. The bound
 * needs no tuning and no magic time window: "did this article exist when I was
 * curated?" is the exact question.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { runStructuredCall } from "./ai";
import type { BeaconBriefSettings } from "./settings";

type Admin = SupabaseClient<Database>;

/** Default number of recent articles offered to the matcher. */
const DEFAULT_CANDIDATE_LIMIT = 15;

/**
 * An article statuses check: 'archived' articles are never merge targets. Folding a
 * new post into one would write the update somewhere no reader can reach, because
 * both the sitemap and the public feed filter on status = 'published'.
 */
const MERGEABLE_STATUSES = ["published", "draft"] as const;

export const FOLLOWUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matched_article_id"],
  properties: { matched_article_id: { type: "string" } },
} as const;

export interface FollowupCandidate {
  ingestion_id: string;
  article_id: string;
  title: string;
  summary: string;
}

export interface LoadCandidatesOptions {
  sourceId: string;
  lookbackDays: number;
  /** Never offer a post its own ingestion (and therefore its own article) back. */
  excludeIngestionId?: string | null;
  /**
   * Only articles created strictly after this ISO timestamp. Used by the worker's
   * late check to consider exactly the articles curation could not have seen.
   */
  articleCreatedAfter?: string | null;
  limit?: number;
}

/**
 * Recent articles from one source, newest first, as follow-up candidates.
 *
 * Two queries rather than an embedded filter: `articles` carries no source_id (the
 * link runs through news_ingestions), and filtering on an embedded resource would
 * apply the row limit before the status and created_at filters, which can silently
 * empty the candidate list.
 */
export async function loadFollowupCandidates(
  admin: Admin,
  opts: LoadCandidatesOptions,
): Promise<FollowupCandidate[]> {
  const limit = opts.limit ?? DEFAULT_CANDIDATE_LIMIT;
  const lookbackDays = opts.lookbackDays > 0 ? opts.lookbackDays : 1;
  const cutoff = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Over-fetch: the status and created_at filters below drop rows, and applying the
  // final limit after those filters is what keeps a real candidate from being
  // squeezed out by an archived or too-old sibling.
  let q = admin
    .from("news_ingestions")
    .select("id, article_id")
    .eq("source_id", opts.sourceId)
    .not("article_id", "is", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit * 4);
  if (opts.excludeIngestionId) q = q.neq("id", opts.excludeIngestionId);

  const { data: rows } = await q;
  if (!rows || rows.length === 0) return [];

  // Several posts can point at one article (a story that has already been revised).
  // Keep the newest ingestion per article so the article is offered exactly once.
  const orderedArticleIds: string[] = [];
  const ingestionByArticle = new Map<string, string>();
  for (const r of rows) {
    const articleId = r.article_id;
    if (!articleId || ingestionByArticle.has(articleId)) continue;
    ingestionByArticle.set(articleId, r.id);
    orderedArticleIds.push(articleId);
  }
  if (orderedArticleIds.length === 0) return [];

  let aq = admin
    .from("articles")
    .select("id, title, tl_dr")
    .in("id", orderedArticleIds)
    .in("status", MERGEABLE_STATUSES as unknown as string[]);
  if (opts.articleCreatedAfter) {
    aq = aq.gt("created_at", opts.articleCreatedAfter);
  }
  const { data: articles } = await aq;
  if (!articles || articles.length === 0) return [];

  const byId = new Map(articles.map((a) => [a.id, a]));
  const out: FollowupCandidate[] = [];
  for (const articleId of orderedArticleIds) {
    const art = byId.get(articleId);
    if (!art) continue;
    out.push({
      ingestion_id: ingestionByArticle.get(articleId) as string,
      article_id: articleId,
      title: art.title ?? "",
      summary: art.tl_dr ?? "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Ask the model whether the post belongs to one of the candidate stories.
 *
 * Returns the matched candidate, or null when the model declines or names an id
 * that is not on the list it was given. Never throws: a failed call means "no
 * match", which degrades to the current behaviour of writing a new article rather
 * than losing the post.
 */
export async function findFollowupTarget(args: {
  admin: Admin;
  settings: BeaconBriefSettings;
  /** Compact, model-facing view of the post. */
  post: unknown;
  candidates: FollowupCandidate[];
  sourceId?: string | null;
  ingestionId?: string | null;
}): Promise<FollowupCandidate | null> {
  const { admin, settings, post, candidates } = args;
  if (candidates.length === 0) return null;
  if (!settings.prompts.followupLink) return null;

  const matched = await runStructuredCall<{ matched_article_id: string }>({
    admin,
    stage: "revision_link",
    model: settings.modelTriage,
    system: settings.prompts.followupLink,
    userContent: JSON.stringify({
      post,
      candidates: candidates.map((c) => ({
        id: c.article_id,
        title: c.title,
        summary: c.summary,
      })),
    }),
    schema: FOLLOWUP_SCHEMA as unknown as Record<string, unknown>,
    sourceId: args.sourceId ?? null,
    ingestionId: args.ingestionId ?? null,
    maxTokens: 256,
  });

  const id = matched?.matched_article_id?.trim();
  if (!id) return null;
  return candidates.find((c) => c.article_id === id) ?? null;
}
