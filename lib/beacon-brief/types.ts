/**
 * The Beacon Brief: shared, source-agnostic types.
 *
 * BeaconBriefSourceItem is the contract every ingestor must emit. Stage 2 (the
 * curation routing) and the queue worker operate ONLY on this shape, so adding a
 * new source later means writing a new ingestor that produces this type and
 * nothing downstream changes.
 */

export type BeaconBriefSourceType = "x";

export interface BeaconBriefMedia {
  type: "photo" | "video" | "gif";
  url: string;
}

/** Quoted or retweeted content carried along with a post for context. */
export interface BeaconBriefQuoted {
  author_handle: string | null;
  text: string;
  media: BeaconBriefMedia[];
}

/** The normalized post every source ingestor emits. */
export interface BeaconBriefSourceItem {
  source_type: BeaconBriefSourceType;
  /** Our news_sources.id (UUID). */
  source_id: string;
  /** The source's native post id (e.g. tweet id). Dedup key with source_id. */
  source_external_id: string;
  external_url: string;
  author_handle: string;
  author_display_name: string;
  text: string;
  media: BeaconBriefMedia[];
  quoted: BeaconBriefQuoted | null;
  retweeted: BeaconBriefQuoted | null;
  /**
   * True when this post is a retweet whose original could NOT be resolved (the
   * referenced tweet was deleted, withheld, or not returned by the API even after
   * hydration). In that state `text` is only the truncated "RT @user:" stub, so
   * the item must never be turned into an article (it would publish stub text).
   */
  retweet_unresolved: boolean;
  /** True when this post is a native source edit of an earlier post. */
  is_native_edit: boolean;
  /** The earlier post id this natively edits, if any. */
  edit_of_external_id: string | null;
  /** ISO timestamp of the post. */
  created_at: string;
  /** The full raw source object, preserved verbatim into metadata. */
  raw: unknown;
}

/** Strict JSON returned by the inline categorize + context-score call. */
export interface CategorizeResult {
  /** 1 = not about football (filtered to review); 0 = football, continue. */
  non_football: number;
  /**
   * How much a fantasy manager would act on this, 0 to 3.
   *   3 a current player's football situation changed
   *   2 a team's deployment of its players changed
   *   1 real football news that changes no fantasy decision
   *   0 not football at all
   * Compared against bb_relevance_threshold. Distinct from context_score, which
   * only asks whether there is enough information to write an article at all: a
   * well-sourced obituary scores 1 on context and 1 on relevance.
   */
  relevance_tier: number;
  /** One clause explaining the tier. Shown to the admin in the Filtered queue. */
  relevance_reason: string;
  /** 0 = not enough context for an article (Discord only); 1 = make an article. */
  context_score: number;
  category_slug: string | null;
  /** NFL player full names mentioned. */
  players: string[];
  /** NFL team names or abbreviations mentioned. */
  teams: string[];
  tags: string[];
  suggested_title: string;
  suggested_slug: string;
}

/** Strict JSON returned by the article writing call. */
export interface ArticleResult {
  title: string;
  slug: string;
  meta_description: string;
  tl_dr: string;
  body_md: string;
  /**
   * The writer's own verdict after research. False means the research revealed
   * the story does not belong on the site at all, which the curation-time gate
   * could not have known from the post text alone (the canonical case: a recruit
   * commitment whose post never names the sport, and research finds it is
   * basketball). False aborts the publish; see handleArticleWrite in ./worker.ts.
   */
  fantasy_impact: boolean;
  /** Why fantasy_impact is false. Empty string when it is true. */
  no_impact_reason: string;
}

/** Strict JSON returned by the revision rewrite (merge) call. */
export interface RevisionRewriteResult {
  title: string;
  meta_description: string;
  tl_dr: string;
  body_md: string;
  change_summary: string;
}

/** A candidate suggestion attached to a reference-match moderation row. */
export interface MatchCandidate {
  id: string;
  label: string;
}

/** A reference (player/team) name that did not confidently auto-resolve. */
export interface PendingReferenceMatch {
  kind: "player" | "team";
  rawName: string;
  candidates: MatchCandidate[];
}

/** Output of the reference matcher: confident auto-links + names needing review. */
export interface ReferenceMatchResult {
  categoryId: string | null;
  playerIds: string[];
  teamIds: string[];
  roleIds: string[];
  pending: PendingReferenceMatch[];
}

/**
 * deletion_check is retained so historical rows still type-check; the worker no
 * longer creates them. deletion_sweep replaced it: one job re-verifies every post
 * whose next tapered checkpoint has passed, batched 100 ids per request.
 */
export type QueueJobType =
  | "discord_post"
  | "discord_patch"
  | "article_write"
  | "deletion_check"
  | "deletion_sweep";

/**
 * Payload stored on a beacon_brief_queue row.
 *
 * Every job type except deletion_sweep references one ingestion. The sweep works
 * from stored table state rather than a payload, which is exactly what makes it
 * survive an outage: there is no per-article job to lose.
 */
export interface QueueJobPayload {
  ingestion_id: string;
  /** For article_write: 'create' (new) or 'rewrite' (critical revision merge). */
  mode?: "create" | "rewrite";
  [key: string]: unknown;
}
