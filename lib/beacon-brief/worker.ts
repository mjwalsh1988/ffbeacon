/**
 * The Beacon Brief queue worker (runs every minute).
 *
 * Claims pending jobs atomically via bb_claim_jobs (FOR UPDATE SKIP LOCKED) so
 * overlapping runs never collide, then executes them:
 *   - discord_post / discord_patch: post or edit the Discord message (skipped in
 *     shadow mode), capped per run to stay under the webhook rate limit.
 *   - article_write: 2-step (web-search research when enabled, then strict
 *     structuring) to create or rewrite the article, link players/teams, and
 *     snapshot a revision.
 *   - deletion_sweep: re-verify every published post whose next tapered
 *     checkpoint has passed, batched 100 ids per request. One sweep in flight at
 *     a time, scheduled by ensureDeletionSweepScheduled below.
 *   - deletion_check: legacy per-article job, retired on sight. See ./deletion.ts.
 * On error/429 it backs off (run_after pushed out, attempts++); after the
 * configured max attempts the job is marked failed, a moderation row opens, and
 * an admin email goes out subject to the cooldown in ./health.ts.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  deleteWebhookMessage,
  patchWebhookMessage,
  postWebhookMessage,
  type DiscordAttachment,
  type DiscordEmbed,
  type DiscordMessageInput,
} from "@/lib/discord";
import { logBeaconBrief, runStructuredCall, runWebSearchResearch } from "./ai";
import { loadBeaconBriefSettings, type BeaconBriefSettings } from "./settings";
import {
  sendBeaconBriefFailureEmail,
  sendBeaconBriefVolumeCapEmail,
} from "./email";
import { runDeletionSweep } from "./deletion";
import { shouldEmailQueueFailure, shouldEmailVolumeCap } from "./health";
import {
  eligibleMergeCandidates,
  findExactEventMatch,
  findFollowupTarget,
  loadFollowupCandidates,
  loadOverlapCandidates,
  mergeBlockedByTier,
  type FollowupCandidate,
  type PostSubject,
} from "./followup";
import { postAddsNewInformation } from "./merge";
import {
  researchPrecheck,
  verdictAllowsSkip,
  type ResearchGateVerdict,
} from "./research-gate";
import { checkArticleVolume } from "./volume-guard";
import type {
  ArticleResult,
  BeaconBriefMedia,
  BeaconBriefQuoted,
  QueueJobPayload,
  RevisionRewriteResult,
} from "./types";

type Admin = SupabaseClient<Database>;
type QueueRow = Database["public"]["Tables"]["beacon_brief_queue"]["Row"];
type Ingestion = Database["public"]["Tables"]["news_ingestions"]["Row"];

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "slug",
    "meta_description",
    "tl_dr",
    "body_md",
    "fantasy_impact",
    "no_impact_reason",
  ],
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    meta_description: { type: "string" },
    tl_dr: { type: "string" },
    body_md: { type: "string" },
    fantasy_impact: { type: "boolean" },
    no_impact_reason: { type: "string" },
  },
} as const;

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "meta_description", "tl_dr", "body_md", "change_summary"],
  properties: {
    title: { type: "string" },
    meta_description: { type: "string" },
    tl_dr: { type: "string" },
    body_md: { type: "string" },
    change_summary: { type: "string" },
  },
} as const;

const RESEARCH_GATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["needs_research", "reason"],
  properties: {
    needs_research: { type: "boolean" },
    reason: { type: "string" },
  },
} as const;

interface WorkerSummary {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  reaped: number;
  released: number;
  skipped?: boolean;
  reason?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isDiscordJob(jobType: string): boolean {
  return jobType === "discord_post" || jobType === "discord_patch";
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "beacon-brief"
  );
}

/**
 * How much the post actually says on its own, ignoring links and handles.
 *
 * A quote-tweet whose own text is "Worst part of training camp:" carries a link and a
 * fragment. Once the URL is stripped there are 26 characters of content, and they do
 * not name a player, an event, or a team.
 */
function substantiveTextLength(
  parts: Array<string | null | undefined>,
): number {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Below this, a post is a fragment rather than a report. Deliberately low: the aim is
 * to catch "Worst part of training camp:" and a bare headline, not to second-guess a
 * short but complete sentence like "Jonathan Taylor officially has signed his two-year
 * extension." (62 characters, and it says who and what).
 */
const MIN_SUBSTANTIVE_POST_CHARS = 60;

/**
 * The article a colliding slug already belongs to, when the collision looks like a
 * duplicate rather than a coincidence.
 */
interface SlugCollision {
  article_id: string;
  title: string;
  slug: string;
}

/**
 * Resolve the slug for a new article, and report a collision that looks like a
 * duplicate.
 *
 * A slug collision is the strongest duplicate signal the pipeline has. The writer
 * independently reached for the same handful of words, from the same event, about the
 * same player. Until migration 0177 this was treated as a naming inconvenience: it
 * appended five random hex characters and published. Every one of those suffixes in
 * the database marks a duplicate the system detected and then released.
 *
 *   peter-skoronski-extension-titans-c6e5c
 *   jahmyr-gibbs-record-rb-contract-lions-11d5c
 *   jonathan-taylor-colts-extension-a38a2
 *
 * The suffix is still correct for a genuine coincidence, two unrelated stories that
 * happen to compress to the same words, so it stays. What changes is that the caller
 * is told when the collision shares a subject with a live article inside the merge
 * window, which is not a coincidence and should be merged instead of published.
 */
async function resolveSlug(
  admin: Admin,
  base: string,
  opts: { playerIds: string[]; windowHours: number },
): Promise<{ slug: string; collision: SlugCollision | null }> {
  const slug = slugify(base);
  const { data: existing } = await admin
    .from("articles")
    .select("id, title, slug, created_at, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!existing) return { slug, collision: null };

  const suffix = randomBytes(4).toString("hex").slice(0, 5);
  const suffixed = `${slug}-${suffix}`;

  const hours = opts.windowHours > 0 ? opts.windowHours : 72;
  const fresh =
    Date.now() - new Date(existing.created_at).getTime() < hours * 3_600_000;
  const live = existing.status === "published" || existing.status === "draft";
  if (!fresh || !live || opts.playerIds.length === 0) {
    return { slug: suffixed, collision: null };
  }

  // Shares a subject? Then this is the same story wearing a different sentence.
  const { data: shared } = await admin
    .from("article_players")
    .select("player_id")
    .eq("article_id", existing.id)
    .in("player_id", opts.playerIds)
    .limit(1);
  if (!shared || shared.length === 0)
    return { slug: suffixed, collision: null };

  return {
    slug: suffixed,
    collision: {
      article_id: existing.id,
      title: existing.title ?? "",
      slug: existing.slug,
    },
  };
}

function resolvedFrom(ingestion: Ingestion): {
  categoryId: string | null;
  playerIds: string[];
  teamIds: string[];
  roleIds: string[];
  tags: string[];
  categorySlug: string | null;
} {
  const ai = (ingestion.ai_result ?? {}) as Record<string, unknown>;
  const resolved = (ai.resolved ?? {}) as Record<string, unknown>;
  return {
    categoryId: (resolved.categoryId as string) ?? null,
    playerIds: Array.isArray(resolved.playerIds)
      ? (resolved.playerIds as string[])
      : [],
    teamIds: Array.isArray(resolved.teamIds)
      ? (resolved.teamIds as string[])
      : [],
    roleIds: Array.isArray(resolved.roleIds)
      ? (resolved.roleIds as string[])
      : [],
    tags: Array.isArray(ai.tags) ? (ai.tags as string[]) : [],
    categorySlug: (ai.category_slug as string) ?? null,
  };
}

// FF Beacon brand purple (#A855F7) as the card's left-bar accent.
const BEACON_CARD_COLOR = 0xa855f7;
// Title shown when a post has no AI-suggested headline yet.
const DEFAULT_DISCORD_TITLE = "News Update";
// Discord allows up to 10 files; X posts carry at most 4 media.
const MAX_DISCORD_ATTACHMENTS = 4;
// Cap per-image bytes well under Discord's upload limit (twitter images are small).
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 10_000;

/** The headline for the Discord card: the AI-suggested title, or a default. */
function articleTitleFor(ingestion: Ingestion): string {
  const ai = (ingestion.ai_result ?? {}) as Record<string, unknown>;
  const t =
    typeof ai.suggested_title === "string" ? ai.suggested_title.trim() : "";
  return t || DEFAULT_DISCORD_TITLE;
}

/** Map a content-type to a file extension for the uploaded attachment name. */
function extForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Download one media URL into an uploadable attachment. Images only (videos and
 * gifs resolve to their thumbnail image at ingest time). Returns null on any
 * failure, an oversized file, or a non-image response so a bad URL never blocks
 * the post.
 */
async function fetchMediaAttachment(
  url: string,
  index: number,
): Promise<DiscordAttachment | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const contentType = (
      res.headers.get("content-type") ?? "image/jpeg"
    ).toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > MAX_ATTACHMENT_BYTES)
      return null;
    return {
      filename: `media-${index + 1}.${extForContentType(contentType)}`,
      data,
      contentType,
    };
  } catch {
    return null;
  }
}

