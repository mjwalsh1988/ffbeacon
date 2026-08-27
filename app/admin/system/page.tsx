import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "System Settings" };
export const dynamic = "force-dynamic";

const SECTIONS: Array<{ href: string; title: string; description: string }> = [
  {
    href: "/admin/system/webhooks",
    title: "Webhooks",
    description:
      "Discord incoming-webhook endpoints the site posts through, and which one the Beacon Brief uses.",
  },
  {
    href: "/admin/system/league-health",
    title: "League health",
    description:
      "Power Pulse and Positional WAR refresh status across every league: errors, stale successes, and counts by status.",
  },
];

// System Settings landing. Lists every sub-area; each owns its own page and
// its own H1.
export default async function SystemSettingsPage() {
  await requireAdmin("/admin/system");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
          Admin
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          System Settings
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Operational configuration and health for FF Beacon.
        </p>
      </div>

      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="group flex h-full flex-col justify-between gap-3 rounded-card border border-line bg-surface/60 p-5 transition-colors hover:border-brand-cyan/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <div>
                <p className="font-semibold text-ink">{section.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {section.description}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan group-hover:text-brand-purple">
                Open
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
