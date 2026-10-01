/**
 * Backfilling a published edition into the current format (plan section 23.6).
 *
 * The premium edition changed what an edition carries (game cards, awards,
 * the projection report, the editor's take), and the weeks already published
 * were drafted before it. A backfill redrafts one of them WITHOUT going back
 * through the pipeline, because the pipeline's approval posts to Discord and
 * emails the owner, and a week that was announced once must not be announced
 * again. It runs in two steps with the owner's look in between:
 *
 *   1. storeBackfillDraft: the redrafted payload is validated against the
 *      week's own bundle (built with ignoreExistingEdition, since the week is
 *      already published) and stored as a PRIVATE articles row with status
 *      'draft' and metadata.backfill_of naming the live article. The public
 *      read paths only ever select status 'published', so nothing about it is
 *      visible. No moderation row, no email, no Discord.
 *   2. applyBackfill: from the review page, after the owner has looked at the
 *      preview. The live article and its brief_editions row take the redrafted
 *      payload IN PLACE (same id, same slug, same published_at, same
 *      discord_posted_at), a revision is snapshotted, and the draft row is
 *      deleted. Nothing is queued anywhere.
 *
 * Every write is service-role. applyBackfill is reached only through an admin
 * server action; storeBackfillDraft only from scripts/brief-desk/backfill-edition.ts.
 */

import { revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { logBeaconBrief } from "@/lib/beacon-brief/ai";
import { buildBundle } from "./bundle";
import { draftSchema } from "./draft-schema";
import { buildValidationContext, editionArticleMetadata } from "./edition-write";
import { assembleContentMd } from "./publish";
import type { Bundle, Draft } from "./types";
import { validateDraft } from "./validate-draft";

type Admin = SupabaseClient<Database>;

export type BackfillResult<T> = ({ ok: true } & T) | { ok: false; error: string; errors?: string[]; warnings?: string[] };

/** The published edition for a week, or null. */
export async function loadPublishedEditionForWeek(
  admin: Admin,
  season: string,
  week: number,
): Promise<{ articleId: string; slug: string; editionId: string } | null> {
  const { data: editions } = await admin
    .from("brief_editions")
    .select("id, article_id")
    .eq("season", season)
    .eq("week", week)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!editions || editions.length === 0) return null;
  const { data: articles } = await admin
    .from("articles")
    .select("id, slug, status")
    .in("id", editions.map((e) => e.article_id))
    .eq("status", "published");
  const live = articles?.[0];
  if (!live) return null;
  const edition = editions.find((e) => e.article_id === live.id)!;
  return { articleId: live.id, slug: live.slug, editionId: edition.id };
}

/** The bundle for an already-published week, for redrafting it. */
export async function buildBackfillBundle(admin: Admin, season: string, week: number): Promise<Bundle> {
  const bundle = await buildBundle(admin, new Date(), { season, week }, { ignoreExistingEdition: true });
  if (!bundle.due) throw new Error(`No bundle for ${season} week ${week}: ${bundle.reason}`);
  return bundle;
}

/** The draft row's own slug: unique, and plainly not the live one. */
function draftSlugFor(liveSlug: string, now: Date): string {
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 12);
  return `${liveSlug}-redo-${stamp}`.slice(0, 120);
}

/**
 * Validate a redrafted payload against its week's bundle and store it as a
 * private draft beside the live edition. Replaces any earlier redo draft for
 * the same live article, so a second attempt does not pile up rows.
 */
