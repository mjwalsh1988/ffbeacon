import type { SleeperLeague } from "@/lib/sleeper";

export function LeagueResults({
  leagues,
}: {
  leagues: SleeperLeague[];
  season: string;
}) {
  return (
    <section aria-labelledby="leagues-heading" className="mt-8">
      <h2 id="leagues-heading" className="sr-only">
        Your Sleeper leagues
      </h2>
      <ul className="grid gap-4 md:grid-cols-2">
        {leagues.map((league) => (
          <li
            key={league.league_id}
            className="rounded-card border border-line bg-surface p-5"
          >
            <h3 className="text-base font-semibold text-ink">{league.name}</h3>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-ink-subtle">Status</dt>
              <dd className="text-right capitalize text-ink-muted">{league.status}</dd>
              <dt className="text-ink-subtle">Teams</dt>
              <dd className="text-right font-mono text-ink-muted">{league.total_rosters}</dd>
              <dt className="text-ink-subtle">Roster</dt>
              <dd className="text-right text-ink-muted">
                {(league.roster_positions ?? []).filter((p) => p !== "BN").join(" / ") || "—"}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
