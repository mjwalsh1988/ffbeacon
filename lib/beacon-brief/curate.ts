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
import { matchBlockedKeywords, parseBlocklist } from "./keyword-filter";
import { findFollowupTarget, loadFollowupCandidates } from "./followup";
import { sendBeaconBriefMatchDigestEmail } from "./email";
import type {
  BeaconBriefSourceItem,
  CategorizeResult,
  PendingReferenceMatch,
  QueueJobPayload,
  QueueJobType,
} from "./types";

type NewsSource = Database["public"]["Tables"]["news_sources"]["Row"];
type Ingestion = Database["public"]["Tables"]["news_ingestions"]["Row"];
type Admin = SupabaseClient<Database>;

const CATEGORIZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "non_football",
    "relevance_tier",
    "relevance_reason",
    "context_score",
    "category_slug",
    "players",
    "teams",
    "tags",
    "suggested_title",
    "suggested_slug",
  ],
  properties: {
    non_football: { type: "integer" },
    relevance_tier: { type: "integer" },
    relevance_reason: { type: "string" },
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

interface CurationSummary {
  sources: number;
  ingested: number;
  articlesQueued: number;
  discordQueued: number;
  revisions: number;
  filtered: number;
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
      filtered: 0,
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
    filtered: 0,
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

  // AI follow-up link. This catches a story that develops across poll runs, where
  // the earlier post already has a written article to point at. It CANNOT catch two
  // posts about one event in the same poll window: the first post's article does not
  // exist yet, so it is not a candidate. The worker re-asks just before writing to
  // close that gap; see ./followup.ts.
  if (!revisionOfIngestionId) {
    const candidates = await loadFollowupCandidates(admin, {
      sourceId: source.id,
      lookbackDays: settings.followupLookbackDays,
    });
    const hit = await findFollowupTarget({
      admin,
      settings,
      post: compactItem(item),
      candidates,
      sourceId: source.id,
    });
    if (hit) {
      revisionOfIngestionId = hit.ingestion_id;
      revisionTargetArticleId = hit.article_id;
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

  // Gate 1 (keyword pre-filter): a new post containing any blocked keyword is
  // diverted to the Filtered review queue BEFORE the AI call, so non-football
  // noise never reaches Discord or an article and we skip the AI cost. New posts
  // only (revisions returned above). Force-push from the review queue bypasses
  // this gate, so a forced post can never loop back into filtered.
  if (settings.keywordFilterEnabled) {
    const blocklist = parseBlocklist(settings.keywordFilter);
    const haystack = [item.text, item.quoted?.text, item.retweeted?.text]
      .filter(Boolean)
      .join("\n");
    const matched = matchBlockedKeywords(haystack, blocklist);
    if (matched.length > 0) {
      const { data: inserted } = await admin
        .from("news_ingestions")
        .insert({
          ...baseRow,
          is_revision: false,
          revision_of_ingestion_id: null,
          status: "filtered",
          filter_reason: "keyword",
          filter_detail: { matched_terms: matched } as unknown as Json,
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      summary.filtered += 1;
      await logBeaconBrief(admin, {
        stage: "ingest",
        sourceId: source.id,
        ingestionId: inserted?.id ?? null,
        message: `filtered (keyword: ${matched.join(", ")})`,
      });
      return;
    }
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

  // Gate 2 (AI non-football flag): the classifier flags posts that are not about
  // football (other sports, unrelated topics). These divert to the Filtered
  // review queue: no Discord, no article. The AI result is kept for the reviewer.
  // Force-push from the review queue bypasses this gate.
  if (settings.nonFootballFilterEnabled && (ai.non_football ?? 0) === 1) {
    const { data: inserted } = await admin
      .from("news_ingestions")
      .insert({
        ...baseRow,
        is_revision: false,
        revision_of_ingestion_id: null,
        ai_result: ai as unknown as Json,
        context_score: ai.context_score ?? 0,
        status: "filtered",
        filter_reason: "ai_non_football",
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    summary.filtered += 1;
    await logBeaconBrief(admin, {
      stage: "categorize",
      sourceId: source.id,
      ingestionId: inserted?.id ?? null,
      message: "filtered (AI flagged non-football)",
    });
    return;
  }

  // Gate 3 (fantasy relevance): the post IS about football but does not carry a
  // fantasy decision. Obituaries, uniform reveals, stadium and ownership news,
  // ceremonies, league business, front office moves. Gates 1 and 2 cannot catch
  // these because they are genuinely football content.
  //
  // This gate sits ahead of the ingestion insert on purpose, so a filtered post
  // never reaches the discord_post enqueue below. Every earlier exit is a "no
  // Discord" exit too; this one has to behave the same way, because the whole
  // point is that these stories do not reach the channel. Force-push from the
  // review queue bypasses this gate.
  const tier = ai.relevance_tier ?? 0;
  if (settings.relevanceFilterEnabled && tier < settings.relevanceThreshold) {
    const { data: inserted } = await admin
      .from("news_ingestions")
      .insert({
        ...baseRow,
        is_revision: false,
        revision_of_ingestion_id: null,
        ai_result: ai as unknown as Json,
        context_score: ai.context_score ?? 0,
        status: "filtered",
        filter_reason: "ai_low_relevance",
        filter_detail: {
          relevance_tier: tier,
          threshold: settings.relevanceThreshold,
          reason: ai.relevance_reason ?? "",
          stage: "categorize",
        } as unknown as Json,
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    summary.filtered += 1;
    await logBeaconBrief(admin, {
      stage: "categorize",
      sourceId: source.id,
      ingestionId: inserted?.id ?? null,
      message: `filtered (relevance tier ${tier} below threshold ${settings.relevanceThreshold}: ${ai.relevance_reason ?? "no reason given"})`,
    });
    return;
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

/** Compact, model-facing view rebuilt from a stored ingestion row (force-push). */
function compactFromRow(row: Ingestion) {
  const media = Array.isArray(row.media)
    ? (row.media as Array<{ type?: unknown }>).map((m) =>
        m && typeof m.type === "string" ? m.type : "media",
      )
    : [];
  const quoted = row.quoted as {
    text?: string;
    author_handle?: string | null;
  } | null;
  const retweeted = row.retweeted as {
    text?: string;
    author_handle?: string | null;
  } | null;
  return {
    text: row.text ?? "",
    author_handle: row.author_handle ?? "",
    media,
    quoted:
      quoted && typeof quoted.text === "string"
        ? { text: quoted.text, author_handle: quoted.author_handle ?? null }
        : null,
    retweeted:
      retweeted && typeof retweeted.text === "string"
        ? {
            text: retweeted.text,
            author_handle: retweeted.author_handle ?? null,
          }
        : null,
  };
}

/** Does a stored ai_result already carry the categorize fields we can reuse? */
function hasCategorizeFields(ai: unknown): ai is CategorizeResult {
  return (
    !!ai &&
    typeof ai === "object" &&
    "suggested_title" in (ai as Record<string, unknown>)
  );
}

/**
 * Force a filtered post back through the pipeline (admin action from the Filtered
 * review queue). Bypasses ALL THREE filter gates so a forced post can never loop
 * back into 'filtered': it does NOT re-run the keyword check, and it IGNORES both
 * non_football and relevance_tier. An AI-filtered post reuses its stored
 * categorize result; a keyword-filtered post (never classified) is classified
 * now. Reusing the stored result is what makes the relevance bypass work: the
 * tier is read from that object nowhere in this function. It then enqueues
 * discord_post and, when the post meets the context threshold, article_write,
 * exactly like a normal new post.
 */
export async function forcePushFilteredPost(
  admin: Admin,
  ingestionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await admin
    .from("news_ingestions")
    .select("*")
    .eq("id", ingestionId)
    .maybeSingle();
  if (!row) return { ok: false, error: "post not found" };
  if (row.status !== "filtered")
    return { ok: false, error: "post is not in the filtered state" };

  const settings = await loadBeaconBriefSettings(admin);

  // Reuse the stored classification when present (AI-filtered); otherwise classify
  // now (keyword-filtered posts were never classified). Either way non_football is
  // ignored here so the forced post is not re-filtered.
  let ai: CategorizeResult | null = hasCategorizeFields(row.ai_result)
    ? (row.ai_result as CategorizeResult)
    : null;
  if (!ai) {
    const categorySlugs = await activeCategorySlugs(admin);
    ai = await runStructuredCall<CategorizeResult>({
      admin,
      stage: "categorize",
      model: settings.modelTriage,
      system: (settings.prompts.categorize || "").replace(
        "{categories}",
        categorySlugs,
      ),
      userContent: JSON.stringify(compactFromRow(row)),
      schema: CATEGORIZE_SCHEMA as unknown as Record<string, unknown>,
      ingestionId,
      sourceId: row.source_id,
      maxTokens: 1024,
    });
    if (!ai) return { ok: false, error: "classification failed; try again" };
  }

  const refs = await matchReferences(admin, ai, settings);
  const aiStored = {
    ...ai,
    resolved: {
      categoryId: refs.categoryId,
      playerIds: refs.playerIds,
      teamIds: refs.teamIds,
      roleIds: refs.roleIds,
    },
    pending: refs.pending,
  } as unknown as Json;

  const makeArticle = (ai.context_score ?? 0) >= settings.contextThreshold;

  await admin
    .from("news_ingestions")
    .update({
      ai_result: aiStored,
      context_score: ai.context_score ?? 0,
      status: makeArticle ? "processing" : "dropped_no_context",
      filter_reason: null,
      filter_detail: null,
      processed_at: makeArticle ? null : new Date().toISOString(),
    })
    .eq("id", ingestionId);

  // Always post the original content to Discord (with resolved role mentions).
  await enqueue(admin, "discord_post", {
    ingestion_id: ingestionId,
    role_ids: refs.roleIds,
  });

  if (makeArticle) {
    await enqueue(admin, "article_write", {
      ingestion_id: ingestionId,
      mode: "create",
    });
    // Non-confident names open moderation rows once the article exists (no digest
    // email for a manual force-push, so pass an empty review list).
    await openMatchModeration(admin, ingestionId, refs.pending, []);
  }

  await logBeaconBrief(admin, {
    stage: "ingest",
    level: "info",
    sourceId: row.source_id,
    ingestionId,
    message: "force-pushed from the filtered review queue",
  });

  return { ok: true };
}