export async function storeBackfillDraft(
  admin: Admin,
  input: { season: string; week: number; payload: unknown; bundle?: Bundle },
): Promise<BackfillResult<{ editionId: string; articleId: string; warnings: string[]; wordCount: number }>> {
  const live = await loadPublishedEditionForWeek(admin, input.season, input.week);
  if (!live) return { ok: false, error: `${input.season} week ${input.week} has no published edition to backfill.` };

  const shape = draftSchema.safeParse(input.payload);
  if (!shape.success) {
    return { ok: false, error: "The draft failed the shape check.", errors: shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const draft: Draft = { ...shape.data, slug: live.slug, run: { ...shape.data.run, source: "manual" } };

  const bundle = input.bundle ?? (await buildBackfillBundle(admin, input.season, input.week));
  const ctx = await buildValidationContext(admin, bundle, draft, { ownSlug: live.slug });
  const report = validateDraft(draft, ctx);
  if (!report.ok) return { ok: false, error: "The draft failed validation.", errors: report.errors, warnings: report.warnings };

  // One redo per live edition at a time.
  const { data: earlier } = await admin
    .from("articles")
    .select("id, metadata")
    .eq("article_type", "brief")
    .eq("status", "draft")
    .eq("origin", "brief_desk")
    .limit(50);
  const stale = (earlier ?? []).filter((a) => (a.metadata as { backfill_of?: unknown } | null)?.backfill_of === live.articleId);
  if (stale.length > 0) await admin.from("articles").delete().in("id", stale.map((a) => a.id));

  const e = bundle.edition;
  const now = new Date();
  const { data: article, error: articleError } = await admin
    .from("articles")
    .insert({
      title: draft.title,
      slug: draftSlugFor(live.slug, now),
      meta_description: draft.meta_description,
      tl_dr: draft.tl_dr,
      content_md: assembleContentMd(draft),
      status: "draft",
      article_type: "brief",
      origin: "brief_desk",
      season: Number(e.season),
      week: e.week,
      tags: [],
      metadata: { ...editionArticleMetadata(bundle, draft), backfill_of: live.articleId } as unknown as Json,
    })
    .select("id")
    .single();
  if (articleError || !article) return { ok: false, error: articleError?.message ?? "article insert returned nothing" };

  const { data: edition, error: editionError } = await admin
    .from("brief_editions")
    .insert({
      article_id: article.id,
      season: e.season,
      week: e.week,
      period_start: e.period_start,
      period_end: e.period_end,
      cadence: e.cadence,
      relay_ids: bundle.relays.map((r) => r.id),
      relay_count: bundle.relays.length,
      draft_source: "manual",
      draft_run_id: draft.run.run_id ?? null,
      draft_model: draft.run.model ?? null,
      draft_payload: draft as unknown as Json,
      research_log: draft.research_log as unknown as Json,
      validation_report: { errors: report.errors, warnings: report.warnings, word_count: report.word_count } as unknown as Json,
    })
    .select("id")
    .single();
  if (editionError || !edition) {
    await admin.from("articles").delete().eq("id", article.id);
    return { ok: false, error: editionError?.message ?? "edition insert returned nothing" };
  }
  await logBeaconBrief(admin, {
    stage: "brief_desk",
    level: "info",
    message: `backfill draft ${edition.id} stored for /brief/${live.slug} (${report.word_count} words, ${report.warnings.length} warnings); not published`,
  });
  return { ok: true, editionId: edition.id, articleId: article.id, warnings: report.warnings, wordCount: report.word_count };
}

/** Whether an article row is a backfill draft, and which live article it replaces. */
export function backfillTargetOf(article: { status: string; metadata: unknown }): string | null {
  if (article.status !== "draft") return null;
  const target = (article.metadata as { backfill_of?: unknown } | null)?.backfill_of;
  return typeof target === "string" && /^[0-9a-f-]{36}$/i.test(target) ? target : null;
}

/**
 * Put a stored backfill draft onto the live edition in place. No Discord post,
 * no email, no moderation row: the week was announced when it first went out.
 */
export async function applyBackfill(
  admin: Admin,
  input: { editionId: string; reviewedBy: string },
): Promise<BackfillResult<{ slug: string }>> {
  // ONLY FROM A PRODUCTION BUILD. A dev server can point at the production
  // database, and the code deployed before the game-by-game edition cannot
  // parse a payload carrying games or editor_take: the live page would fall
  // back to plain text. Pressing Apply on the deployed site after the deploy
  // is the one safe order (plan section 23.6).
  if (process.env.NODE_ENV !== "production") {
    return { ok: false, error: "Apply a backfill from the deployed site, not a local dev server." };
  }
  const { data: redo } = await admin
    .from("brief_editions")
    .select("id, article_id, season, week, draft_payload, research_log, validation_report, relay_ids, relay_count")
    .eq("id", input.editionId)
    .maybeSingle();
  if (!redo) return { ok: false, error: "Backfill draft not found." };
  // Both rows must be Brief editions: backfill_of is only ever written by
  // storeBackfillDraft, but nothing here should be able to overwrite any
  // other kind of article if that ever stops being true.
  const { data: redoArticle } = await admin
    .from("articles")
    .select("id, status, metadata")
    .eq("id", redo.article_id)
    .eq("article_type", "brief")
    .eq("origin", "brief_desk")
    .maybeSingle();
  if (!redoArticle) return { ok: false, error: "Backfill draft article not found." };
  const targetId = backfillTargetOf(redoArticle);
  if (!targetId) return { ok: false, error: "This edition is not a backfill draft." };

  const { data: target } = await admin
    .from("articles")
    .select("id, slug, status, title, content_md, metadata")
    .eq("id", targetId)
    .eq("article_type", "brief")
    .maybeSingle();
  if (!target || target.status !== "published") return { ok: false, error: "The edition this redo replaces is no longer published." };
  const { data: targetEdition } = await admin
    .from("brief_editions")
    .select("id, season, week, draft_payload, research_log, validation_report, relay_ids, relay_count, reviewed_by, reviewed_at")
    .eq("article_id", target.id)
    .maybeSingle();
  if (!targetEdition) return { ok: false, error: "The live edition has no brief_editions row." };
  if (targetEdition.season !== redo.season || targetEdition.week !== redo.week) {
    return { ok: false, error: "This redo is for a different week than the live edition it names." };
  }

  const parsed = draftSchema.safeParse(redo.draft_payload);
  if (!parsed.success) return { ok: false, error: "The stored redo no longer parses." };
  const draft: Draft = { ...parsed.data, slug: target.slug };

  // Claim the redo before touching the live rows. Two clicks, or two tabs,
  // both pass every check above; only one of them moves the draft out of
  // 'draft', and the other stops here with nothing written.
  const { data: claimed } = await admin
    .from("articles")
    .update({ status: "archived" })
    .eq("id", redoArticle.id)
    .eq("status", "draft")
    .select("id");
  if (!claimed || claimed.length !== 1) return { ok: false, error: "This redo is already being applied." };
  const release = () => admin.from("articles").update({ status: "draft" }).eq("id", redoArticle.id);

  // Keep what was live. The revision holds the old text; the payload the page
  // actually renders from is kept on the article the FIRST time a backfill
  // replaces it, so the originally published edition can always be rebuilt.
  const revisionNumber = async () => {
    const { data: last } = await admin
      .from("article_revisions")
      .select("revision_number")
      .eq("article_id", target.id)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (last?.revision_number ?? 0) + 1;
  };
  const { error: snapshotError } = await admin.from("article_revisions").insert({
    article_id: target.id,
    revision_number: await revisionNumber(),
    title: target.title,
    content_md: target.content_md,
    tags: [],
    category_id: null,
    source_ingestion_id: null,
    change_summary: "The text that was live before the game-by-game backfill",
  });
  if (snapshotError) {
    await release();
    return { ok: false, error: `Could not keep a copy of the live text, so nothing was replaced: ${snapshotError.message}` };
  }

  const liveMeta = (target.metadata ?? {}) as Record<string, unknown>;
  const { backfill_of: _ignored, ...metadata } = (redoArticle.metadata ?? {}) as Record<string, unknown>;
  void _ignored;
  const now = new Date().toISOString();
  metadata.pre_backfill_payload = liveMeta.pre_backfill_payload ?? { replaced_at: now, draft_payload: targetEdition.draft_payload };
  const contentMd = assembleContentMd(draft);

  // The edition row first: the page renders from its payload. If the article
  // update then fails, the edition row is put back, so the live page never
  // pairs one version's payload with the other's text.
  const { error: editionError } = await admin
    .from("brief_editions")
    .update({
      draft_payload: draft as unknown as Json,
      research_log: redo.research_log,
      validation_report: redo.validation_report,
      relay_ids: redo.relay_ids,
      relay_count: redo.relay_count,
      reviewed_by: input.reviewedBy,
      reviewed_at: now,
    })
    .eq("id", targetEdition.id);
  if (editionError) {
    await release();
    return { ok: false, error: editionError.message };
  }

  const { data: updated, error: articleError } = await admin
    .from("articles")
    .update({
      title: draft.title,
      meta_description: draft.meta_description,
      tl_dr: draft.tl_dr,
      content_md: contentMd,
      metadata: metadata as Json,
      last_updated: now,
    })
    .eq("id", target.id)
    .eq("status", "published")
    .select("id");
  if (articleError || !updated || updated.length !== 1) {
    await admin
      .from("brief_editions")
      .update({
        draft_payload: targetEdition.draft_payload,
        research_log: targetEdition.research_log,
        validation_report: targetEdition.validation_report,
        relay_ids: targetEdition.relay_ids,
        relay_count: targetEdition.relay_count,
        reviewed_by: targetEdition.reviewed_by,
        reviewed_at: targetEdition.reviewed_at,
      })
      .eq("id", targetEdition.id);
    await release();
    return { ok: false, error: articleError?.message ?? "The live edition changed while applying; nothing was replaced." };
  }

  await admin.from("article_revisions").insert({
    article_id: target.id,
    revision_number: await revisionNumber(),
    title: draft.title,
    content_md: contentMd,
    tags: [],
    category_id: null,
    source_ingestion_id: null,
    change_summary: "Backfilled into the game-by-game format (no Discord post)",
  });

  const cited = [...new Set(draft.sections.flatMap((s) => s.relay_ids))];
  if (cited.length > 0) await admin.from("relays").update({ brief_id: target.id, updated_at: now }).in("id", cited);
  const playerIds = [...new Set(draft.players)];
  if (playerIds.length > 0) {
    await admin
      .from("article_players")
      .upsert(playerIds.map((player_id) => ({ article_id: target.id, player_id })), { onConflict: "article_id,player_id", ignoreDuplicates: true });
  }

  await admin.from("articles").delete().eq("id", redoArticle.id);
  revalidateTag("home");
  await logBeaconBrief(admin, {
    stage: "brief_desk",
    level: "info",
    message: `backfill applied to /brief/${target.slug} from draft ${input.editionId}; no Discord post, no email`,
  });
  return { ok: true, slug: target.slug };
}
