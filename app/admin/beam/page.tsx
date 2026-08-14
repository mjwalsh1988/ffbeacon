import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadBeamSettings } from "@/lib/beam/settings";
import { capabilitySummary } from "@/lib/beam/examples";
import { BEAM_SUBPAGES } from "@/lib/beam-admin-nav";
import { BeamSettingsManager } from "@/components/admin/beam-settings-manager";

export const metadata: Metadata = { title: "Ask BEAM" };
export const dynamic = "force-dynamic";

/**
 * The BEAM admin landing page: the settings editor, plus counts that tell the
 * owner whether anything needs attention. The counts are two head-only queries,
 * so this page stays cheap even as the log grows.
 */
export default async function AdminBeamPage() {
  await requireAdmin("/admin/beam");

  const admin = createAdminClient();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [settings, pendingRequests, recentUnanswered, recentAnswered] = await Promise.all([
    loadBeamSettings(admin),
    admin
      .from("beam_learning_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("beam_queries")
      .select("id", { count: "exact", head: true })
      .in("outcome", ["unsupported", "error"])
      .gte("created_at", since7d),
    admin
      .from("beam_queries")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "answer")
      .gte("created_at", since7d),
  ]);

  const answered = recentAnswered.count ?? 0;
  const unanswered = recentUnanswered.count ?? 0;
  const total = answered + unanswered;
  const answerRate = total > 0 ? Math.round((answered / total) * 100) : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Ask BEAM</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
        BEAM answers plain-English questions from FF Beacon&apos;s own data. It has no
        model and makes nothing up: a question is matched against a closed vocabulary,
        a name is resolved against the player table, and the answer is read from the
        same rows the rest of the site renders.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Answered, last 7 days"
          value={answered.toLocaleString("en-US")}
          hint={answerRate === null ? "No questions yet." : `${answerRate}% of everything asked.`}
        />
        <Stat
          label="Unanswered, last 7 days"
          value={unanswered.toLocaleString("en-US")}
          hint="What to build next."
        />
        <Stat
          label="Learning requests waiting"
          value={(pendingRequests.count ?? 0).toLocaleString("en-US")}
          hint="People who asked us to teach it."
        />
      </dl>

      <nav aria-label="BEAM admin sections" className="mt-6">
        <ul role="list" className="grid gap-2 sm:grid-cols-3">
          {BEAM_SUBPAGES.filter((p) => p.href !== "/admin/beam").map((page) => (
            <li key={page.href}>
              <Link
                href={page.href}
                className="flex min-h-[44px] items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {page.label}
                <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8">
        <BeamSettingsManager
          initial={settings}
          capabilities={capabilitySummary().map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description,
          }))}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-ink">{value}</dd>
      <dd className="mt-0.5 text-xs text-ink-muted">{hint}</dd>
    </div>
  );
}
