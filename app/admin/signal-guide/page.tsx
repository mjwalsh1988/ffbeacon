import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, HelpCircle, Inbox, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Signal Guide" };
export const dynamic = "force-dynamic";

/**
 * Admin index for the Signal Guide. Lists every registered page with its question
 * and term counts and links into the per-page manager. Reads via the service-role
 * client so it can count unpublished entries too.
 */
export default async function AdminSignalGuidePage() {
  await requireAdmin("/admin/signal-guide");

  const admin = createAdminClient();
  const [{ data: pages }, { data: entries }, { count: pendingCount }] = await Promise.all([
    admin
      .from("guide_pages")
      .select("id, page_key, title, description, route_example, display_order")
      .order("display_order", { ascending: true })
      .order("title", { ascending: true }),
    admin.from("guide_entries").select("page_id, kind"),
    admin
      .from("guide_question_submissions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  const pending = pendingCount ?? 0;

  const counts = new Map<string, { questions: number; terms: number }>();
  for (const e of entries ?? []) {
    const c = counts.get(e.page_id) ?? { questions: 0, terms: 0 };
    if (e.kind === "question") c.questions += 1;
    else if (e.kind === "term") c.terms += 1;
    counts.set(e.page_id, c);
  }

  const rows = (pages ?? []).map((p) => ({
    ...p,
    questions: counts.get(p.id)?.questions ?? 0,
    terms: counts.get(p.id)?.terms ?? 0,
  }));

  const totalEntries = (entries ?? []).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Signal Guide
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        The per-page help shown to visitors. Each page has two sections: questions
        ("Understand the Signal") and terms ("Metrics &amp; Terms Decoded"). A page's
        floating guide button only appears to visitors once it has at least one published
        entry. {totalEntries} total {totalEntries === 1 ? "entry" : "entries"} across all
        pages.
      </p>

      <Link
        href="/admin/signal-guide/submissions"
        className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-brand-purple/40 bg-brand-purple/5 p-4 transition-colors hover:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-purple/15 text-brand-cyan">
            <Inbox aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">Community questions</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              Questions visitors asked when they could not find an answer.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2">
          {pending > 0 && (
            <span className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-brand-purple px-2 py-0.5 text-sm font-semibold text-black">
              {pending}
            </span>
          )}
          <span className="text-sm font-semibold text-brand-cyan">
            {pending > 0 ? `${pending} pending` : "Review"}
          </span>
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />
        </span>
      </Link>

      <ul role="list" className="mt-8 grid gap-3">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/admin/signal-guide/${encodeURIComponent(p.page_key)}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 transition-colors hover:border-brand-purple/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">{p.title}</p>
                <p className="mt-0.5 font-mono text-xs text-ink-subtle">
                  {p.route_example ?? p.page_key}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                  <HelpCircle aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                  <span>
                    {p.questions} {p.questions === 1 ? "question" : "questions"}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                  <Sparkles aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                  <span>
                    {p.terms} {p.terms === 1 ? "term" : "terms"}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-ink-subtle"
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
