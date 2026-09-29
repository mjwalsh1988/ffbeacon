import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BriefDeskPageShell } from "@/components/admin/brief-desk-page-shell";
import { BRIEF_DESK_SUBPAGES } from "@/lib/brief-desk-admin-nav";
import { loadDeskActivity } from "@/lib/brief-desk/desk-activity";
import { formatEastern } from "@/lib/datetime";
import { countRelayReviewQueue } from "@/lib/relays/review-queue";

export const metadata: Metadata = { title: "Beacon Desk" };
export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold ${tone === "danger" && value > 0 ? "text-signal-danger" : "text-ink"}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export default async function BriefDeskOverviewPage() {
  await requireAdmin("/admin/brief-desk");
  const admin = createAdminClient();

  const briefCount = (status: string) =>
    admin
      .from("articles")
      .select("*", { count: "exact", head: true })
      .eq("article_type", "brief")
      .eq("status", status);
  const relayCount = (status: string) =>
    admin.from("relays").select("*", { count: "exact", head: true }).eq("status", status);

  const [inReview, published, rejected, relaysPublished, relaysHidden, relaysRetracted, relaysWaiting, activity] =
    await Promise.all([
      briefCount("in_review"),
      briefCount("published"),
      briefCount("rejected"),
      relayCount("published"),
      relayCount("hidden"),
      relayCount("retracted"),
      countRelayReviewQueue(admin),
      loadDeskActivity(admin),
    ]);

  const entry = (e: { at: string; message: string } | null) =>
    e ? `${formatEastern(e.at)}: ${e.message}` : "none recorded yet";

  return (
    <BriefDeskPageShell
      title="Overview"
      description="The Beacon Desk at a glance: editions and Relays waiting on you, what is live, and when the desk last asked for a bundle and last sent a draft. The curation pipeline that feeds it is under Pipeline health."
    >
      <div className="space-y-8">
        <section aria-labelledby="bd-editions">
          <h2 id="bd-editions" className="text-lg font-semibold tracking-tight text-ink">
            Editions
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="In review"
              value={inReview.count ?? 0}
              tone="danger"
              hint="waiting on you"
            />
            <StatCard label="Published" value={published.count ?? 0} hint="live editions" />
            <StatCard label="Rejected" value={rejected.count ?? 0} hint="sent back for a redraft" />
          </div>
        </section>

        <section aria-labelledby="bd-relays">
          <h2 id="bd-relays" className="text-lg font-semibold tracking-tight text-ink">
            Relays
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Waiting for review"
              value={relaysWaiting}
              tone="danger"
              hint="failed grounding, on the Relays page"
            />
            <StatCard label="Published" value={relaysPublished.count ?? 0} hint="on the feed" />
            <StatCard label="Hidden" value={relaysHidden.count ?? 0} hint="kept off the feed" />
            <StatCard label="Retracted" value={relaysRetracted.count ?? 0} hint="source post removed" />
          </div>
        </section>

        <section aria-labelledby="bd-desk">
          <h2 id="bd-desk" className="text-lg font-semibold tracking-tight text-ink">
            Desk activity
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <dt className="text-sm font-medium text-ink">Last bundle request</dt>
              <dd className="mt-1 text-sm text-ink-muted">{entry(activity.lastBundle)}</dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <dt className="text-sm font-medium text-ink">Last draft received</dt>
              <dd className="mt-1 text-sm text-ink-muted">{entry(activity.lastDraft)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="bd-pages">
          <h2 id="bd-pages" className="text-lg font-semibold tracking-tight text-ink">
            Sections
          </h2>
          <ul role="list" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BRIEF_DESK_SUBPAGES.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="block h-full min-h-[44px] rounded-card border border-line bg-surface/60 p-4 transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="block text-sm font-semibold text-ink">{p.label}</span>
                  <span className="mt-1 block text-xs text-ink-muted">{p.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </BriefDeskPageShell>
  );
}
