import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Flag, Smile } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Signal" };
export const dynamic = "force-dynamic";

/**
 * Index for the Signal admin section. Links to the moderation queue and the
 * reaction catalog manager.
 */
export default async function AdminSignalPage() {
  await requireAdmin();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Signal
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Moderation and configuration for creator profiles.
      </p>

      <ul role="list" className="mt-8 grid gap-4 sm:grid-cols-2">
        <li>
          <Link
            href="/admin/signal/reports"
            className="flex h-full flex-col rounded-card border border-line bg-surface p-5 transition-colors hover:border-brand-purple/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span className="flex items-center gap-2 text-brand-cyan">
              <Flag aria-hidden="true" className="h-5 w-5" />
              <span className="text-base font-semibold text-ink">
                Moderation queue
              </span>
            </span>
            <span className="mt-2 text-sm text-ink-muted">
              Review reported Wall posts and hide or restore them.
            </span>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan">
              Open queue
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/signal/reactions"
            className="flex h-full flex-col rounded-card border border-line bg-surface p-5 transition-colors hover:border-brand-purple/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span className="flex items-center gap-2 text-brand-cyan">
              <Smile aria-hidden="true" className="h-5 w-5" />
              <span className="text-base font-semibold text-ink">
                Reaction catalog
              </span>
            </span>
            <span className="mt-2 text-sm text-ink-muted">
              Manage the reactions viewers can add to Wall posts and comments.
            </span>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan">
              Open catalog
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
