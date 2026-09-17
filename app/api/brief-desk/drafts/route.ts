import { NextResponse } from "next/server";
import { getIsAdmin } from "@/lib/admin-auth";
import { logBeaconBrief } from "@/lib/beacon-brief/ai";
import { sendBriefReadyEmail } from "@/lib/beacon-brief/email";
import { verifyBriefDeskRequest } from "@/lib/brief-desk/auth";
import { buildBundle } from "@/lib/brief-desk/bundle";
import { draftSchema } from "@/lib/brief-desk/draft-schema";
import { overrideForEdition } from "@/lib/brief-desk/override";
import { assembleContentMd } from "@/lib/brief-desk/publish";
import type { Bundle, BundleDataset, Draft } from "@/lib/brief-desk/types";
import { validateDraft, type ValidationContext } from "@/lib/brief-desk/validate-draft";
import type { Database, Json } from "@/lib/database.types";
import { formatEasternDate } from "@/lib/datetime";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Admin = SupabaseClient<Database>;

/**
 * POST /api/brief-desk/drafts (plan section 9.3)
 *
 * The second door. Same bearer check and rate limit as the bundle route. The
 * body is shape-checked with the zod draft schema, then validated against the
 * open period's bundle (the same bundle the run fetched, from the ten-minute
 * memo), and only then written: the articles row in review, the
 * brief_editions row, the player and team join rows, the brief_review
 * moderation row, and the "Brief ready for review" email. Nothing here
 * publishes and nothing here pings IndexNow; approval on the review page is
 * the only path to a live edition.
 *
 * A draft for a period other than the open one is accepted only when the
 * request also carries an admin session (the hand-written edition and a
 * redraft of a past week); otherwise the validator's period check fails it.
 *
 * Responses:
 *   201  { ok: true, edition_id, review_url }
 *   400  { error, issues? }  invalid JSON, or the zod shape check failed (issues are zod's)
 *   401  { error }           bad or missing token
 *   409  { error, reason }   no edition is due for the period, or one is already in review or published
 *   422  { error, errors, warnings, word_count }  the validator rejected the draft
 *   429  { error }           rate limited
 *   500  { error }           BRIEF_DESK_TOKEN unset, or a write failed
 */
