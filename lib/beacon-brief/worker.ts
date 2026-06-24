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
 *   - deletion_check: re-verify the source post; if gone, open a moderation row.
 * On error/429 it backs off (run_after pushed out, attempts++); after the
 * configured max attempts the job is marked failed and an admin email is sent.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  patchWebhookMessage,
  postWebhookMessage,
  type DiscordAttachment,
  type DiscordEmbed,
  type DiscordMessageInput,
} from "@/lib/discord";
import { logBeaconBrief, runStructuredCall, runWebSearchResearch } from "./ai";
import { loadBeaconBriefSettings, type BeaconBriefSettings } from "./settings";
import { sendBeaconBriefFailureEmail } from "./email";
import { handleDeletionCheck } from "./deletion";
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
  required: ["title", "slug", "meta_description", "tl_dr", "body_md"],
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    meta_description: { type: "string" },
    tl_dr: { type: "string" },
    body_md: { type: "string" },
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

async function ensureUniqueSlug(admin: Admin, base: string): Promise<string> {
  const slug = slugify(base);
  const { data } = await admin
    .from("articles")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return slug;
  // Collision: append a 5-char suffix (plan rule).
  const suffix = randomBytes(4).toString("hex").slice(0, 5);
  return `${slug}-${suffix}`;
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
    if (job.job_type === "article_write") {
      const payload = job.payload as unknown as QueueJobPayload;
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
    await sendBeaconBriefFailureEmail({
      jobType: job.job_type,
      jobId: job.id,
      attempts,
      error: errorMsg,
    });
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

  const roleIds = Array.isArray(payload.role_ids)
    ? (payload.role_ids as string[])
    : resolvedFrom(ingestion).roleIds;
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
    const { data: article } = await admin
      .from("articles")
      .select("id, title, content_md, tl_dr, tags, category_id")
      .eq("id", payload.article_id as string)
      .maybeSingle();
    if (!article) return { ok: true };

    const result = await runStructuredCall<RevisionRewriteResult>({
      admin,
      stage: "article_write",
      model: settings.modelArticle,
      system: settings.prompts.revisionRewrite,
      userContent: JSON.stringify({
        current_article: article,
        new_post: compact,
      }),
      schema: REWRITE_SCHEMA as unknown as Record<string, unknown>,
      ingestionId: ingestion.id,
      maxTokens: 4096,
    });
    if (!result) return { ok: false, error: "rewrite call failed" };

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
    return { ok: true };
  }

  // mode 'create'
  let researchNotes: string | null = null;
  if (settings.webSearchEnabled && settings.prompts.articleResearch) {
    researchNotes = await runWebSearchResearch({
      admin,
      model: settings.modelArticle,
      system: settings.prompts.articleResearch,
      userContent: JSON.stringify(compact),
      ingestionId: ingestion.id,
      maxTokens: 2048,
    });
  }

  const result = await runStructuredCall<ArticleResult>({
    admin,
    stage: "article_write",
    model: settings.modelArticle,
    system: settings.prompts.article,
    userContent: JSON.stringify({
      post: compact,
      research_notes: researchNotes ?? "",
    }),
    schema: ARTICLE_SCHEMA as unknown as Record<string, unknown>,
    ingestionId: ingestion.id,
    maxTokens: 4096,
  });
  if (!result) return { ok: false, error: "article writing call failed" };

  const slug = await ensureUniqueSlug(admin, result.slug || result.title);
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

  // Schedule a first deletion check ~6h out.
  await admin.from("beacon_brief_queue").insert({
    job_type: "deletion_check",
    payload: { ingestion_id: ingestion.id } as unknown as Json,
    status: "pending",
    run_after: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  });
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
    else if (job.job_type === "deletion_check")
      outcome = await handleDeletionCheck(
        admin,
        job.payload as unknown as QueueJobPayload,
      );
    else outcome = { ok: false, error: `unknown job type ${job.job_type}` };
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

  // Cap Discord jobs per run (stay under the webhook rate limit); other jobs
  // claimed separately so a flood of Discord work never starves article writing.
  const { data: discordJobs } = await admin.rpc("bb_claim_jobs", {
    p_limit: settings.discordJobsPerRun,
    p_job_types: ["discord_post", "discord_patch"],
  });
  const { data: otherJobs } = await admin.rpc("bb_claim_jobs", {
    p_limit: settings.articleJobsPerRun,
    p_job_types: ["article_write", "deletion_check"],
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
