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

export type QueueJobType =
  | "discord_post"
  | "discord_patch"
  | "article_write"
  | "deletion_check";

/** Payload stored on a beacon_brief_queue row. Always references the ingestion. */
export interface QueueJobPayload {
  ingestion_id: string;
  /** For article_write: 'create' (new) or 'rewrite' (critical revision merge). */
  mode?: "create" | "rewrite";
  [key: string]: unknown;
}
