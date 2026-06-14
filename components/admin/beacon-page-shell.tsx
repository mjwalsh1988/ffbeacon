import { BeaconSubNav } from "@/components/admin/beacon-subnav";
import { RecomputeBar } from "@/components/admin/recompute-bar";

/**
 * Consistent shell for every Player Values & Sources sub-page: the secondary
 * nav, a unique page H1 (the hero H1 is scoped to the /admin index, so every
 * sub-page owns its own single H1 for screen-reader navigation), an optional
 * recompute affordance, then the page's controls. Keeps heading order and the
 * "recompute now / settings changed" warning consistent across sub-pages.
 */
export function BeaconPageShell({
  title,
  description,
  recompute,
  children,
}: {
  title: string;
  description: string;
  recompute?: { stale: boolean; lastRunLabel: string };
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <BeaconSubNav />
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Player Values & Sources
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
      </header>
      {recompute && <RecomputeBar stale={recompute.stale} lastRunLabel={recompute.lastRunLabel} />}
      {children}
    </div>
  );
}
