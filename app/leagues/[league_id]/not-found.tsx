import Link from "next/link";

export default function LeagueNotFound() {
  return (
    <main id="main">
      <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
          League Pulse
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">League not found</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
          We could not load this Sleeper league. The league id may be wrong, the league
          may be private, or Sleeper may be temporarily unreachable.
        </p>
        <Link
          href="/tools/league-pulse"
          className="mt-6 inline-block min-h-11 rounded-card bg-brand-purple px-5 py-3 text-sm font-semibold text-[#07070D] hover:bg-brand-purple/90"
        >
          Back to League Pulse
        </Link>
      </div>
    </main>
  );
}