/**
 * Order the candidate images for the Discord card before the attachment cap is
 * applied. The post's primary content leads (for a retweet that is the retweeted
 * original's media; for everything else the post's own media), then the referenced
 * (quoted/retweeted) context media. When BOTH primary and context media exist, one
 * cap slot is reserved for the first context image so a quote that piles on its own
 * images cannot crowd out the original's picture (F3). Deduped by URL, order
 * preserved. Returns the full ordered list (not truncated) so the caller can fall
 * through to later candidates if an earlier download fails.
 */
export function orderMediaForDiscord(
  own: BeaconBriefMedia[],
  quotedMedia: BeaconBriefMedia[],
  retweetedMedia: BeaconBriefMedia[],
  isRetweet: boolean,
  cap: number,
): BeaconBriefMedia[] {
  const primary = isRetweet ? retweetedMedia : own;
  const context = isRetweet ? own : [...quotedMedia, ...retweetedMedia];
  const reserve = primary.length > 0 && context.length > 0 ? 1 : 0;
  const lead = Math.max(0, cap - reserve);
  const ordered = [
    ...primary.slice(0, lead),
    ...context,
    ...primary.slice(lead),
  ];
  const out: BeaconBriefMedia[] = [];
  const seen = new Set<string>();
  for (const m of ordered) {
    if (!m?.url || seen.has(m.url)) continue;
    seen.add(m.url);
    out.push(m);
  }
  return out;
}

/**
 * Fetch a post's images as Discord attachments, capped at MAX_DISCORD_ATTACHMENTS.
 * Ordering (own + quoted/retweeted context, with a reserved context slot) comes
 * from orderMediaForDiscord so a retweet or quote of an image post still carries
 * the right picture.
 */
async function buildMediaAttachments(
  ingestion: Ingestion,
): Promise<DiscordAttachment[]> {
  const own = (ingestion.media ?? []) as unknown as BeaconBriefMedia[];
  const quoted = ingestion.quoted as unknown as BeaconBriefQuoted | null;
  const retweeted = ingestion.retweeted as unknown as BeaconBriefQuoted | null;
  const ordered = orderMediaForDiscord(
    own,
    quoted?.media ?? [],
    retweeted?.media ?? [],
    retweeted !== null,
    MAX_DISCORD_ATTACHMENTS,
  );
  const out: DiscordAttachment[] = [];
  for (const m of ordered) {
    if (out.length >= MAX_DISCORD_ATTACHMENTS) break;
    if (!m.url) continue;
    const att = await fetchMediaAttachment(m.url, out.length);
    if (att) out.push(att);
  }
  return out;
}

/**
 * Build the Discord message as a branded card: role mentions (the only pinging
 * content) above a purple-accented embed carrying the headline + post text, an
 * optional quoted/retweeted embed, and the post's images as real file
 * attachments. The card's title bar makes back-to-back posts easy to tell apart.
 * The direct link to the source post is deliberately omitted.
 */
function buildDiscordMessage(
  ingestion: Ingestion,
  roleIds: string[],
  attachments: DiscordAttachment[],
): DiscordMessageInput {
  // Mentions live in content so they actually ping; nothing else goes here.
  const content = roleIds.map((id) => `<@&${id}>`).join(" ");

  const bodyText = (ingestion.text ?? "").trim();

  // Attribution: a retweet shows the original author (with the relaying source in
  // parentheses) because the promoted body text is the original author's words; a
  // normal post or a quote keeps the relaying account as the author.
  const retweeted = ingestion.retweeted as unknown as BeaconBriefQuoted | null;
  // A retweet ref wins even if a quote ref is also present, matching how the
  // normalizer promotes the retweeted text (F4).
  const isRetweet = retweeted !== null;
  const sourceHandle = ingestion.author_handle;
  let authorName: string | undefined;
  if (isRetweet && retweeted?.author_handle) {
    authorName = sourceHandle
      ? `@${retweeted.author_handle} (via @${sourceHandle})`
      : `@${retweeted.author_handle}`;
  } else if (sourceHandle) {
    authorName = `@${sourceHandle}`;
  }

  const card: DiscordEmbed = {
    color: BEACON_CARD_COLOR,
    title: articleTitleFor(ingestion),
    author: authorName ? { name: authorName } : undefined,
    description: bodyText ? bodyText.slice(0, 4000) : undefined,
    footer: { text: "The Beacon Brief" },
  };
  const embeds: DiscordEmbed[] = [card];

  // Secondary embed carries the quoted/retweeted original's text for context.
  // Skip it when that text was already promoted into the card body (retweets), so
  // the same words never appear twice.
  const context = (ingestion.quoted ??
    ingestion.retweeted) as unknown as BeaconBriefQuoted | null;
  if (context?.text && context.text.trim() !== bodyText) {
    embeds.push({
      author: context.author_handle
        ? { name: `@${context.author_handle}` }
        : undefined,
      description: context.text.slice(0, 2000),
    });
  }

  return { content, embeds, allowedRoleIds: roleIds, attachments };
}

