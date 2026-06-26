import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BEACON_SUBPAGES } from "@/lib/beacon-admin-nav";

export const metadata: Metadata = { title: "Values, Rankings, & Sources" };
export const dynamic = "force-dynamic";

/** Parent landing: a short list of clear destinations, no controls. */
export default async function BeaconOverviewPage() {
  await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  const { stale, lastRunLabel } = await getRecomputeStatus(admin, Date.now());

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">Overview</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Values, Rankings, & Sources</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Control surface for the FF Beacon proprietary value engine. Choose a section below.
          {" "}Last recompute: {lastRunLabel}.{" "}
          {stale && <span className="font-semibold text-signal-warning">Settings changed since then; recompute on any settings page.</span>}
        </p>
      </header>

      <nav aria-label="Values, Rankings, and Sources sections">
        <ul role="list" className="grid gap-3 sm:grid-cols-2">
          {BEACON_SUBPAGES.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="group flex h-full items-start justify-between gap-4 rounded-card border border-line bg-surface/60 p-5 transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{p.label}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-muted">{p.description}</span>
                </span>
                <ArrowRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-ink-subtle transition-colors group-hover:text-brand-cyan" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
