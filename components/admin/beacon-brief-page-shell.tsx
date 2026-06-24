import type { ReactNode } from "react";
import { BeaconBriefSubNav } from "@/components/admin/beacon-brief-subnav";

/** Consistent header + sub-nav wrapper for every Beacon Brief admin page.
 *  Each page owns a single H1 for screen-reader navigation. */
export function BeaconBriefPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
          The Beacon Brief
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">{description}</p>
      </div>
      <BeaconBriefSubNav />
      <div>{children}</div>
    </div>
  );
}