async function loadIngestion(
  admin: Admin,
  id: string,
): Promise<Ingestion | null> {
  const { data } = await admin
    .from("news_ingestions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

async function activeWebhookUrl(
  admin: Admin,
  settings: BeaconBriefSettings,
): Promise<string | null> {
  if (!settings.webhookId) return null;
  const { data } = await admin
    .from("discord_webhooks")
    .select("url, is_active")
    .eq("id", settings.webhookId)
    .maybeSingle();
  return data && data.is_active ? data.url : null;
}

/** Mark a job done. */
async function markDone(admin: Admin, jobId: string): Promise<void> {
  await admin
    .from("beacon_brief_queue")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * Back off and retry, or mark failed (and email) after the attempt cap.
 *
 * Every transition is guarded by `status = 'processing'` (and, for the reaper,
 * the stale cutoff) so only ONE run can move a given job out of processing. If
 * the guard matches nothing (a concurrent run already handled the job), it
 * returns "lost" and the caller does not double-count or double-email.
 */
async function failOrRetry(
  admin: Admin,
  job: QueueRow,
  settings: BeaconBriefSettings,
  errorMsg: string,
  retryAfterMs?: number | null,
  staleBefore?: string | null,
): Promise<"retry" | "failed" | "lost"> {
  const attempts = job.attempts + 1;
  const now = new Date().toISOString();
  if (attempts >= settings.queueMaxAttempts) {
    let q = admin
      .from("beacon_brief_queue")
      .update({
        status: "failed",
        attempts,
        last_error: errorMsg,
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("status", "processing");
    if (staleBefore) q = q.lt("updated_at", staleBefore);
    const { data: won } = await q.select("id");
    if (!won || won.length === 0) return "lost"; // another run already handled it
    // A failed article_write means the article is never written, so its pending
    // reference-match moderation rows can never be resolved (they need the
    // article_id). Close them so they leave the queue instead of stranding.
    const payload = job.payload as unknown as QueueJobPayload;
    if (job.job_type === "article_write") {
      if (payload?.ingestion_id) {
        await admin
          .from("beacon_brief_moderation")
          .update({ status: "rejected", resolved_at: now })
          .eq("ingestion_id", payload.ingestion_id)
          .is("article_id", null)
          .eq("status", "pending")
          .in("type", ["player_match", "team_match"]);
      }
    }
    // Surface the permanently-failed job in the admin Moderation queue so it can
    // be retried (resets this one job to pending) or skipped (leaves it failed,
    // closes this row). Nothing else about the pipeline run is touched.
    await admin.from("beacon_brief_moderation").insert({
      queue_job_id: job.id,
      ingestion_id: payload?.ingestion_id ?? null,
      type: "failed_task",
      status: "pending",
      detail: {
        job_type: job.job_type,
        error: errorMsg,
        attempts,
      } as unknown as Json,
    });
    // The moderation row above always gets written; only the email is throttled.
    // One root cause can fail many jobs (the 2026-07-31 X outage failed 30), and
    // one email per job made the inbox the least useful place to learn that.
    const alert = await shouldEmailQueueFailure(admin, settings);
    if (alert.send) {
      await sendBeaconBriefFailureEmail({
        jobType: job.job_type,
        jobId: job.id,
        attempts,
        error: errorMsg,
        suppressedSince: alert.suppressedSince,
      });
    }
    return "failed";
  }
  const delay =
    retryAfterMs && retryAfterMs > 0
      ? retryAfterMs
      : Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);
  let q = admin
    .from("beacon_brief_queue")
    .update({
      status: "pending",
      attempts,
      last_error: errorMsg,
      run_after: new Date(Date.now() + delay).toISOString(),
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("status", "processing");
  if (staleBefore) q = q.lt("updated_at", staleBefore);
  const { data: won } = await q.select("id");
  if (!won || won.length === 0) return "lost";
  return "retry";
}

/**
 * Reclaim jobs stuck in 'processing' (their worker crashed or hit the function
 * timeout mid-job). The claim RPC stamps updated_at when it flips a job to
 * 'processing', so anything still 'processing' past the stale window had no
 * worker finish it. Route each through the normal backoff path (attempts++,
 * retry-or-fail+email) so a genuinely poisonous job cannot loop forever.
 */
async function reapStaleJobs(
  admin: Admin,
  settings: BeaconBriefSettings,
  summary: WorkerSummary,
): Promise<void> {
  const minutes =
    settings.staleProcessingMinutes > 0 ? settings.staleProcessingMinutes : 10;
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data: stale } = await admin
    .from("beacon_brief_queue")
    .select("*")
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(200);
  for (const job of stale ?? []) {
    // Pass the cutoff so the transition only wins if the row is STILL the stale
    // 'processing' row we read (closes the reap-vs-reclaim race between runs).
    const r = await failOrRetry(
      admin,
      job,
      settings,
      "reclaimed after stalled processing (worker crash or timeout)",
      null,
      cutoff,
    );
    if (r === "lost") continue; // another run already reclaimed it
    summary.reaped += 1;
    if (r === "failed") summary.failed += 1;
    else summary.retried += 1;
  }
}

// -------- job handlers (return true on success) --------

/**
 * Persist the Discord message id, retrying a few times so a single transient DB
 * error does not strand the id (which would block patches and risk a duplicate
 * repost on a job retry). Returns false if it never lands.
 */
async function recordDiscordMessageId(
  admin: Admin,
  ingestionId: string,
  messageId: string | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin
      .from("news_ingestions")
      .update({ discord_message_id: messageId })
      .eq("id", ingestionId);
    if (!error) return true;
    await sleep(200 * (attempt + 1));
  }
  return false;
}

async function handleDiscordPost(
  admin: Admin,
  job: QueueRow,
  settings: BeaconBriefSettings,
): Promise<{ ok: boolean; retryAfterMs?: number | null; error?: string }> {
  const payload = job.payload as unknown as QueueJobPayload;
  const ingestion = await loadIngestion(admin, payload.ingestion_id);
  if (!ingestion) return { ok: true }; // nothing to post; treat as done
  const roleIds = Array.isArray(payload.role_ids)
    ? (payload.role_ids as string[])
    : resolvedFrom(ingestion).roleIds;
  return postDiscordCard(admin, ingestion, roleIds, settings);
}

/**
 * Send one post to Discord as a new card, with every idempotency guard.
 *
 * Split out of handleDiscordPost so the patch handler can fall back to it when the
 * card it was asked to update is too old to be worth editing.
 */
async function postDiscordCard(
  admin: Admin,
  ingestion: Ingestion,
  roleIds: string[],
  settings: BeaconBriefSettings,
): Promise<{ ok: boolean; retryAfterMs?: number | null; error?: string }> {
  if (!settings.discordEnabled) {
    await logBeaconBrief(admin, {
      stage: "discord_post",
      ingestionId: ingestion.id,
      message: "shadow mode: skipped",
    });
    return { ok: true };
  }

  // Idempotency guard 1: a prior attempt already recorded the message id (the job
  // just never got marked done, e.g. a crash right after success). Do not repost.
  if (ingestion.discord_message_id) {
    await logBeaconBrief(admin, {
      stage: "discord_post",
      ingestionId: ingestion.id,
      message: "already posted (message id present); skipping repost",
    });
    return { ok: true };
  }
  // Idempotency guard 2: a prior attempt set the pre-post sentinel (webhook id)
  // but never recorded a message id, meaning it most likely posted and then
  // crashed before saving the id. Reposting would duplicate the card, so stop. The
  // card exists on Discord but cannot be patched; logged loudly for visibility (F10).
  if (ingestion.discord_webhook_id) {
    await logBeaconBrief(admin, {
      stage: "discord_post",
      level: "error",
      ingestionId: ingestion.id,
      message:
        "prior post attempt did not record a message id; not reposting to avoid a duplicate card",
    });
    return { ok: true };
  }

  const url = await activeWebhookUrl(admin, settings);
  if (!url) return { ok: false, error: "no active Discord webhook configured" };

  // Pre-post sentinel: record the target webhook BEFORE sending so a crash between
  // the send and the id-write cannot cause a duplicate repost (guard 2 above). On a
  // clean send failure we clear it again so a legitimate retry can repost.
  const { error: sentinelErr } = await admin
    .from("news_ingestions")
    .update({ discord_webhook_id: settings.webhookId })
    .eq("id", ingestion.id);
  if (sentinelErr)
    return {
      ok: false,
      error: `failed to set pre-post sentinel: ${sentinelErr.message}`,
    };

  const attachments = await buildMediaAttachments(ingestion);
  const res = await postWebhookMessage(
    url,
    buildDiscordMessage(ingestion, roleIds, attachments),
  );
  await logBeaconBrief(admin, {
    stage: "discord_post",
    level: res.ok ? "info" : "error",
    ingestionId: ingestion.id,
    message: res.ok ? "posted" : res.error,
    responsePayload: res as unknown as Json,
  });
  if (!res.ok) {
    // The send did not create a message; clear the sentinel so a retry can repost.
    await admin
      .from("news_ingestions")
      .update({ discord_webhook_id: null })
      .eq("id", ingestion.id);
    return { ok: false, retryAfterMs: res.retryAfterMs, error: res.error };
  }

  const recorded = await recordDiscordMessageId(admin, ingestion.id, res.id);
  if (!recorded) {
    await logBeaconBrief(admin, {
      stage: "discord_post",
      level: "error",
      ingestionId: ingestion.id,
      message:
        "posted but failed to persist discord_message_id after retries; not reposting (card may not be patchable)",
    });
  }
  return { ok: true };
}

async function handleDiscordPatch(
  admin: Admin,
  job: QueueRow,
  settings: BeaconBriefSettings,
): Promise<{ ok: boolean; retryAfterMs?: number | null; error?: string }> {
  const payload = job.payload as unknown as QueueJobPayload;
  const newIngestion = await loadIngestion(admin, payload.ingestion_id);
  const targetId = (payload.target_ingestion_id as string) ?? null;
  const target = targetId ? await loadIngestion(admin, targetId) : null;
  if (!newIngestion || !target) return { ok: true };

  if (!settings.discordEnabled) {
    await logBeaconBrief(admin, {
      stage: "discord_patch",
      ingestionId: newIngestion.id,
      message: "shadow mode: skipped",
    });
    return { ok: true };
  }
  if (!target.discord_message_id) {
    // The original post may simply not have landed YET (its discord_post is still
    // queued or in flight). Distinguish "pending post" (retry the patch so the
    // revision is not silently lost, F8) from "never going to post" (give up).
    // Array read + limit(1), not maybeSingle(): if two discord_post rows ever
    // exist for one target (retry/release churn), maybeSingle() errors and would
    // be read as "no pending post", silently dropping the revision (F8 hardening).
    const { data: pendingPosts } = await admin
      .from("beacon_brief_queue")
      .select("id")
      .eq("job_type", "discord_post")
      .in("status", ["pending", "processing"])
      .filter("payload->>ingestion_id", "eq", targetId)
      .limit(1);
    if (pendingPosts && pendingPosts.length > 0) {
      await logBeaconBrief(admin, {
        stage: "discord_patch",
        level: "warn",
        ingestionId: newIngestion.id,
        message:
          "target original not posted yet (discord_post still pending); will retry",
      });
      return {
        ok: false,
        error: "awaiting original discord_post (no message id yet)",
      };
    }
    await logBeaconBrief(admin, {
      stage: "discord_patch",
      level: "warn",
      ingestionId: newIngestion.id,
      message:
        "target original has no message id and no pending post; nothing to patch",
    });
    return { ok: true };
  }

  // A Discord edit is silent: it fires no notification, pings no role, and leaves
  // the message where it already sits in the channel. That is fine for an update
  // to a card people are still looking at, and useless for one from days ago. When
  // Bijan Robinson's contract was folded into a three-day-old card, eight straight
  // patches landed and no reader saw any of them. Past the age limit the follow-up
  // gets a card of its own instead of a silent edit nobody will read.
  const cardAgeMs = Date.now() - new Date(target.created_at).getTime();
  const maxCardAgeMs = settings.patchMaxAgeMinutes * 60_000;
  if (maxCardAgeMs > 0 && cardAgeMs > maxCardAgeMs) {
    await logBeaconBrief(admin, {
      stage: "discord_patch",
      level: "info",
      ingestionId: newIngestion.id,
      message: `target card is ${Math.round(cardAgeMs / 60_000)} minutes old (limit ${settings.patchMaxAgeMinutes}); posting a new card instead of a silent edit`,
    });
    return postDiscordCard(
      admin,
      newIngestion,
      resolvedFrom(newIngestion).roleIds,
      settings,
    );
  }

  const url = await activeWebhookUrl(admin, settings);
  if (!url) return { ok: false, error: "no active Discord webhook configured" };

  // A retract patch (approved deletion) overrides the content with a notice;
  // otherwise patch the original message id with the NEW post content.
  const message: DiscordMessageInput = payload.retract
    ? {
        content:
          "This story has been retracted. The original source post was removed.",
        embeds: [],
        allowedRoleIds: [],
        attachments: [],
      }
    : buildDiscordMessage(
        newIngestion,
        resolvedFrom(target).roleIds,
        await buildMediaAttachments(newIngestion),
      );
  const res = await patchWebhookMessage(
    url,
    target.discord_message_id,
    message,
  );
  await logBeaconBrief(admin, {
    stage: "discord_patch",
    level: res.ok ? "info" : "error",
    ingestionId: newIngestion.id,
    message: res.ok ? "patched" : res.error,
    responsePayload: res as unknown as Json,
  });
  if (!res.ok)
    return { ok: false, retryAfterMs: res.retryAfterMs, error: res.error };
  return { ok: true };
}

/**
 * Fold a post into an existing article: rewrite the body to absorb the new
 * information, snapshot a revision, and mark the ingestion revised.
 *
 * Shared by the two paths that reach it. `mode: 'rewrite'` jobs, which curation
 * enqueues when it recognises a follow-up up front, and the late duplicate guard in
 * the create path below, which catches the same-poll-window case curation is blind
 * to. Both want identical behaviour, so the logic lives here once.
 *
 * `applied: false` means the target article no longer exists (deleted between
 * enqueue and execution). That is a success for the queue: there is nothing to
 * rewrite and retrying will not change it.
 */
async function applyRewriteToArticle(
  admin: Admin,
  settings: BeaconBriefSettings,
  ingestion: Ingestion,
  articleId: string,
  compact: unknown,
): Promise<{ ok: boolean; error?: string; applied: boolean }> {
  const { data: article } = await admin
    .from("articles")
    .select("id, title, content_md, tl_dr, tags, category_id")
    .eq("id", articleId)
    .maybeSingle();
  if (!article) return { ok: true, applied: false };

  // Does this post actually change the story? Most follow-ups do not: they restate
  // the same contract in fewer words with a link to someone else's write-up. Ask once,
  // on the cheap model, before spending anything on prose. See ./merge.ts.
  const gate = await postAddsNewInformation({
    admin,
    settings,
    article,
    post: compact,
    ingestionId: ingestion.id,
  });
  if (!gate.addsNewInformation) {
    await admin
      .from("news_ingestions")
      .update({ status: "revised", processed_at: new Date().toISOString() })
      .eq("id", ingestion.id);
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "info",
      ingestionId: ingestion.id,
      message: `folded into "${article.title}" with no rewrite: the post adds nothing the article does not already say`,
    });
    // applied: true. The post reached its decision and is recorded against the story;
    // there was simply nothing to write. Returning false here would send the caller
    // down the "target no longer exists" path and write a second article.
    return { ok: true, applied: true };
  }

  const result = await runStructuredCall<RevisionRewriteResult>({
    admin,
    stage: "article_write",
    model: settings.modelMergeRewrite || settings.modelArticle,
    system: settings.prompts.revisionRewrite,
    userContent: JSON.stringify({
      current_article: article,
      new_post: compact,
    }),
    schema: REWRITE_SCHEMA as unknown as Record<string, unknown>,
    ingestionId: ingestion.id,
    maxTokens: 4096,
    cacheSystem: settings.promptCacheEnabled,
  });
  if (!result)
    return { ok: false, error: "rewrite call failed", applied: false };

  await admin
    .from("articles")
    .update({
      title: result.title,
      meta_description: result.meta_description,
      tl_dr: result.tl_dr,
      content_md: result.body_md,
      last_updated: new Date().toISOString(),
    })
    .eq("id", article.id);
  await snapshotRevision(
    admin,
    article.id,
    result.title,
    result.body_md,
    (article.tags as string[]) ?? [],
    article.category_id,
    ingestion.id,
    result.change_summary,
  );
  await admin
    .from("news_ingestions")
    .update({ status: "revised", processed_at: new Date().toISOString() })
    .eq("id", ingestion.id);
  return { ok: true, applied: true };
}

/**
 * Late duplicate guard for a 'create' job.
 *
 * Curation already asked whether this post continues a story we cover, and said no.
 * It can be wrong about that for one specific reason: when a sibling post about the
 * same event arrived in the same poll window, the sibling's article had not been
 * written yet, so it was not on the candidate list. By the time this job runs the
 * sibling's article exists, because queue jobs execute in sequence.
 *
 * So ask once more, restricted to articles created after this ingestion row. That is
 * exactly the set curation could not see. Runs before the research and article calls
 * so a duplicate costs one cheap triage call instead of two expensive writes.
 *
 * It applies the SAME two mechanical gates curation does (size floor, shared
 * subject), because this is the other door into a merge and a gate only one path
 * honours is not a gate. See ./followup.ts for why the model is not trusted alone.
 *
 * Returns the article to fold into, or null to write a new article as planned.
 */
async function findLateDuplicateTarget(
  admin: Admin,
  settings: BeaconBriefSettings,
  ingestion: Ingestion,
  compact: unknown,
): Promise<FollowupCandidate | null> {
  const refs = resolvedFrom(ingestion);
  const ai = (ingestion.ai_result ?? {}) as Record<string, unknown>;
  const subject: PostSubject = {
    playerIds: refs.playerIds,
    teamIds: refs.teamIds,
    relevanceTier:
      typeof ai.relevance_tier === "number" ? ai.relevance_tier : null,
  };

  // The event key first, exactly as at curation time and for the same reason. This is
  // the pass that catches what curation structurally cannot: two posts about one event
  // inside a single poll window, where the first post's article did not exist yet when
  // the second was curated. Both Peter Skoronski articles published through that gap,
  // two minutes apart.
  //
  // Unlike the model-judged passes below, this one is NOT bounded by
  // articleCreatedAfter. An exact key match is proof, and proof does not expire
  // because curation had a chance to see it and missed.
  if (ingestion.event_key) {
    const exact = await findExactEventMatch(admin, {
      eventKey: ingestion.event_key,
      windowHours: settings.eventKeyWindowHours,
      excludeArticleId: ingestion.article_id,
    });
    if (exact) {
      await logBeaconBrief(admin, {
        stage: "revision_link",
        ingestionId: ingestion.id,
        message: `late guard: same event as "${exact.title}" (event key ${ingestion.event_key}); folding in without asking the model`,
      });
      return {
        ingestion_id: exact.ingestion_id,
        article_id: exact.article_id,
        title: exact.title,
        summary: "",
        player_ids: refs.playerIds,
        team_ids: refs.teamIds,
      };
    }
  }

  if (mergeBlockedByTier(subject, settings.mergeBlockRelevanceTier)) {
    await logBeaconBrief(admin, {
      stage: "revision_link",
      ingestionId: ingestion.id,
      message: `major news (relevance tier ${subject.relevanceTier}) and no exact event match; keeping its own article`,
    });
    return null;
  }

  if (ingestion.event_key) {
    const overlaps = await loadOverlapCandidates(admin, {
      eventKey: ingestion.event_key,
      windowHours: settings.eventKeyWindowHours,
      excludeArticleId: ingestion.article_id,
    });
    if (overlaps.length === 0) return null;
    return findFollowupTarget({
      admin,
      settings,
      post: compact,
      candidates: overlaps,
      ingestionId: ingestion.id,
    });
  }

  // No usable key. Fall back to the original narrow question: only articles that did
  // not exist when this post was curated, because every older one was already offered
  // to the curate-time matcher and re-asking adds nothing but a second chance to err.
  const candidates = await loadFollowupCandidates(admin, {
    lookbackHours: settings.followupLookbackHours,
    excludeIngestionId: ingestion.id,
    articleCreatedAfter: ingestion.created_at,
  });
  const eligible = eligibleMergeCandidates(subject, candidates);
  if (eligible.length === 0) return null;
  return findFollowupTarget({
    admin,
    settings,
    post: compact,
    candidates: eligible,
    sourceId: ingestion.source_id,
    ingestionId: ingestion.id,
  });
}

/**
 * Pull a Discord card for a post the article stage decided does not belong here.
 *
 * The relevance gate in ./curate.ts stops the large majority of off-topic posts
 * before Discord ever sees them. This covers the residue it cannot catch: a post
 * whose text gives no clue what it is about, where only the research call reveals
 * the story is not ours. By then the discord_post job has usually already run.
 *
 * Cancel the job if it is still queued, delete the card if it already posted.
 *
 * This is now the ONLY thing that removes a card. A duplicate keeps its card (see the
 * Discord note in ./curate.ts processRevision); the card comes down only when the post
 * turns out not to belong on a fantasy football site at all.
 *
 * Never throws. The ingestion has already been marked filtered by the caller and
 * that outcome must stand even if Discord is unreachable; a stranded card is
 * removable by hand, a job bounced back for a retry would re-run the research and
 * article calls and spend the money a second time.
 */
async function retractDiscordCard(
  admin: Admin,
  settings: BeaconBriefSettings,
  ingestionId: string,
  why: string,
): Promise<void> {
  try {
    const { data: cancelled } = await admin
      .from("beacon_brief_queue")
      .update({
        status: "done",
        last_error: `cancelled: ${why}`,
        updated_at: new Date().toISOString(),
      })
      .eq("job_type", "discord_post")
      .eq("status", "pending")
      .filter("payload->>ingestion_id", "eq", ingestionId)
      .select("id");
    if (cancelled && cancelled.length > 0) {
      await logBeaconBrief(admin, {
        stage: "discord_post",
        level: "info",
        ingestionId,
        message: `cancelled ${cancelled.length} queued Discord post(s): ${why}`,
      });
    }

    // Re-read: the discord_post for this ingestion very likely ran earlier in
    // this same worker pass and recorded its message id after the caller's read.
    const row = await loadIngestion(admin, ingestionId);
    if (!row?.discord_message_id) return;
    const url = await activeWebhookUrl(admin, settings);
    if (!url) return;
    const res = await deleteWebhookMessage(url, row.discord_message_id);
    await logBeaconBrief(admin, {
      stage: "discord_patch",
      level: res.ok ? "info" : "error",
      ingestionId,
      message: res.ok
        ? `deleted Discord card: ${why}`
        : `failed to delete Discord card: ${res.error}`,
      responsePayload: res as unknown as Json,
    });
    if (res.ok) {
      // Clear the id so nothing downstream patches a card that is gone.
      // discord_webhook_id stays set: it is the sentinel that stops
      // handleDiscordPost from ever reposting this one.
      await admin
        .from("news_ingestions")
        .update({ discord_message_id: null })
        .eq("id", ingestionId);
    }
  } catch (err) {
    await logBeaconBrief(admin, {
      stage: "discord_patch",
      level: "error",
      ingestionId,
      message: `Discord retract failed; a card may remain in the channel: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    });
  }
}

/**
 * Close the reference-match rows an abandoned article leaves behind.
 *
 * Curation opens a moderation row for every name it could not confidently match,
 * with article_id null, expecting the writer to backfill it once the article
 * exists. When the writer aborts instead, that never happens, and the row sits in
 * the queue forever: it cannot be resolved (there is no article to link a team to)
 * and nothing else was ever going to close it. In the admin panel it reads as an
 * article stuck mid-write, which is how one sat pending for six hours after the
 * post it belonged to had already been correctly rejected.
 *
 * Best-effort by design: the article decision is already recorded and must stand
 * even if this cleanup fails.
 */
async function closeOrphanedMatchModeration(
  admin: Admin,
  ingestionId: string,
  why: string,
): Promise<void> {
  const { data: closed, error } = await admin
    .from("beacon_brief_moderation")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      detail: {
        auto_closed: true,
        reason: `no article was written: ${why}`,
      } as unknown as Json,
    })
    .eq("ingestion_id", ingestionId)
    .eq("status", "pending")
    .is("article_id", null)
    .in("type", ["player_match", "team_match"])
    .select("id");
  if (error) {
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "warn",
      ingestionId,
      message: `failed to close orphaned match moderation rows: ${error.message}`,
    });
    return;
  }
  if (closed && closed.length > 0) {
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "info",
      ingestionId,
      message: `closed ${closed.length} reference-match review(s): no article was written for this post`,
    });
  }
}

/**
 * Whether this post can be written from on its own, with no web research.
 *
 * Research is the most expensive thing the Brief does by a wide margin. The
 * web_search loop runs on Anthropic's servers and re-bills the whole accumulated
 * conversation every round, so one article's research averaged 126,553 input
 * tokens and the stage accounted for 95% of the monthly bill. Plenty of those
 * calls bought nothing: when Schefter posts the full terms of a trade, the search
 * comes back with the same facts the post already stated.
 *
 * So ask first, on the triage model. The gate prompt and a post come to roughly
 * 600 input tokens on Haiku 4.5, well under a tenth of a cent per call.
 *
 * Every path that is not a clear "the post says it all" researches. The decision
 * itself lives in ./research-gate.ts, with no IO in it, so the paths can be
 * enumerated in ./research-gate.test.ts. This function is the IO around it.
 *
 * Worth noting what the downstream guards already cover, because it bounds how
 * bad a wrong skip can be. Skipping leaves researchNotes null, so a short post
 * still hits the dropped_no_context check below and is never written. A long post
 * written without research is a thinner article, not an invented one, because the
 * article prompt admits only the post and the notes as sources.
 */
async function shouldSkipResearch(
  admin: Admin,
  settings: BeaconBriefSettings,
  ingestion: Ingestion,
  compact: unknown,
  postChars: number,
): Promise<boolean> {
  const pre = researchPrecheck({
    gateEnabled: settings.researchGateEnabled,
    postChars,
    minPostChars: settings.researchGateMinPostChars,
    gatePrompt: settings.prompts.researchGate,
  });
  if (pre.why !== "ask_model") {
    // Only the floor is worth a log line. The other two are configuration the
    // admin already set on purpose, and logging them on every post would bury
    // the gate's real decisions.
    if (pre.why === "post_too_short") {
      await logBeaconBrief(admin, {
        stage: "research_gate",
        level: "info",
        ingestionId: ingestion.id,
        message: `gate not consulted: the post carries ${postChars} characters of usable text, under the ${settings.researchGateMinPostChars} floor, so it researches regardless.`,
      });
    }
    return false;
  }

  const verdict = await runStructuredCall<ResearchGateVerdict>({
    admin,
    stage: "research_gate",
    model: settings.modelTriage,
    system: settings.prompts.researchGate,
    userContent: JSON.stringify(compact),
    schema: RESEARCH_GATE_SCHEMA as unknown as Record<string, unknown>,
    ingestionId: ingestion.id,
    maxTokens: 256,
    cacheSystem: settings.promptCacheEnabled,
  });

  if (!verdictAllowsSkip(verdict)) return false;

  await logBeaconBrief(admin, {
    stage: "research_gate",
    level: "info",
    ingestionId: ingestion.id,
    message: `research skipped: ${verdict?.reason || "the post carries its own facts"}`,
  });
  return true;
}

async function handleArticleWrite(
  admin: Admin,
  job: QueueRow,
  settings: BeaconBriefSettings,
): Promise<{ ok: boolean; error?: string }> {
  const payload = job.payload as unknown as QueueJobPayload;
  const ingestion = await loadIngestion(admin, payload.ingestion_id);
  if (!ingestion) return { ok: true };
  const refs = resolvedFrom(ingestion);

  const compact = {
    text: ingestion.text,
    author_handle: ingestion.author_handle,
    quoted: ingestion.quoted,
    retweeted: ingestion.retweeted,
  };

  if (payload.mode === "rewrite" && payload.article_id) {
    const r = await applyRewriteToArticle(
      admin,
      settings,
      ingestion,
      payload.article_id as string,
      compact,
    );
    return { ok: r.ok, error: r.error };
  }

  // mode 'create'
  const lateTarget = await findLateDuplicateTarget(
    admin,
    settings,
    ingestion,
    compact,
  );
  if (lateTarget) {
    const r = await applyRewriteToArticle(
      admin,
      settings,
      ingestion,
      lateTarget.article_id,
      compact,
    );
    if (!r.ok) return { ok: false, error: r.error };
    if (r.applied) {
      // Record the merge on the ingestion row so the audit trail shows what
      // happened, later follow-ups on this story find the surviving article, and
      // any reference-match moderation opened at curation time can still resolve
      // against a real article_id.
      await admin
        .from("news_ingestions")
        .update({
          article_id: lateTarget.article_id,
          is_revision: true,
          revision_of_ingestion_id: lateTarget.ingestion_id,
        })
        .eq("id", ingestion.id);
      await admin
        .from("beacon_brief_moderation")
        .update({ article_id: lateTarget.article_id })
        .eq("ingestion_id", ingestion.id)
        .is("article_id", null)
        .in("type", ["player_match", "team_match"]);
      await logBeaconBrief(admin, {
        stage: "revision_link",
        level: "info",
        ingestionId: ingestion.id,
        message: `late duplicate guard: folded into article ${lateTarget.article_id} ("${lateTarget.title}") instead of writing a second article`,
      });
      // The Discord card stays. One article, but every beat of the story still lands
      // in the channel; see the Discord note in ./curate.ts processRevision.
      return { ok: true };
    }
    // The target was deleted between the match and the rewrite. Fall through and
    // write the article we were originally going to write, rather than dropping
    // the post because the thing we meant to merge into no longer exists.
    await logBeaconBrief(admin, {
      stage: "revision_link",
      level: "warn",
      ingestionId: ingestion.id,
      message: `late duplicate guard matched article ${lateTarget.article_id} but it no longer exists; writing a new article instead`,
    });
  }

  // Volume backstop. Runs before the research call, which is the expensive one, so a
  // runaway costs nothing rather than a dollar a post. See ./volume-guard.ts.
  const volume = await checkArticleVolume(admin, settings, refs.playerIds);
  if (volume.capped) {
    await admin
      .from("news_ingestions")
      .update({
        status: "filtered",
        filter_reason: "volume_cap",
        filter_detail: {
          player_id: volume.playerId,
          player_name: volume.playerName,
          articles_in_24h: volume.count,
          cap: volume.cap,
          stage: "article",
        } as unknown as Json,
        processed_at: new Date().toISOString(),
      })
      .eq("id", ingestion.id);
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "warn",
      ingestionId: ingestion.id,
      message: `daily article cap reached for ${volume.playerName}: ${volume.count} article(s) in 24h against a cap of ${volume.cap}. Discord card kept; article held in the Filtered queue.`,
    });
    await closeOrphanedMatchModeration(
      admin,
      ingestion.id,
      `daily article cap for ${volume.playerName}`,
    );
    const alert = await shouldEmailVolumeCap(admin, settings);
    if (alert.send) {
      await sendBeaconBriefVolumeCapEmail({
        playerName: volume.playerName ?? "a player",
        count: volume.count ?? 0,
        cap: volume.cap ?? 0,
        suppressedSince: alert.suppressedSince,
      });
    }
    // ok: the job reached a decision. A retry would re-check and re-decide the same
    // way, and the post is now visible in the admin queue for a one-click override.
    return { ok: true };
  }

  // How much the post says on its own. Read twice from here: the research gate
  // uses it as a floor, and the no-context guard below uses it as the other half
  // of its test. Computed once so the two can never disagree.
  const postChars = substantiveTextLength([
    ingestion.text,
    (ingestion.quoted as { text?: string } | null)?.text,
    (ingestion.retweeted as { text?: string } | null)?.text,
  ]);

  // The expensive call. See shouldSkipResearch above for why it is gated, and
  // migration 0186 for the token arithmetic behind the search cap.
  let researchNotes: string | null = null;
  if (settings.webSearchEnabled && settings.prompts.articleResearch) {
    const skip = await shouldSkipResearch(
      admin,
      settings,
      ingestion,
      compact,
      postChars,
    );
    if (!skip) {
      researchNotes = await runWebSearchResearch({
        admin,
        // Its own model, not modelArticle. Research gathers and quotes facts;
        // the writing call below is the one that needs the stronger model.
        model: settings.modelResearch,
        system: settings.prompts.articleResearch,
        userContent: JSON.stringify(compact),
        ingestionId: ingestion.id,
        maxTokens: 2048,
        maxSearches: settings.researchMaxSearches,
        allowedDomains: settings.researchDomains,
      });
    }
  }

  // Nothing to write from, in either source. Do not ask the writer anyway.
  //
  // This is the structural half of the fabrication fix in migration 0179. A model
  // handed a fragment and told to produce an article will produce one, and the only
  // material it has left to build from is what it already believes. That is exactly
  // how a post whose entire text was "Worst part of training camp:" became a
  // 700-word article about a groin injury on a named date, at a joint practice
  // against a named opponent, after a game with a specific score, quoting a head
  // coach. None of it happened.
  //
  // The prompts now forbid inventing those details, but a prompt is an instruction
  // and this is arithmetic: a post of 26 usable characters plus research that found
  // nothing is not enough to write from, whatever the writer is told. So the writer
  // is not asked.
  //
  // Both halves have to be empty. A thin post with real research notes is fine, and
  // a rich post is fine with no research at all, which is also what happens whenever
  // web search is turned off, or whenever the research gate skips the search.
  const researchIsEmpty =
    !researchNotes ||
    researchNotes.trim().length === 0 ||
    /^\W*no results\W*$/i.test(researchNotes.trim());
  if (postChars < MIN_SUBSTANTIVE_POST_CHARS && researchIsEmpty) {
    await admin
      .from("news_ingestions")
      .update({
        status: "dropped_no_context",
        processed_at: new Date().toISOString(),
      })
      .eq("id", ingestion.id);
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "warn",
      ingestionId: ingestion.id,
      message: `no article written: the post carries ${postChars} characters of usable text and research found nothing. Writing one would mean inventing it. Discord card kept.`,
    });
    await closeOrphanedMatchModeration(
      admin,
      ingestion.id,
      "not enough source material to write from",
    );
    // ok: a decision was reached. The Discord card stays; only the article is skipped.
    return { ok: true };
  }

  const result = await runStructuredCall<ArticleResult>({
    admin,
    stage: "article_write",
    model: settings.modelArticle,
    system: settings.prompts.article,
    userContent: JSON.stringify({
      post: compact,
      // "NO RESULTS", not an empty string. The article prompt keys its most
      // important instruction for this case on that exact token: "If the
      // research notes say NO RESULTS, write from the post alone. The article
      // will be short. That is the correct outcome and not a problem to solve by
      // adding background." An empty string never fires it, leaving the writer
      // with no guidance at the moment it is most likely to pad from memory.
      // Empty research used to be rare; the research gate makes it routine.
      research_notes: researchNotes ?? "NO RESULTS",
    }),
    schema: ARTICLE_SCHEMA as unknown as Record<string, unknown>,
    ingestionId: ingestion.id,
    maxTokens: 4096,
    cacheSystem: settings.promptCacheEnabled,
  });
  if (!result) return { ok: false, error: "article writing call failed" };

  // Late relevance abort. The curation gate scores a post from its text alone,
  // which is all it has. Research can surface something that text could not show:
  // the recruit whose post never names the sport turns out to play basketball.
  // The writer reports that verdict on fantasy_impact, and it is the last chance
  // to stop before the article becomes a public URL.
  //
  // Deliberately NOT gated on settings.relevanceFilterEnabled. That toggle governs
  // the tier threshold at curation time, a tuning dial. This is the writer saying
  // the story does not belong on the site at all, which is never something we want
  // to publish regardless of how the gate is tuned.
  if (result.fantasy_impact === false) {
    const why = result.no_impact_reason?.trim() || "no fantasy impact";
    await admin
      .from("news_ingestions")
      .update({
        status: "filtered",
        filter_reason: "ai_low_relevance",
        filter_detail: {
          reason: why,
          stage: "article",
          rejected_title: result.title,
        } as unknown as Json,
        processed_at: new Date().toISOString(),
      })
      .eq("id", ingestion.id);
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "warn",
      ingestionId: ingestion.id,
      message: `article aborted after research, no fantasy impact: ${why}`,
    });
    await retractDiscordCard(
      admin,
      settings,
      ingestion.id,
      "article stage found no fantasy impact",
    );
    await closeOrphanedMatchModeration(admin, ingestion.id, why);
    // ok: the job did its work and reached a decision. Returning false would
    // retry it and pay for the research and article calls all over again.
    return { ok: true };
  }

  // Last line of defence. The writer independently chose a slug that already exists on
  // a live article about one of the same players, from inside the merge window. That is
  // not a coincidence, it is the same story, and until migration 0177 it published
  // anyway behind five random hex characters.
  const { slug, collision } = await resolveSlug(
    admin,
    result.slug || result.title,
    { playerIds: refs.playerIds, windowHours: settings.eventKeyWindowHours },
  );
  if (collision) {
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "warn",
      ingestionId: ingestion.id,
      message: `slug collision with live article "${collision.title}" (/${collision.slug}) sharing a player inside the merge window; folding in rather than publishing a second URL`,
    });
    const r = await applyRewriteToArticle(
      admin,
      settings,
      ingestion,
      collision.article_id,
      compact,
    );
    if (r.ok && r.applied) {
      await admin
        .from("news_ingestions")
        .update({ article_id: collision.article_id, is_revision: true })
        .eq("id", ingestion.id);
      await admin
        .from("beacon_brief_moderation")
        .update({ article_id: collision.article_id })
        .eq("ingestion_id", ingestion.id)
        .is("article_id", null)
        .in("type", ["player_match", "team_match"]);
      return { ok: true };
    }
    // The merge could not be applied (the target vanished, or the call failed). Publish
    // under the suffixed slug rather than dropping a post we have already paid to
    // research and write.
    await logBeaconBrief(admin, {
      stage: "article_write",
      level: "warn",
      ingestionId: ingestion.id,
      message: `slug-collision merge did not apply (${r.error ?? "target missing"}); publishing under ${slug}`,
    });
  }

  const published = settings.autopublish;
  const { data: created, error: artErr } = await admin
    .from("articles")
    .insert({
      slug,
      title: result.title,
      meta_description: result.meta_description,
      tl_dr: result.tl_dr,
      content_md: result.body_md,
      article_type: refs.categorySlug ?? "news",
      category_id: refs.categoryId,
      tags: refs.tags,
      origin: "beacon_brief",
      event_key: ingestion.event_key,
      status: published ? "published" : "draft",
      published_at: published ? new Date().toISOString() : null,
      metadata: (ingestion.metadata as Json) ?? {},
    })
    .select("id")
    .single();
  if (artErr || !created)
    return { ok: false, error: artErr?.message ?? "article insert failed" };

  if (refs.playerIds.length > 0) {
    await admin.from("article_players").insert(
      refs.playerIds.map((pid) => ({
        article_id: created.id,
        player_id: pid,
      })),
    );
  }
  if (refs.teamIds.length > 0) {
    await admin
      .from("article_teams")
      .insert(
        refs.teamIds.map((tid) => ({ article_id: created.id, team_id: tid })),
      );
  }
  await snapshotRevision(
    admin,
    created.id,
    result.title,
    result.body_md,
    refs.tags,
    refs.categoryId,
    ingestion.id,
    "Initial Beacon Brief article",
  );

  await admin
    .from("news_ingestions")
    .update({
      article_id: created.id,
      status: "published",
      processed_at: new Date().toISOString(),
    })
    .eq("id", ingestion.id);

  // Backfill the now-known article_id onto any reference-match moderation rows
  // curation opened for this ingestion, so one-click resolution can write the
  // article_players / article_teams link.
  await admin
    .from("beacon_brief_moderation")
    .update({ article_id: created.id })
    .eq("ingestion_id", ingestion.id)
    .is("article_id", null)
    .in("type", ["player_match", "team_match"]);

  // No deletion job is queued here on purpose. The batched sweep finds this post
  // by querying for published rows whose next checkpoint has passed, so the watch
  // needs no per-article bookkeeping and cannot be broken by a failed run.
  return { ok: true };
}

async function snapshotRevision(
  admin: Admin,
  articleId: string,
  title: string,
  bodyMd: string,
  tags: string[],
  categoryId: string | null,
  sourceIngestionId: string,
  changeSummary: string,
): Promise<void> {
  const { data: last } = await admin
    .from("article_revisions")
    .select("revision_number")
    .eq("article_id", articleId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const next = (last?.revision_number ?? 0) + 1;
  await admin.from("article_revisions").insert({
    article_id: articleId,
    revision_number: next,
    title,
    content_md: bodyMd,
    tags,
    category_id: categoryId,
    source_ingestion_id: sourceIngestionId,
    change_summary: changeSummary,
  });
}

/**
 * Keep exactly one deletion sweep in flight.
 *
 * The worker runs every minute, so this is the cheapest place to own the sweep's
 * cadence: if one is already queued or running, do nothing; otherwise queue one
 * when the interval has elapsed since the last completed sweep. A queue with no
 * sweep at all (a fresh database, or the state the 2026-07-31 outage left behind
 * when the old per-article chain snapped) self-heals on the very next run,
 * because "no sweep has ever completed" reads as due.
 */
async function ensureDeletionSweepScheduled(
  admin: Admin,
  settings: BeaconBriefSettings,
): Promise<void> {
  const { data: inFlight } = await admin
    .from("beacon_brief_queue")
    .select("id")
    .eq("job_type", "deletion_sweep")
    .in("status", ["pending", "processing"])
    .limit(1);
  if (inFlight && inFlight.length > 0) return;

  const { data: last } = await admin
    .from("beacon_brief_queue")
    .select("updated_at")
    .eq("job_type", "deletion_sweep")
    .eq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const intervalMs =
    (settings.deletionSweepIntervalMinutes > 0
      ? settings.deletionSweepIntervalMinutes
      : 60) * 60_000;
  if (last?.updated_at) {
    const since = Date.now() - new Date(last.updated_at).getTime();
    if (since < intervalMs) return;
  }

  await admin.from("beacon_brief_queue").insert({
    job_type: "deletion_sweep",
    payload: {} as unknown as Json,
    status: "pending",
    run_after: new Date().toISOString(),
  });
}

async function processJob(
  admin: Admin,
  job: QueueRow,
  settings: BeaconBriefSettings,
  summary: WorkerSummary,
): Promise<void> {
  let outcome: { ok: boolean; retryAfterMs?: number | null; error?: string };
  try {
    if (job.job_type === "discord_post")
      outcome = await handleDiscordPost(admin, job, settings);
    else if (job.job_type === "discord_patch")
      outcome = await handleDiscordPatch(admin, job, settings);
    else if (job.job_type === "article_write")
      outcome = await handleArticleWrite(admin, job, settings);
    else if (job.job_type === "deletion_sweep") {
      const sweep = await runDeletionSweep(admin, settings);
      // A skipped sweep (X unavailable) is ok on purpose. The next sweep re-derives
      // what is due from table state, so treating an outage as a job failure would
      // buy nothing but retries and alert emails.
      outcome = sweep.ok
        ? { ok: true }
        : { ok: false, error: sweep.error ?? "deletion sweep failed" };
    } else if (job.job_type === "deletion_check") {
      // Legacy per-article job from before the batched sweep. Nothing to do: the
      // sweep now covers every published post from stored state. Retire it rather
      // than spending an X read to honour a schedule that no longer exists.
      await logBeaconBrief(admin, {
        stage: "deletion_check",
        level: "info",
        ingestionId: (job.payload as unknown as QueueJobPayload)?.ingestion_id,
        message:
          "legacy deletion_check retired; the batched sweep covers this post",
      });
      outcome = { ok: true };
    } else outcome = { ok: false, error: `unknown job type ${job.job_type}` };
  } catch (err) {
    outcome = {
      ok: false,
      error: err instanceof Error ? err.message : "job threw",
    };
  }

  if (outcome.ok) {
    await markDone(admin, job.id);
    summary.done += 1;
  } else {
    const r = await failOrRetry(
      admin,
      job,
      settings,
      outcome.error ?? "unknown error",
      outcome.retryAfterMs,
    );
    if (r === "failed") summary.failed += 1;
    else if (r === "retry") summary.retried += 1;
    // "lost": a concurrent run already transitioned this job; do not count it.
  }
}

/** Entry point invoked by the worker cron and the CLI. */
export async function runWorker(admin: Admin): Promise<WorkerSummary> {
  const settings = await loadBeaconBriefSettings(admin);
  const summary: WorkerSummary = {
    claimed: 0,
    done: 0,
    retried: 0,
    failed: 0,
    reaped: 0,
    released: 0,
  };
  if (!settings.enabled) {
    return { ...summary, skipped: true, reason: "bb_enabled is off" };
  }

  // Soft wall-clock budget so a run never approaches the function timeout and
  // never piles up past the one-minute cadence.
  const deadline =
    Date.now() +
    (settings.workerMaxRuntimeMs > 0 ? settings.workerMaxRuntimeMs : 50_000);

  // First reclaim anything a previous run left stranded in 'processing'.
  await reapStaleJobs(admin, settings, summary);

  await ensureDeletionSweepScheduled(admin, settings);

  // Cap Discord jobs per run (stay under the webhook rate limit); other jobs
  // claimed separately so a flood of Discord work never starves article writing.
  const { data: discordJobs } = await admin.rpc("bb_claim_jobs", {
    p_limit: settings.discordJobsPerRun,
    p_job_types: ["discord_post", "discord_patch"],
  });
  const { data: otherJobs } = await admin.rpc("bb_claim_jobs", {
    p_limit: settings.articleJobsPerRun,
    // deletion_check is claimed only to retire the legacy rows that predate the
    // batched sweep; nothing creates new ones.
    p_job_types: ["article_write", "deletion_sweep", "deletion_check"],
  });

  // Discord jobs lead so the inter-send pacing applies to the contiguous batch.
  const jobs: QueueRow[] = [...(discordJobs ?? []), ...(otherJobs ?? [])];
  summary.claimed = jobs.length;

  let discordSends = 0;
  let i = 0;
  for (; i < jobs.length; i++) {
    if (Date.now() >= deadline) break; // out of budget; release the rest below
    const job = jobs[i];
    // Pace consecutive Discord sends (not before the first) so a burst never
    // trips the webhook rate limit; never sleep past the deadline.
    if (
      isDiscordJob(job.job_type) &&
      discordSends > 0 &&
      settings.discordPaceMs > 0
    ) {
      const wait = Math.min(settings.discordPaceMs, deadline - Date.now());
      if (wait > 0) await sleep(wait);
      if (Date.now() >= deadline) break;
    }
    await processJob(admin, job, settings, summary);
    if (isDiscordJob(job.job_type)) discordSends += 1;
  }

  // Any jobs we claimed but never reached (deadline hit) go straight back to
  // pending so the next run picks them up immediately, instead of waiting out
  // the stale-processing window.
  const leftover = jobs.slice(i);
  if (leftover.length > 0) {
    const now = new Date().toISOString();
    await admin
      .from("beacon_brief_queue")
      .update({ status: "pending", run_after: now, updated_at: now })
      .in(
        "id",
        leftover.map((j) => j.id),
      );
    summary.released = leftover.length;
  }
  return summary;
}
