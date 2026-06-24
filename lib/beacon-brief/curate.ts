/**
 * The Beacon Brief curation pass (fast path only).
 *
 * Runs on the 5-minute cron. For each active source it ingests new posts,
 * normalizes them, dedupes against the (source_id, source_external_id) safety
 * net, detects revisions (native edit deterministically, or AI-linked follow-up),
 * runs the inline context-score/categorize classification, resolves the named
 * players/teams/category to ids + Discord role ids, and ENQUEUES the slow work
 * (discord_post / discord_patch / article_write / deletion_check). It makes NO
 * inline Discord calls and NO inline article-writing calls.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { fetchSourceItems } from "./ingest-x";
import { logBeaconBrief, runStructuredCall } from "./ai";
import { loadBeaconBriefSettings } from "./settings";
import { matchReferences } from "./match";
import { sendBeaconBriefMatchDigestEmail } from "./email";
import type {
  BeaconBriefSourceItem,
  CategorizeResult,
  PendingReferenceMatch,
  QueueJobPayload,
  QueueJobType,
} from "./types";

type NewsSource = Database["public"]["Tables"]["news_sources"]["Row"];
type Admin = SupabaseClient<Database>;

const CATEGORIZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "context_score",
    "category_slug",
    "players",
    "teams",
    "tags",
    "suggested_title",
    "suggested_slug",
  ],
  properties: {
    context_score: { type: "integer" },
    category_slug: { type: "string" },
    players: { type: "array", items: { type: "string" } },
    teams: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    suggested_title: { type: "string" },
    suggested_slug: { type: "string" },
  },
} as const;

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["critical"],
  properties: { critical: { type: "boolean" } },
} as const;

const FOLLOWUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matched_article_id"],
  properties: { matched_article_id: { type: "string" } },
} as const;

/** Compact, model-facing view of a post (keeps prompts small + stable). */
function compactItem(item: BeaconBriefSourceItem) {
  return {
    text: item.text,
    author_handle: item.author_handle,
    media: item.media.map((m) => m.type),
    quoted: item.quoted
      ? { text: item.quoted.text, author_handle: item.quoted.author_handle }
      : null,
    retweeted: item.retweeted
      ? {
          text: item.retweeted.text,
          author_handle: item.retweeted.author_handle,
        }
      : null,
  };
}

/** One non-confident reference match opened for review this run (for the digest). */
interface MatchReview {
  kind: "player" | "team";
  rawName: string;
  candidateCount: number;
}

/**
 * Open a beacon_brief_moderation row for each non-confident reference. article_id
 * is left null here and backfilled by the worker once the article is written, so
 * resolution can link the real player_id/team_id. Confident refs are NOT touched
 * (they auto-link via ai_result.resolved); only guesses land here.
 */
async function openMatchModeration(
  admin: Admin,
  ingestionId: string,
  pending: PendingReferenceMatch[],
  reviews: MatchReview[],
): Promise<void> {
  if (pending.length === 0) return;
  const rows = pending.map((p) => ({
    ingestion_id: ingestionId,
    article_id: null,
    type: p.kind === "player" ? "player_match" : "team_match",
    status: "pending",
    raw_name: p.rawName,
    candidates: p.candidates as unknown as Json,
  }));
  const { error } = await admin.from("beacon_brief_moderation").insert(rows);
  if (error) {
    await logBeaconBrief(admin, {
      stage: "categorize",
      level: "error",
      ingestionId,
      message: `failed to open match moderation: ${error.message}`,
    });
    return;
  }
  for (const p of pending)
    reviews.push({
      kind: p.kind,
      rawName: p.rawName,
      candidateCount: p.candidates.length,
    });
  await logBeaconBrief(admin, {
    stage: "categorize",
    level: "warn",
    ingestionId,
    message: `${pending.length} reference(s) need manual match review`,
  });
}

async function enqueue(
  admin: Admin,
  jobType: QueueJobType,
  payload: QueueJobPayload,
  runAfterIso?: string,
): Promise<void> {
  await admin.from("beacon_brief_queue").insert({
    job_type: jobType,
    payload: payload as unknown as Json,
    status: "pending",
    run_after: runAfterIso ?? new Date().toISOString(),
  });
}

