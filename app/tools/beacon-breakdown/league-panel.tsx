"use client";

/**
 * The league connector.
 *
 * Two steps and no account: type a Sleeper username, pick a league. Picking one
 * navigates to a URL carrying the league and the reader's roster, so the whole
 * comparison is recomputed server-side against their actual team and the
 * resulting link is shareable with a leaguemate.
 *
 * Leagues nobody has opened before have no stored rosters, so picking one syncs
 * it from Sleeper first and then applies it. That wait is said out loud on the
 * row being synced rather than left to look like a stuck button. A league the
 * reader turns out not to have a team in is still refused afterwards, with that
 * reason said out loud too: "we did not look" and "you are not in it" must not
 * look the same.
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, X } from "lucide-react";
import {
  connectBreakdownLeagues,
  syncBreakdownLeague,
  type BreakdownLeague,
} from "./actions";

export type ActiveLeague = {
  sleeperLeagueId: string;
  name: string;
  teamName: string;
  record: string;
  season: number;
  scoringDescription: string;
};

export function LeaguePanel({
  active,
  defaultSeason,
  applyHrefBase,
  clearHref,
}: {
  /** Set when a league is already applied to this comparison. */
  active: ActiveLeague | null;
  defaultSeason: string;
  /**
   * The current URL with league and roster stripped. Picking a league appends
   * them. Passed as a string rather than a builder function because functions
   * cannot cross the server-to-client boundary.
   */
  applyHrefBase: string;
  /** The URL with league mode removed. */
  clearHref: string;
}) {
  const router = useRouter();
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState(defaultSeason);
  const [leagues, setLeagues] = useState<BreakdownLeague[] | null>(null);
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  /** The league currently being pulled from Sleeper, so only its row spins. */
  const [syncingLeagueId, setSyncingLeagueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [connecting, setConnecting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Move focus to the results once they arrive so a screen reader lands on the
  // list it just asked for rather than staying on the submit button.
  useEffect(() => {
    if (leagues && leagues.length > 0) listRef.current?.focus();
  }, [leagues]);

  async function onConnect(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLeagues(null);
    setConnecting(true);
    try {
      const result = await connectBreakdownLeagues({ username, season });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSleeperUserId(result.sleeperUserId);
      setLeagues(result.leagues);
    } catch {
      setError("Something went wrong reaching Sleeper. Try again in a moment.");
    } finally {
      setConnecting(false);
    }
  }

  function navigateTo(league: BreakdownLeague, rosterId: number) {
    const join = applyHrefBase.includes("?") ? "&" : "?";
    const href = `${applyHrefBase}${join}league=${encodeURIComponent(
      league.sleeperLeagueId,
    )}&roster=${rosterId}`;
    startTransition(() => {
      router.push(href);
    });
  }

  /**
   * Pick a league. One that has never been read is pulled from Sleeper first,
   * which is the same work opening it in League Pulse would have done, and then
   * applied without the reader having to come back and press it again.
   */
  async function applyLeague(league: BreakdownLeague) {
    setError(null);

    if (league.rosterId != null) {
      navigateTo(league, league.rosterId);
      return;
    }

    if (!sleeperUserId) {
      setError("Find your leagues again, then pick this one.");
      return;
    }

    setSyncingLeagueId(league.sleeperLeagueId);
    try {
      const result = await syncBreakdownLeague({
        sleeperLeagueId: league.sleeperLeagueId,
        sleeperUserId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Write the answer back either way, so a second press does not spend
      // another sync slot to learn the same thing.
      setLeagues((prev) =>
        (prev ?? []).map((l) =>
          l.sleeperLeagueId === league.sleeperLeagueId
            ? { ...l, rosterId: result.rosterId, synced: result.synced }
            : l,
        ),
      );
      if (!result.synced) {
        setError(`Sleeper gave us no rosters for ${league.name}, so there is nothing to compare against.`);
        return;
      }
      if (result.rosterId == null) {
        setError(`We read ${league.name} but could not find your team in it.`);
        return;
      }
      navigateTo(league, result.rosterId);
    } catch {
      setError("Something went wrong reaching Sleeper. Try again in a moment.");
    } finally {
      setSyncingLeagueId(null);
    }
  }

  if (active) {
    return (
      <section
        aria-label="Connected league"
        className="rounded-modal border border-brand-cyan/40 bg-brand-cyan/5 p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan">
              <Users aria-hidden="true" className="h-3.5 w-3.5" />
              Comparing for your team
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {active.teamName}
              <span className="font-normal text-ink-muted"> ({active.record})</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {active.name}, {active.season}. Scored as {active.scoringDescription}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => startTransition(() => router.push(clearHref))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:border-brand-cyan/50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            Use the general comparison
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className="rounded-modal border border-dashed border-line bg-surface/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={`${baseId}-heading`}
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <Users aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            Answer this for your actual team
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Connect a Sleeper league and we will score both players under your league&apos;s own
            rules, then work out how many points each one really adds to your starting lineup.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={false}
            aria-controls={`${baseId}-form`}
            className="inline-flex min-h-11 items-center rounded-card border border-line bg-base px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/50 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Connect a league
          </button>
        )}
      </div>

      {open && (
        <div id={`${baseId}-form`}>
          <form onSubmit={onConnect} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label
                htmlFor={`${baseId}-username`}
                className="block text-xs font-medium text-ink-muted"
              >
                Sleeper username
              </label>
              <input
                id={`${baseId}-username`}
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className="mt-1 block h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                placeholder="your Sleeper handle"
              />
            </div>
            <div className="w-28">
              <label
                htmlFor={`${baseId}-season`}
                className="block text-xs font-medium text-ink-muted"
              >
                Season
              </label>
              <input
                id={`${baseId}-season`}
                name="season"
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                inputMode="numeric"
                pattern="\d{4}"
                required
                className="mt-1 block h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              />
            </div>
            <button
              type="submit"
              disabled={connecting}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {connecting && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
              {connecting ? "Finding leagues" : "Find my leagues"}
            </button>
          </form>

          <p aria-live="polite" className="sr-only">
            {connecting ? "Looking up your leagues." : ""}
            {leagues && !connecting ? `Found ${leagues.length} leagues.` : ""}
            {syncingLeagueId
              ? " Reading that league from Sleeper. This takes a few seconds."
              : ""}
          </p>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-card border border-signal-warning/40 bg-signal-warning/5 px-3 py-2 text-sm text-ink"
            >
              {error}
            </p>
          )}

          {leagues && (
            <div ref={listRef} tabIndex={-1} className="mt-4 focus-visible:outline-none">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Your {season} leagues
              </h4>
              <ul role="list" className="mt-2 space-y-2">
                {leagues.map((league) => {
                  const ready = league.rosterId != null;
                  // Only a league we read and found no team in is a dead end.
                  // One nobody has read yet is not: picking it reads it.
                  const noTeam = league.synced && league.rosterId == null;
                  const syncing = syncingLeagueId === league.sleeperLeagueId;
                  return (
                    <li key={league.sleeperLeagueId}>
                      <button
                        type="button"
                        disabled={noTeam || pending || syncingLeagueId !== null}
                        onClick={() => void applyLeague(league)}
                        className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-card border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                          noTeam
                            ? "cursor-not-allowed border-line/50 bg-base/40 text-ink-subtle"
                            : "border-line bg-base text-ink hover:border-brand-cyan/50 disabled:opacity-60"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{league.name}</span>
                          <span className="block text-[11px] text-ink-subtle">
                            {league.teams ? `${league.teams} teams` : "Sleeper league"}
                            {syncing && ", reading it from Sleeper now."}
                            {!syncing &&
                              !league.synced &&
                              ", we read this one when you pick it."}
                            {!syncing && noTeam && ", we could not find your team in it."}
                          </span>
                        </span>
                        {syncing ? (
                          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-cyan">
                            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                            Syncing
                          </span>
                        ) : (
                          !noTeam && (
                            <span className="shrink-0 text-xs font-semibold text-brand-cyan">
                              {ready ? "Use this league" : "Sync and use"}
                            </span>
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
