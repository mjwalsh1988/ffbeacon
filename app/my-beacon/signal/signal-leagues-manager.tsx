"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Eye, Trophy } from "lucide-react";
import { saveSignalLeagues } from "./actions";

/**
 * Curate which already-synced Sleeper leagues appear on the public Signal
 * profile, and in what order. The list of selectable leagues is the set the
 * owner belongs to that we have already synced into our database, so the public
 * page never needs to call Sleeper. Each change persists immediately via the
 * saveSignalLeagues server action (which also revalidates the cached profile).
 */

export type SignalLeagueOption = {
  sleeperLeagueId: string;
  name: string;
  season: number;
  totalRosters: number | null;
};

export function SignalLeaguesManager({
  leagues,
  initialFeaturedIds,
}: {
  leagues: SignalLeagueOption[];
  initialFeaturedIds: string[];
}) {
  const byId = useMemo(
    () => new Map(leagues.map((l) => [l.sleeperLeagueId, l])),
    [leagues],
  );

  // Only keep featured ids that still map to a synced league the owner has.
  const [featuredIds, setFeaturedIds] = useState<string[]>(
    initialFeaturedIds.filter((id) => byId.has(id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const featured = featuredIds
    .map((id) => byId.get(id))
    .filter((l): l is SignalLeagueOption => !!l);
  const available = leagues.filter((l) => !featuredIds.includes(l.sleeperLeagueId));

  const persist = useCallback(
    async (nextIds: string[], message: string) => {
      setBusy(true);
      setError(null);
      const result = await saveSignalLeagues(nextIds);
      if (result.ok) {
        setFeaturedIds(nextIds);
        setAnnouncement(message);
      } else {
        setError(result.error);
      }
      setBusy(false);
    },
    [],
  );

  const add = (league: SignalLeagueOption) =>
    void persist(
      [...featuredIds, league.sleeperLeagueId],
      `${league.name} is now featured on your profile.`,
    );

  const remove = (league: SignalLeagueOption) =>
    void persist(
      featuredIds.filter((id) => id !== league.sleeperLeagueId),
      `${league.name} is no longer featured on your profile.`,
    );

  const move = (league: SignalLeagueOption, direction: "up" | "down") => {
    const index = featuredIds.indexOf(league.sleeperLeagueId);
    const swap = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= featuredIds.length) return;
    const next = [...featuredIds];
    [next[index], next[swap]] = [next[swap], next[index]];
    void persist(next, `Moved ${league.name} ${direction} in your league order.`);
  };

  if (leagues.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-base/40 p-5 text-sm text-ink-muted">
        No synced leagues yet. Open a league from{" "}
        <a
          href="/my-beacon/sleeper-leagues"
          className="font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          My Sleeper Leagues
        </a>{" "}
        and it will appear here to feature.
      </p>
    );
  }

  return (
    <div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            On your profile
          </h3>
          {featured.length === 0 ? (
            <p className="mt-3 rounded-card border border-dashed border-line bg-base/40 p-5 text-sm text-ink-muted">
              No leagues featured yet. Add one from below.
            </p>
          ) : (
            <ol role="list" className="mt-3 flex flex-col gap-2">
              {featured.map((league, index) => (
                <li
                  key={league.sleeperLeagueId}
                  className="flex flex-col gap-3 rounded-card border border-line bg-base p-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="w-7 shrink-0 text-center font-mono text-sm tabular-nums text-ink-subtle">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {league.name}
                      </p>
                      <p className="truncate text-xs text-ink-subtle">
                        {league.season} season
                        {league.totalRosters ? `, ${league.totalRosters} teams` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 sm:shrink-0">
                    <button
                      type="button"
                      onClick={() => move(league, "up")}
                      disabled={busy || index === 0}
                      aria-label={`Move ${league.name} up in your league order`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9"
                    >
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(league, "down")}
                      disabled={busy || index === featured.length - 1}
                      aria-label={`Move ${league.name} down in your league order`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9"
                    >
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(league)}
                      disabled={busy}
                      aria-label={`Remove ${league.name} from your profile`}
                      className="inline-flex h-11 items-center rounded-card border border-line px-3 text-xs font-semibold text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {available.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Not on your profile
            </h3>
            <ul role="list" className="mt-3 flex flex-col gap-2">
              {available.map((league) => (
                <li
                  key={league.sleeperLeagueId}
                  className="flex flex-col gap-3 rounded-card border border-line bg-base/60 p-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
                    >
                      <Trophy className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {league.name}
                      </p>
                      <p className="truncate text-xs text-ink-subtle">
                        {league.season} season
                        {league.totalRosters ? `, ${league.totalRosters} teams` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end sm:shrink-0">
                    <button
                      type="button"
                      onClick={() => add(league)}
                      disabled={busy}
                      aria-label={`Feature ${league.name} on your profile`}
                      className="inline-flex h-11 items-center gap-1.5 rounded-card border border-line px-3 text-sm font-semibold text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
                    >
                      <Eye aria-hidden="true" className="h-4 w-4" />
                      Feature
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
