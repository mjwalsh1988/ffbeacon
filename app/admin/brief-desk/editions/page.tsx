import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BriefDeskPageShell } from "@/components/admin/brief-desk-page-shell";
import { formatEastern } from "@/lib/datetime";

export const metadata: Metadata = { title: "Editions" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  in_review: "In review",
  published: "Published",
  rejected: "Rejected",
  archived: "Archived",
  draft: "Draft",
};

function periodLabel(e: { season: string; week: number | null; period_start: string; period_end: string }): string {
  if (e.week !== null) return `${e.season} week ${e.week}`;
  return `${e.season} off-season, ${formatEastern(e.period_start)} to ${formatEastern(e.period_end)}`;
}

export default async function BriefDeskEditionsPage() {
  const { userId } = await requireAdmin("/admin/brief-desk/editions");
  const admin = createAdminClient();

  const { data } = await admin
    .from("brief_editions")
    // NOT content_md, and not the whole validation_report. An in-season
    // edition's body is 12 to 26 KB of markdown, and the only thing this list
    // wanted from it was a word count the validator already computed and
    // stored. At the 200-row cap the old select moved several megabytes on
    // every load of an admin page that shows one number per row.
    .select(
      "id, season, week, cadence, period_start, period_end, relay_count, reviewed_by, reviewed_at, created_at, word_count:validation_report->>word_count, warnings:validation_report->warnings, articles(title, slug, status)",
    )
    .order("period_end", { ascending: false })
    .limit(200);

  const editions = (data ?? []).map((e) => {
    const row = e as unknown as {
      id: string;
      relay_count: number;
      reviewed_by: string | null;
      reviewed_at: string | null;
      created_at: string;
      word_count: string | null;
      warnings: unknown;
      articles?: { title?: string; slug?: string; status?: string } | null;
    };
    const art = row.articles;
    return {
      id: row.id,
      period: periodLabel(e),
      title: art?.title ?? "(untitled)",
      slug: art?.slug ?? null,
      status: art?.status ?? "unknown",
      words: Number(row.word_count ?? 0) || 0,
      relayCount: row.relay_count,
      warnings: Array.isArray(row.warnings) ? row.warnings.length : 0,
      reviewedBy: e.reviewed_by,
      reviewedAt: e.reviewed_at,
      receivedAt: e.created_at,
    };
  });

  const reviewer = (id: string | null) => {
    if (!id) return "not yet reviewed";
    return id === userId ? "you" : `admin ${id.slice(0, 8)}`;
  };

  return (
    <BriefDeskPageShell
      title="Editions"
      description="Every edition by period, newest first. Open one to read the validation report and the research log, edit its words, and approve or reject it. Showing up to 200."
    >
      {editions.length === 0 ? (
        <p className="text-sm text-ink-muted">No editions yet. The first one arrives when the desk routine sends a draft.</p>
      ) : (
        <ul role="list" className="space-y-3">
          {editions.map((e) => (
            <li key={e.id} className="rounded-card border border-line bg-surface/60 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{e.period}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    e.status === "in_review"
                      ? "border-signal-warning text-signal-warning"
                      : e.status === "published"
                        ? "border-brand-cyan text-brand-cyan"
                        : "border-line text-ink-muted"
                  }`}
                >
                  {STATUS_LABELS[e.status] ?? e.status}
                </span>
              </div>
              <p className="mt-1 font-medium text-ink">{e.title}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted sm:grid-cols-4">
                <div>
                  <dt className="inline">Words: </dt>
                  <dd className="inline text-ink">{e.words}</dd>
                </div>
                <div>
                  <dt className="inline">Relays: </dt>
                  <dd className="inline text-ink">{e.relayCount}</dd>
                </div>
                <div>
                  <dt className="inline">Warnings: </dt>
                  <dd className={`inline ${e.warnings > 0 ? "text-signal-warning" : "text-ink"}`}>{e.warnings}</dd>
                </div>
                <div>
                  <dt className="inline">Reviewed by: </dt>
                  <dd className="inline text-ink">
                    {reviewer(e.reviewedBy)}
                    {e.reviewedAt ? `, ${formatEastern(e.reviewedAt)}` : ""}
                  </dd>
                </div>
              </dl>
              <p className="mt-1 text-xs text-ink-subtle">Received {formatEastern(e.receivedAt)}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link
                  href={`/admin/brief-desk/editions/${e.id}`}
                  className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Review {e.title}
                </Link>
                {e.status === "published" && e.slug ? (
                  <Link
                    href={`/brief/${e.slug}`}
                    className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-cyan underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    View the published page
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </BriefDeskPageShell>
  );
}