export async function POST(req: Request) {
  const admin = createAdminClient();
  // A REFUSAL IS NEVER LOGGED TO THE DATABASE, for the reason written out in
  // the bundle route: the log row was a service-role INSERT an unauthenticated
  // caller could drive without limit.
  const auth = verifyBriefDeskRequest(req);
  if (!auth.ok) {
    console.warn(`brief-desk drafts POST: refused (${auth.status})`);
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const shape = draftSchema.safeParse(body);
  if (!shape.success) {
    // Before the rate limit, so to the console rather than the database: a
    // stuck run or a leaked token posting garbage must not insert a log row
    // per attempt with nothing in front of it.
    console.warn(`brief-desk drafts POST: shape check failed (${shape.error.issues.length} issues)`);
    return NextResponse.json({ error: "Draft failed the shape check", issues: shape.error.issues }, { status: 400 });
  }
  const draft = shape.data;

  // Validate before claiming: a draft that fails the shape check must not spend
  // the run's budget, and the seeded instructions tell it to fix and POST again.
  if (!(await claimRateLimitSlot({ bucket: "brief-desk", max: 10, windowSeconds: 3600 }))) {
    await logBeaconBrief(admin, { stage: "brief_desk", level: "warn", message: "drafts POST: rate limited" });
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const now = new Date();
    let bundle = await buildBundle(admin, now, null);
    // An admin may submit for a period other than the open one (the
    // hand-written edition, a redraft of a past week); the override is derived
    // from the draft's own edition, never from a free query, and only with an
    // admin session beside the token.
    const wantsAnotherPeriod = !bundle.due || !sameEdition(bundle, draft);
    if (wantsAnotherPeriod && (await getIsAdmin())) {
      bundle = await buildBundle(admin, now, overrideForEdition(draft.edition));
    }
    if (!bundle.due) {
      await logBeaconBrief(admin, { stage: "brief_desk", level: "warn", message: `drafts POST: refused, not due (${bundle.reason})` });
      return NextResponse.json({ error: "No edition is due for this period", reason: bundle.reason }, { status: 409 });
    }

    const ctx = await validationContext(admin, bundle, draft);
    const report = validateDraft(draft, ctx);
    if (!report.ok) {
      await logBeaconBrief(admin, {
        stage: "brief_desk",
        level: "warn",
        message: `drafts POST: rejected by the validator for ${describePeriod(bundle)} (${report.errors.length} errors)`,
        responsePayload: { errors: report.errors.slice(0, 40), warnings: report.warnings.slice(0, 40) } as Json,
      });
      return NextResponse.json(
        { error: "Draft failed validation", errors: report.errors, warnings: report.warnings, word_count: report.word_count },
        { status: 422 },
      );
    }

    const written = await writeEdition(admin, bundle, draft, report);
    if (!written.ok) {
      await logBeaconBrief(admin, { stage: "brief_desk", level: "error", message: `drafts POST: write failed for ${describePeriod(bundle)}: ${written.error}` });
      return NextResponse.json({ error: "Could not store the draft" }, { status: 500 });
    }

    const reviewPath = `/admin/brief-desk/editions/${written.editionId}`;
    await logBeaconBrief(admin, {
      stage: "brief_desk",
      level: "info",
      message: `drafts POST: edition ${written.editionId} in review for ${describePeriod(bundle)} (${report.word_count} words, ${report.warnings.length} warnings, run ${draft.run.source})`,
    });
    await sendBriefReadyEmail({
      editionId: written.editionId,
      title: draft.title,
      wordCount: report.word_count,
      warningCount: report.warnings.length,
      periodLabel: periodLabel(bundle),
    });
    return NextResponse.json({ ok: true, edition_id: written.editionId, review_url: reviewPath }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brief-desk/drafts] failed", message);
    await logBeaconBrief(admin, { stage: "brief_desk", level: "error", message: `drafts POST: failed: ${message.slice(0, 400)}` });
    return NextResponse.json({ error: "Draft handling failed" }, { status: 500 });
  }
}

function sameEdition(bundle: Bundle, draft: Draft): boolean {
  const e = draft.edition;
  return (
    e.season === bundle.edition.season &&
    e.week === bundle.edition.week &&
    new Date(e.period_end).getTime() === new Date(bundle.edition.period_end).getTime()
  );
}

function describePeriod(bundle: Bundle): string {
  const e = bundle.edition;
  return `${e.season} ${e.week === null ? "off-season" : `week ${e.week}`} ${e.period_start} to ${e.period_end}`;
}

function periodLabel(bundle: Bundle): string {
  const e = bundle.edition;
  return e.week === null ? `${e.season} off-season period through ${formatEasternDate(e.period_end)}` : `${e.season}, week ${e.week}`;
}

/** The validator's view of the bundle, plus which of the draft's slugs are taken. */
async function validationContext(admin: Admin, bundle: Bundle, draft: Draft): Promise<ValidationContext> {
  const candidates = [draft.slug, ...(draft.title_options ?? []).map((o) => o.slug)];
  const [{ data: articles }, { data: relays }] = await Promise.all([
    admin.from("articles").select("slug").in("slug", candidates),
    admin.from("relays").select("slug").in("slug", candidates),
  ]);
  const existingSlugs = new Set<string>([...(articles ?? []).map((a) => a.slug), ...(relays ?? []).map((r) => r.slug)]);
  const datasets: ValidationContext["datasets"] = {};
  for (const [id, d] of Object.entries(bundle.datasets)) datasets[id] = d.kind;
  return {
    period: {
      season: bundle.edition.season,
      week: bundle.edition.week,
      phase: bundle.edition.phase,
      preSeasonWeek: bundle.edition.pre_season_week,
      periodStart: bundle.edition.period_start,
      periodEnd: bundle.edition.period_end,
    },
    relays: bundle.relays.map((r) => ({ id: r.id, relevance_tier: r.relevance_tier, headline: r.headline })),
    datasets,
    playerIds: new Set(Object.keys(bundle.players)),
    existingSlugs,
  };
}

type WriteResult = { ok: true; editionId: string } | { ok: false; error: string };

async function writeEdition(
  admin: Admin,
  bundle: Bundle,
  draft: Draft,
  report: { errors: string[]; warnings: string[]; word_count: number },
): Promise<WriteResult> {
  const e = bundle.edition;
  // The public page, the editions listing and the OG card read the ARTICLES
  // row (see lib/brief-desk/edition-metadata.ts for every key). Only the
  // datasets the draft's blocks reference travel, each whole; the rest of the
  // bundle stays in brief_editions.draft_payload and the memo.
  const referenced: Record<string, BundleDataset> = {};
  for (const b of draft.blocks) {
    const d = b.dataset_id ? bundle.datasets[b.dataset_id] : undefined;
    if (d) referenced[d.id] = d;
  }
  const statTiles = (bundle.datasets.week_stat_tiles?.rows ?? [])
    .map((row) => ({ label: row.label, value: row.value }))
    .filter((t): t is { label: string; value: string } => typeof t.label === "string" && t.value !== null && t.value !== undefined)
    .map((t) => ({ label: t.label, value: String(t.value) }));
  const { data: article, error: articleError } = await admin
    .from("articles")
    .insert({
      title: draft.title,
      slug: draft.slug,
      meta_description: draft.meta_description,
      tl_dr: draft.tl_dr,
      content_md: assembleContentMd(draft),
      status: "in_review",
      article_type: "brief",
      origin: "brief_desk",
      season: Number(e.season),
      week: e.week,
      tags: [],
      metadata: {
        period_start: e.period_start,
        period_end: e.period_end,
        cadence: e.cadence,
        phase: e.phase,
        formats: bundle.context.formats.map((f) => ({ slug: f.slug, display: f.display })),
        source_display: bundle.context.source_display,
        stat_tiles: statTiles,
        datasets: referenced,
      } as unknown as Json,
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
      draft_source: draft.run.source,
      draft_run_id: draft.run.run_id ?? null,
      draft_model: draft.run.model ?? null,
      draft_payload: draft as unknown as Json,
      research_log: draft.research_log as unknown as Json,
      validation_report: { errors: report.errors, warnings: report.warnings, word_count: report.word_count } as unknown as Json,
    })
    .select("id")
    .single();
  if (editionError || !edition) {
    // Never leave an article in review with no edition behind it.
    await admin.from("articles").delete().eq("id", article.id);
    return { ok: false, error: editionError?.message ?? "edition insert returned nothing" };
  }

  const playerIds = [...new Set(draft.players)].filter((id) => id in bundle.players);
  if (playerIds.length > 0) {
    const { error: e } = await admin
      .from("article_players")
      .insert(playerIds.map((player_id) => ({ article_id: article.id, player_id })));
    if (e) await logBeaconBrief(admin, { stage: "brief_desk", level: "error", message: `edition ${edition.id}: article_players insert failed: ${e.message}` });
  }
  const abbreviations = [...new Set(draft.teams.map((t) => t.toUpperCase()))];
  if (abbreviations.length > 0) {
    const { data: teams } = await admin.from("nfl_teams").select("id").in("abbreviation", abbreviations);
    if (teams && teams.length > 0) {
      const { error: e } = await admin
        .from("article_teams")
        .insert(teams.map((t) => ({ article_id: article.id, team_id: t.id })));
      if (e) await logBeaconBrief(admin, { stage: "brief_desk", level: "error", message: `edition ${edition.id}: article_teams insert failed: ${e.message}` });
    }
  }

  // The review row is what puts the edition in front of the owner and what the
  // "ready for review" email points at. A silent failure here sends the email
  // for an edition nothing is holding, and the approve action then updates no
  // row and does not complain either.
  const { error: modError } = await admin.from("beacon_brief_moderation").insert({
    type: "brief_review",
    status: "pending",
    article_id: article.id,
    detail: { edition_id: edition.id, warnings: report.warnings, word_count: report.word_count } as unknown as Json,
  });
  if (modError) {
    await admin.from("brief_editions").delete().eq("id", edition.id);
    await admin.from("articles").delete().eq("id", article.id);
    return { ok: false, error: `the review row could not be opened: ${modError.message}` };
  }

  return { ok: true, editionId: edition.id };
}
