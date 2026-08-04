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
 *
 * WHY THE MODEL IS NOT TRUSTED ALONE
 *
 * The prompt tells the matcher to answer null when a post is a different event that
 * merely involves the same team, and at production scale it ignored that constantly:
 * 75% of everything that reached the article stage was absorbed into an existing
 * article, including a retired-player note folded into a contract extension and a
 * 49ers signing folded into a Texans workout. The worst case put Bijan Robinson's
 * record contract inside an article titled for an offensive lineman, where it
 * reached no reader.
 *
 * So the model now proposes and code disposes. Two mechanical gates run BEFORE the
 * call, in eligibleMergeCandidates() and mergeBlockedByTier() below, and a candidate
 * the gates reject is never shown to the model. Both are deliberately about facts
 * the model is bad at holding onto (who is this actually about, how big is it) and
 * cheap for us to check exactly.
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
  /** Who the article is actually about, from article_players / article_teams. */
  player_ids: string[];
  team_ids: string[];
}

/** Who an incoming post is about, plus how big the classifier judged it. */
export interface PostSubject {
  playerIds: string[];
  teamIds: string[];
  /** CategorizeResult.relevance_tier, or null when the post was never classified. */
  relevanceTier: number | null;
}

function intersects(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

/**
 * Does the post share a subject with the article, so that "same event" is even
 * possible?
 *
 * Players decide it whenever both sides have them: two posts naming disjoint sets
 * of players are not one event, whatever the wording suggests. This is what stops
 * "Saints placed WR Ja'Lynn Polk on the reserve/retired list" from merging into
 * "Chris Olave signs $132M extension with Saints".
 *
 * When either side has no linked player we fall back to teams, which is the honest
 * weaker signal for team-level news (a coaching change, a depth chart note). When
 * neither side has any linked reference at all we allow the model to decide,
 * because we then know nothing and blocking would silently break follow-ups on
 * posts whose names failed to resolve.
 */
export function sharesSubject(
  post: PostSubject,
  candidate: FollowupCandidate,
): boolean {
  if (post.playerIds.length > 0 && candidate.player_ids.length > 0)
    return intersects(post.playerIds, candidate.player_ids);
  if (post.teamIds.length > 0 && candidate.team_ids.length > 0)
    return intersects(post.teamIds, candidate.team_ids);
  const postHasRefs = post.playerIds.length + post.teamIds.length > 0;
  const candHasRefs =
    candidate.player_ids.length + candidate.team_ids.length > 0;
  return !postHasRefs || !candHasRefs;
}

/** Drop every candidate that cannot be the same event as this post. */
export function eligibleMergeCandidates(
  post: PostSubject,
  candidates: FollowupCandidate[],
): FollowupCandidate[] {
  return candidates.filter((c) => sharesSubject(post, c));
}

/**
 * Is this post too big to be folded into someone else's article?
 *
 * A merge costs the post its own headline, its own URL, and its own Discord card.
 * That is a reasonable trade for an incremental update and a terrible one for a
 * major story, which is exactly what happened to the Bijan Robinson contract. Any
 * post the classifier rates at or above the block tier keeps its own article, and
 * a later post about the same event can still merge into THAT one.
 *
 * blockTier <= 0 disables the floor.
 */
export function mergeBlockedByTier(
  post: PostSubject,
  blockTier: number,
): boolean {
  if (blockTier <= 0) return false;
  return (post.relevanceTier ?? 0) >= blockTier;
}

export interface LoadCandidatesOptions {
  sourceId: string;
  /**
   * How far back to look for a story this post might continue. Hours, not days:
   * at three days the matcher was reaching across unrelated news cycles and the
   * mis-merges clustered at the very top of the window.
   */
  lookbackHours: number;
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
  const lookbackHours = opts.lookbackHours > 0 ? opts.lookbackHours : 1;
  const cutoff = new Date(
    Date.now() - lookbackHours * 60 * 60 * 1000,
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

  // Who each candidate is about. The title and summary alone are what let the
  // matcher confuse two stories: the article about a guard's extension mentioned
  // Bijan Robinson in its summary, so the model saw the same names twice. The
  // linked ids are the unambiguous version of the same question.
  const liveIds = articles.map((a) => a.id);
  const [{ data: playerRows }, { data: teamRows }] = await Promise.all([
    admin.from("article_players").select("article_id, player_id").in("article_id", liveIds),
    admin.from("article_teams").select("article_id, team_id").in("article_id", liveIds),
  ]);
  const playersByArticle = new Map<string, string[]>();
  for (const r of playerRows ?? []) {
    const list = playersByArticle.get(r.article_id);
    if (list) list.push(r.player_id);
    else playersByArticle.set(r.article_id, [r.player_id]);
  }
  const teamsByArticle = new Map<string, string[]>();
  for (const r of teamRows ?? []) {
    const list = teamsByArticle.get(r.article_id);
    if (list) list.push(r.team_id);
    else teamsByArticle.set(r.article_id, [r.team_id]);
  }

  const out: FollowupCandidate[] = [];
  for (const articleId of orderedArticleIds) {
    const art = byId.get(articleId);
    if (!art) continue;
    out.push({
      ingestion_id: ingestionByArticle.get(articleId) as string,
      article_id: articleId,
      title: art.title ?? "",
      summary: art.tl_dr ?? "",
      player_ids: playersByArticle.get(articleId) ?? [],
      team_ids: teamsByArticle.get(articleId) ?? [],
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
