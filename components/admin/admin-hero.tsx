/**
 * Admin index hero. Carries the single H1 for the /admin overview page. It is
 * intentionally NOT in the admin layout: every other admin page owns its own
 * unique H1 (cron logs, and each Player Values & Sources sub-page via
 * BeaconPageShell), so screen-reader heading navigation lands on a page-specific
 * H1 everywhere.
 */
export function AdminHero() {
  // Rendered inside the admin content container (max-w-7xl, padded), so this
  // component does not re-apply width/horizontal padding.
  return (
    <header className="relative overflow-hidden rounded-card border border-line bg-surface/40">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      <div className="relative px-5 py-10 sm:px-8 sm:py-12">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Admin
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          System control panel
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
          Health, activity, and operational logs for FF Beacon. Visible only to
          admins.
        </p>
      </div>
    </header>
  );
}