/** Recent published articles from this source for follow-up linking. */
async function recentArticlesForSource(
  admin: Admin,
  sourceId: string,
  lookbackDays: number,
): Promise<
  Array<{
    ingestion_id: string;
    article_id: string;
    title: string;
    summary: string;
  }>
> {
  const cutoff = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data } = await admin
    .from("news_ingestions")
    .select("id, article_id, articles(title, tl_dr)")
    .eq("source_id", sourceId)
    .not("article_id", "is", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(15);
  if (!data) return [];
  return data
    .filter((r) => r.article_id)
    .map((r) => {
      const art = (
        r as { articles?: { title?: string; tl_dr?: string } | null }
      ).articles;
      return {
        ingestion_id: r.id,
        article_id: r.article_id as string,
        title: art?.title ?? "",
        summary: art?.tl_dr ?? "",
      };
    });
}

interface CurationSummary {
  sources: number;
  ingested: number;
  articlesQueued: number;
  discordQueued: number;
  revisions: number;
  errors: number;
  skipped?: boolean;
  reason?: string;
}

/** Entry point invoked by the curation cron and the CLI. */
export async function runCuration(admin: Admin): Promise<CurationSummary> {
  const settings = await loadBeaconBriefSettings(admin);
  if (!settings.enabled) {
    return {
      sources: 0,
      ingested: 0,
      articlesQueued: 0,
      discordQueued: 0,
      revisions: 0,
      errors: 0,
      skipped: true,
      reason: "bb_enabled is off",
    };
  }

  const { data: sources } = await admin
    .from("news_sources")
    .select("*")
    .eq("is_active", true);

  const summary: CurationSummary = {
    sources: sources?.length ?? 0,
    ingested: 0,
    articlesQueued: 0,
    discordQueued: 0,
    revisions: 0,
    errors: 0,
  };
  if (!sources || sources.length === 0) return summary;

  const categorySlugs = await activeCategorySlugs(admin);
  // Non-confident reference matches opened this run, batched into one digest email.
  const reviews: MatchReview[] = [];

  // Per-run item budget shared across all sources, so a stale cursor cannot dump
  // a large backlog in one run. 0 (or less) means unbounded.
  let remaining =
    settings.maxItemsPerRun > 0
      ? settings.maxItemsPerRun
      : Number.POSITIVE_INFINITY;
  const ageCutoffMs =
    settings.maxPostAgeMinutes > 0 ? settings.maxPostAgeMinutes * 60_000 : 0;

  for (const source of sources as NewsSource[]) {
    if (remaining <= 0) break; // budget exhausted; remaining sources next run
    const fetched = await fetchSourceItems(source);
    if (!fetched.ok) {
      summary.errors += 1;
      await admin
        .from("news_sources")
        .update({
          last_polled_at: new Date().toISOString(),
          last_poll_status: "error",
          last_poll_error: fetched.error ?? "unknown",
          external_account_id: fetched.accountId ?? source.external_account_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", source.id);
      await logBeaconBrief(admin, {
        stage: "ingest",
        level: "error",
        sourceId: source.id,
        message: fetched.error ?? "fetch failed",
      });
      continue;
    }

    if (fetched.truncatedByPageBudget) {
      await logBeaconBrief(admin, {
        stage: "ingest",
        level: "warn",
        sourceId: source.id,
        message:
          "source exceeded the per-poll page budget; oldest new posts deferred to a later run",
      });
    }

    const uninitialized = !source.last_cursor;
    // Oldest first so the cursor advances monotonically and revisions link to
    // prior ingestions.
    let items = [...fetched.items].reverse();

    if (uninitialized) {
      // Cold start: adding a source means "watch from now". Process only the
      // most recent backfillCount posts (0 = nothing on the first poll).
      const n = settings.backfillCount > 0 ? settings.backfillCount : 0;
      items = n > 0 ? items.slice(-n) : [];
      if (n === 0) {
        await logBeaconBrief(admin, {
          stage: "ingest",
          sourceId: source.id,
          message: "cold start: watching from now (no backfill)",
        });
      }
    }

    let lastProcessedId: string | null = null;
    for (const item of items) {
      if (remaining <= 0) break;
      // Age cutoff: stale posts are ingested for the audit/dedup record but never
      // routed to Discord or article creation.
      const skipStale =
        ageCutoffMs > 0 &&
        Date.now() - new Date(item.created_at).getTime() > ageCutoffMs;
      let processed = false;
      try {
        await processItem(
          admin,
          source,
          item,
          settings,
          categorySlugs,
          summary,
          skipStale,
          reviews,
        );
        processed = true;
      } catch (err) {
        summary.errors += 1;
        await logBeaconBrief(admin, {
          stage: "error",
          level: "error",
          sourceId: source.id,
          message:
            err instanceof Error ? err.message : "item processing failed",
        });
      }
      remaining -= 1;
      if (!processed) {
        // Do NOT advance the cursor past a failed item. Stop this source for the
        // run so the next poll re-fetches from the last success and retries the
        // failed item (the unique constraint dedupes the already-ingested ones).
        await logBeaconBrief(admin, {
          stage: "error",
          level: "warn",
          sourceId: source.id,
          message: `stopped at ${item.source_external_id}; will retry next run`,
        });
        break;
      }
      lastProcessedId = item.source_external_id;
      // Incremental cursor advance: persist progress per item so an interrupted
      // or budget-capped run never reprocesses what it already handled.
      await admin
        .from("news_sources")
        .update({
          last_cursor: lastProcessedId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", source.id);
    }

    // Reconcile poll status. The cursor was already advanced incrementally per
    // processed item, so we do NOT re-write it here. The one exception is a cold
    // start with nothing to process (backfillCount 0, or no posts): advance to
    // "now" (newestId) so we watch forward instead of re-scanning history.
    const pollUpdate: Database["public"]["Tables"]["news_sources"]["Update"] = {
      last_polled_at: new Date().toISOString(),
      last_poll_status: "success",
      last_poll_error: null,
      external_account_id: fetched.accountId ?? source.external_account_id,
      updated_at: new Date().toISOString(),
    };
    if (uninitialized && items.length === 0 && fetched.newestId) {
      pollUpdate.last_cursor = fetched.newestId;
    }
    await admin.from("news_sources").update(pollUpdate).eq("id", source.id);
  }

  // One digest email per run listing every reference that needs manual review.
  if (reviews.length > 0) {
    await sendBeaconBriefMatchDigestEmail({ reviews });
  }

  return summary;
}

async function activeCategorySlugs(admin: Admin): Promise<string> {
  const { data } = await admin
    .from("news_categories")
    .select("slug")
    .eq("is_active", true)
    .order("display_order");
  return (data ?? []).map((c) => c.slug).join(", ");
}

async function processItem(
  admin: Admin,
  source: NewsSource,
  item: BeaconBriefSourceItem,
  settings: Awaited<ReturnType<typeof loadBeaconBriefSettings>>,
  categorySlugs: string,
  summary: CurationSummary,
  skipStale: boolean,
  reviews: MatchReview[],
): Promise<void> {
  // Dedup: skip if we already ingested this source post.
  const { data: existing } = await admin
    .from("news_ingestions")
    .select("id")
    .eq("source_id", source.id)
    .eq("source_external_id", item.source_external_id)
    .maybeSingle();
  if (existing) {
    await logBeaconBrief(admin, {
      stage: "dedupe",
      sourceId: source.id,
      message: `already ingested ${item.source_external_id}`,
    });
    return;
  }

  // Age cutoff: record the post for audit/dedup but do not route it anywhere.
  if (skipStale) {
    const { data: dropped } = await admin
      .from("news_ingestions")
      .insert({
        source_id: source.id,
        source_type: item.source_type,
        source_external_id: item.source_external_id,
        external_url: item.external_url,
        author_handle: item.author_handle,
        text: item.text,
        media: item.media as unknown as Json,
        status: "dropped_no_context",
        metadata: (item.raw as Json) ?? {},
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    await logBeaconBrief(admin, {
      stage: "ingest",
      level: "info",
      sourceId: source.id,
      ingestionId: dropped?.id ?? null,
      message: "skipped: post older than max age cutoff",
    });
    return;
  }

  // Revision detection.
  let revisionOfIngestionId: string | null = null;
  let revisionTargetArticleId: string | null = null;

  if (item.is_native_edit && item.edit_of_external_id) {
    const { data: prior } = await admin
      .from("news_ingestions")
      .select("id, article_id")
      .eq("source_id", source.id)
      .eq("source_external_id", item.edit_of_external_id)
      .maybeSingle();
    if (prior) {
      revisionOfIngestionId = prior.id;
      revisionTargetArticleId = prior.article_id;
      await logBeaconBrief(admin, {
        stage: "revision_link",
        sourceId: source.id,
        message: `native edit of ${item.edit_of_external_id}`,
      });
    }
  }

  if (!revisionOfIngestionId) {
    const candidates = await recentArticlesForSource(
      admin,
      source.id,
      settings.followupLookbackDays,
    );
    if (candidates.length > 0 && settings.prompts.followupLink) {
      const matched = await runStructuredCall<{ matched_article_id: string }>({
        admin,
        stage: "revision_link",
        model: settings.modelTriage,
        system: settings.prompts.followupLink,
        userContent: JSON.stringify({
          post: compactItem(item),
          candidates: candidates.map((c) => ({
            id: c.article_id,
            title: c.title,
            summary: c.summary,
          })),
        }),
        schema: FOLLOWUP_SCHEMA as unknown as Record<string, unknown>,
        sourceId: source.id,
        maxTokens: 256,
      });
      const id = matched?.matched_article_id?.trim();
      const hit = id ? candidates.find((c) => c.article_id === id) : undefined;
      if (hit) {
        revisionOfIngestionId = hit.ingestion_id;
        revisionTargetArticleId = hit.article_id;
      }
    }
  }

  const isRevision = revisionOfIngestionId !== null;

  // The common ingestion row payload (our UUID identity). Built once and reused by
  // both insert paths below.
  const baseRow = {
    source_id: source.id,
    source_type: item.source_type,
    source_external_id: item.source_external_id,
    external_url: item.external_url,
    author_handle: item.author_handle,
    text: item.text,
    media: item.media as unknown as Json,
    quoted: (item.quoted as unknown as Json) ?? null,
    retweeted: (item.retweeted as unknown as Json) ?? null,
    metadata: (item.raw as Json) ?? {},
  };

  if (isRevision && revisionOfIngestionId) {
    // Revisions insert immediately: the patch job needs the row id, and there is
    // no inline AI gate that could fail before the row is needed.
    const { data: inserted, error: insErr } = await admin
      .from("news_ingestions")
      .insert({
        ...baseRow,
        is_revision: true,
        revision_of_ingestion_id: revisionOfIngestionId,
        status: "processing",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      await logBeaconBrief(admin, {
        stage: "ingest",
        level: "warn",
        sourceId: source.id,
        message: `insert skipped (${insErr?.message ?? "no row"})`,
      });
      return;
    }
    const ingestionId = inserted.id;
    summary.ingested += 1;
    summary.revisions += 1;
    await logBeaconBrief(admin, {
      stage: "ingest",
      sourceId: source.id,
      ingestionId,
      message: `ingested ${item.source_external_id} (revision)`,
    });

    // Always patch the existing Discord message with the new content.
    await enqueue(admin, "discord_patch", {
      ingestion_id: ingestionId,
      target_ingestion_id: revisionOfIngestionId,
    });
    summary.discordQueued += 1;

    // Triage: only rewrite the article when the change is critical.
    let critical = false;
    if (revisionTargetArticleId && settings.prompts.revisionTriage) {
      const { data: art } = await admin
        .from("articles")
        .select("title, content_md, tl_dr")
        .eq("id", revisionTargetArticleId)
        .maybeSingle();
      const triage = await runStructuredCall<{ critical: boolean }>({
        admin,
        stage: "revision_triage",
        model: settings.modelTriage,
        system: settings.prompts.revisionTriage,
        userContent: JSON.stringify({
          original_article: art ?? {},
          new_post: compactItem(item),
        }),
        schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>,
        ingestionId,
        sourceId: source.id,
        maxTokens: 256,
      });
      critical = triage?.critical === true;
    }

    if (critical && revisionTargetArticleId) {
      await enqueue(admin, "article_write", {
        ingestion_id: ingestionId,
        mode: "rewrite",
        article_id: revisionTargetArticleId,
      });
      summary.articlesQueued += 1;
    }
    await admin
      .from("news_ingestions")
      .update({ status: "revised", processed_at: new Date().toISOString() })
      .eq("id", ingestionId);
    return;
  }

  // New post: classify + context score BEFORE inserting the row. A transient AI
  // failure throws, so the caller leaves the cursor untouched and the item is
  // retried next run rather than being permanently inserted and downgraded to
  // Discord-only with no article (F9). Because no row exists yet, the retry
  // re-runs classification cleanly (the dedup net only matches inserted rows). A
  // persistently failing item self-bounds: once it ages past the max-age cutoff it
  // takes the skipStale path above instead, so it cannot block the source forever.
  const ai = await runStructuredCall<CategorizeResult>({
    admin,
    stage: "categorize",
    model: settings.modelTriage,
    system: (settings.prompts.categorize || "").replace(
      "{categories}",
      categorySlugs,
    ),
    userContent: JSON.stringify(compactItem(item)),
    schema: CATEGORIZE_SCHEMA as unknown as Record<string, unknown>,
    ingestionId: null,
    sourceId: source.id,
    maxTokens: 1024,
  });
  if (!ai) {
    throw new Error(
      `categorize failed for ${item.source_external_id}; leaving cursor for retry`,
    );
  }

  // Resolve references with confidence: only exact, unambiguous matches auto-link.
  const refs = await matchReferences(admin, ai, settings);
  const resolved = {
    categoryId: refs.categoryId,
    playerIds: refs.playerIds,
    teamIds: refs.teamIds,
    roleIds: refs.roleIds,
  };
  const aiStored = {
    ...ai,
    resolved,
    pending: refs.pending,
  } as unknown as Json;

  // A retweet whose original could not be resolved carries only the truncated
  // "RT @user:" stub as its text, so it never becomes an article (F2): we still
  // post it to Discord, but force Discord-only regardless of context score.
  const meetsThreshold = (ai.context_score ?? 0) >= settings.contextThreshold;
  const makeArticle = meetsThreshold && !item.retweet_unresolved;

  // New post insert, now carrying the AI result. Guarded by the unique constraint
  // against a race; skip if a concurrent run beat us to it.
  const { data: inserted, error: insErr } = await admin
    .from("news_ingestions")
    .insert({
      ...baseRow,
      is_revision: false,
      revision_of_ingestion_id: null,
      ai_result: aiStored,
      context_score: ai.context_score ?? 0,
      status: makeArticle ? "processing" : "dropped_no_context",
      processed_at: makeArticle ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    await logBeaconBrief(admin, {
      stage: "ingest",
      level: "warn",
      sourceId: source.id,
      message: `insert skipped (${insErr?.message ?? "no row"})`,
    });
    return;
  }
  const ingestionId = inserted.id;
  summary.ingested += 1;
  await logBeaconBrief(admin, {
    stage: "ingest",
    sourceId: source.id,
    ingestionId,
    message: `ingested ${item.source_external_id}`,
  });

  if (meetsThreshold && item.retweet_unresolved) {
    await logBeaconBrief(admin, {
      stage: "categorize",
      level: "warn",
      sourceId: source.id,
      ingestionId,
      message:
        "retweet original unresolved; posting to Discord only and skipping article to avoid stub text",
    });
  }

  // Always post the original content to Discord (with resolved role mentions).
  await enqueue(admin, "discord_post", {
    ingestion_id: ingestionId,
    role_ids: refs.roleIds,
  });
  summary.discordQueued += 1;

  if (makeArticle) {
    await enqueue(admin, "article_write", {
      ingestion_id: ingestionId,
      mode: "create",
    });
    summary.articlesQueued += 1;
    // status stays 'processing' until the article_write job publishes it.
    // Non-confident names open moderation rows (article_id backfilled by the
    // worker once the article exists); confident refs auto-link via resolved.
    await openMatchModeration(admin, ingestionId, refs.pending, reviews);
  }
}
