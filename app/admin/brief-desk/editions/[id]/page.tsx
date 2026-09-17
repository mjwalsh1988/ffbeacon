import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BriefDeskPageShell } from "@/components/admin/brief-desk-page-shell";
import {
  EditionReview,
  type CitedRelay,
  type ResearchRow,
} from "@/components/admin/brief-desk/edition-review";
import { draftSchema, researchLogEntrySchema } from "@/lib/brief-desk/draft-schema";
import { loadBriefDeskSettings } from "@/lib/brief-desk/settings";
import { nonTickLines, parseReviewTicks } from "@/lib/brief-desk/review-ticks";
import type { ValidationReport } from "@/lib/brief-desk/types";
import { parseRelayFacts } from "@/lib/relays/types";
import { formatEastern } from "@/lib/datetime";

export const metadata: Metadata = { title: "Review edition" };
export const dynamic = "force-dynamic";

function parseReport(value: unknown): ValidationReport {
  const r = (value && typeof value === "object" ? value : {}) as Partial<ValidationReport>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    errors: strings(r.errors),
    warnings: strings(r.warnings),
    word_count: typeof r.word_count === "number" ? r.word_count : 0,
  };
}

export default async function BriefDeskEditionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin(`/admin/brief-desk/editions/${id}`);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const admin = createAdminClient();

  const { data: edition } = await admin
    .from("brief_editions")
    .select(
      "id, article_id, season, week, cadence, period_start, period_end, relay_ids, research_log, validation_report, review_notes, reviewed_by, reviewed_at, draft_payload, draft_source, draft_model, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!edition) notFound();

  const [{ data: article }, settings] = await Promise.all([
    admin
      .from("articles")
      .select("id, title, slug, status, meta_description, tl_dr")
      .eq("id", edition.article_id)
      .maybeSingle(),
    loadBriefDeskSettings(admin),
  ]);
  if (!article) notFound();

  const parsed = draftSchema.safeParse(edition.draft_payload);
  const draft = parsed.success ? parsed.data : null;
  const draftError = parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

  // The research log lives on the edition row; the draft carries a copy.
  const logParsed = z.array(researchLogEntrySchema).safeParse(edition.research_log);
  const researchLog: ResearchRow[] = (logParsed.success ? logParsed.data : (draft?.research_log ?? [])).map((r) => ({
    claim: r.claim,
    url: r.url,
    fetchedAt: r.fetched_at,
    note: r.note,
    kind: r.kind,
  }));

  const citedIds = [
    ...new Set([...(draft?.sections.flatMap((s) => s.relay_ids) ?? []), ...(edition.relay_ids ?? [])]),
  ];
  const relays: Record<string, CitedRelay> = {};
  if (citedIds.length > 0) {
    const { data: rows } = await admin
      .from("relays")
      .select("id, slug, headline, kind, facts, timeline, status, source_handle, source_posted_at")
      .in("id", citedIds.slice(0, 300));
    for (const r of rows ?? []) {
      relays[r.id] = {
        id: r.id,
        slug: r.slug,
        headline: r.headline,
        kind: r.kind,
        facts: parseRelayFacts(r.facts),
        timeline: r.timeline,
        status: r.status,
        sourceHandle: r.source_handle,
        sourcePostedAt: r.source_posted_at,
      };
    }
  }

  const period =
    edition.week !== null
      ? `${edition.season} week ${edition.week}`
      : `${edition.season} off-season, ${formatEastern(edition.period_start)} to ${formatEastern(edition.period_end)}`;

  return (
    <BriefDeskPageShell
      title={article.title}
      description={`${period}. Status: ${article.status.replace("_", " ")}. Received ${formatEastern(edition.created_at)} from ${edition.draft_source}${edition.draft_model ? ` (${edition.draft_model})` : ""}.`}
    >
      <p className="mb-4 text-sm">
        <Link
          href="/admin/brief-desk/editions"
          className="inline-flex min-h-[44px] items-center font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Back to all editions
        </Link>
      </p>
      <EditionReview
        editionId={edition.id}
        status={article.status}
        slug={article.slug}
        draft={draft}
        draftError={draftError}
        validation={parseReport(edition.validation_report)}
        researchLog={researchLog}
        relays={relays}
        ticks={parseReviewTicks(edition.review_notes)}
        reviewerNotes={nonTickLines(edition.review_notes)}
        discordDefault={settings.discordBriefsEnabled}
      />
    </BriefDeskPageShell>
  );
}
