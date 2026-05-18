import type { SleeperLeague } from "@/lib/sleeper";
import { ensureLeagueAndOpen } from "@/app/leagues/actions";

export function LeagueResults({
  leagues,
  sleeperUsername,
}: {
  leagues: SleeperLeague[];
  season: string;
  /** The Sleeper handle the user searched for. Threaded through the
   * "Open league" form so the deep view's team-filter chip bar can
   * default to that user's roster. */
  sleeperUsername: string | null;
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
            className="flex flex-col rounded-card border border-line bg-surface p-5"
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
            <form action={ensureLeagueAndOpen} className="mt-4">
              <input type="hidden" name="sleeper_league_id" value={league.league_id} />
              {sleeperUsername && (
                <input type="hidden" name="sleeper_username" value={sleeperUsername} />
              )}
              <button
                type="submit"
                aria-label={`Open ${league.name} deep view`}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-card bg-brand-purple px-4 py-2 text-sm font-semibold text-base hover:bg-brand-purple/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Open league
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
