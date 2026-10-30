/**
 * The sheet while it loads (plan 9.17, 10.3): the same letterhead shape and
 * the same twelve ruled sections as the real sheet, each with a margin
 * column and a body column from lg, so nothing jumps when the report
 * arrives. The team name, league and season are already known, so the
 * letterhead prints them; only the figures pulse. aria-busy with one status
 * sentence; the pulse stops under reduced motion.
 */

const PULSE = "animate-pulse rounded bg-ink/[0.07] motion-reduce:animate-none";

const SECTIONS: Array<[string, string]> = [
  ["120px", "Standing"],
  ["200px", "The plan"],
  ["300px", "Grades by position"],
  ["520px", "Starting lineup"],
  ["420px", "Depth"],
  ["180px", "Share of the league"],
  ["300px", "Age by position"],
  ["260px", "Risers and fallers"],
  ["160px", "Spotlight"],
  ["640px", "Buy, sell, hold"],
  ["220px", "Draft capital"],
  ["480px", "Trade strategy"],
];

export function SheetSkeleton({ teamName, leagueName, season }: { teamName: string; leagueName: string; season: string }) {
  return (
    <div
      className="relative mt-6 overflow-hidden rounded-modal border border-line-accent bg-surface/60"
      aria-busy="true"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-beacon" />
      <div className="px-5 pb-6 pt-7 sm:px-8 sm:pt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/ff-beacon-mark-96.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" />
            <span className="text-sm font-semibold text-ink">FF Beacon</span>
            <span aria-hidden="true" className="h-3.5 w-px bg-line-accent" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Team Blueprint</span>
          </p>
          <p className="font-mono text-[11px] uppercase tracking-wide text-ink-subtle">{season} season report</p>
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="break-words text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">{teamName}</p>
            <p className="mt-2 text-sm text-ink-muted">Prepared for this team in {leagueName}.</p>
            <p role="status" className="mt-3 text-sm text-ink-muted">
              Building the blueprint: grades, calls and trade shapes from the league&apos;s own numbers.
            </p>
            <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`h-4 ${PULSE}`} />
              ))}
            </div>
          </div>
          <div className={`h-40 w-full rounded-card border-2 border-line-accent sm:w-48 ${PULSE}`} />
        </div>
      </div>
      {SECTIONS.map(([h, title]) => (
        <div key={title} className="grid gap-4 border-t border-line px-5 py-6 sm:px-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8 lg:py-8">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-ink-subtle">{title}</p>
          <div className={PULSE} style={{ height: h }} />
        </div>
      ))}
    </div>
  );
}
