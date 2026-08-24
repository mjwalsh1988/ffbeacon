"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  Calculator,
  Layers,
  Link2,
  Loader2,
  Trophy,
  UserSearch,
  Users,
} from "lucide-react";
import {
  connectSleeperLeagues,
  fetchLeagueFreeAgents,
  runAllLeagueBids,
  runLeagueBid,
  syncConnectedLeague,
  type ConnectedLeague,
} from "./actions";
import { useStepScroll } from "@/lib/use-step-scroll";
import { BidResult, viewFromLeagueReport } from "./bid-result";
import { PlayerCombobox, type FaabPlayer } from "./player-combobox";
import type { LeagueFaabReport, MultiLeagueRow, NeedLevel } from "@/lib/faab/types";

/**
 * The connected-league path, and the first thing on the page.
 *
 * It leads rather than hides because it is the better answer: a bid measured
 * against the reader's actual roster beats one measured against a generic
 * league every time. The manual calculator sits underneath it behind an "or",
 * so nobody is forced through this to get a number.
 *
 * No sign-in. A Sleeper username is enough, the same way League Pulse works.
 */

type Props = {
  formatName: string;
  needLevel: NeedLevel;
  /**
   * The budget from the manual form, used only for leagues that publish no FAAB
   * budget through Sleeper, where every team would otherwise price at zero.
   */
  fallbackBudget: number;
  leagueModeNotice: string;
  /** Server-derived so the list cannot differ between renders. */
  seasons: string[];
  /**
   * The signed-in reader's linked Sleeper handle. Prefilled, never submitted:
   * they still press the button, so nobody who came for the manual calculator
   * gets a league lookup they did not ask for.
   */
  initialUsername?: string | null;
  /** Format and ranking source the free-agent list is read against. */
  formatSlug: string;
  sourceSlug: string | null;
};

export function LeaguePanel({
  formatName,
  needLevel,
  fallbackBudget,
  leagueModeNotice,
  seasons,
  initialUsername = null,
  formatSlug,
  sourceSlug,
}: Props) {
  const ids = useId();
  const [username, setUsername] = useState(initialUsername ?? "");
  const [season, setSeason] = useState(seasons[0] ?? "");

  const [connecting, startConnecting] = useTransition();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<ConnectedLeague[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");

  const [query, setQuery] = useState("");
  const [player, setPlayer] = useState<FaabPlayer | null>(null);

  // The players actually available in the selected league. Until this loads the
  // search box has nothing trustworthy to offer, so it stays disabled rather
  // than falling back to the full ranked list, which is mostly players you
  // cannot bid on.
  const [freeAgents, setFreeAgents] = useState<FaabPlayer[] | null>(null);
  const [rosteredCount, setRosteredCount] = useState(0);
  const [leaguePositions, setLeaguePositions] = useState<string[]>([]);
  const [freeAgentError, setFreeAgentError] = useState<string | null>(null);
  const [loadingAgents, startLoadingAgents] = useTransition();
  // Split out from loadingAgents because the two waits are different lengths and
  // different promises. Reading a synced league is a database query; syncing an
  // unsynced one is a round trip to Sleeper plus every derived pass, so the
  // reader is told which one they are waiting on.
  const [syncingLeague, setSyncingLeague] = useState(false);

  const [pricing, startPricing] = useTransition();
  const [report, setReport] = useState<LeagueFaabReport | null>(null);
  const [bidError, setBidError] = useState<string | null>(null);

  const [checkingAll, startCheckingAll] = useTransition();
  const [allRows, setAllRows] = useState<MultiLeagueRow[] | null>(null);
  const [allNotChecked, setAllNotChecked] = useState(0);
  const [allError, setAllError] = useState<string | null>(null);

  const connected = leagues.length > 0;
  const selected = leagues.find((l) => l.sleeperLeagueId === selectedLeagueId) ?? null;
  const priceable = leagues.filter((l) => l.synced && l.rosterId !== null);

  // Both of these answer a question the reader just asked, so both land on the
  // answer rather than the top of the page. The lookup reveals the league and
  // player step below the username form; a bid reveals the number underneath
  // that. Neither changes the URL, so nothing moves the page on its own, and
  // on a phone the new block can open entirely below the fold. Going back to
  // disconnected or clearing a result passes null and moves nobody.
  useStepScroll(connected ? "connected" : null, { id: `${ids}-league-step` });
  useStepScroll(report ? report.headline : null, { id: `${ids}-result` });

  // A new player invalidates every answer on screen. A stale bid sitting under a
  // different name is the one failure here that could cost somebody money.
  useEffect(() => {
    setReport(null);
    setAllRows(null);
    setBidError(null);
    setAllError(null);
  }, [player?.sleeper_id]);

  // Read inside the league effect without listing them as dependencies. Both
  // change as a RESULT of that effect running: it writes the synced league back
  // into `leagues`, and listing that here would restart the effect it just
  // finished, clearing the list the reader is about to search.
  const leaguesRef = useRef(leagues);
  leaguesRef.current = leagues;
  const sleeperUserIdRef = useRef(sleeperUserId);
  sleeperUserIdRef.current = sleeperUserId;

  // Availability is per league, so switching leagues invalidates both the list
  // and whoever was picked from the previous one.
  //
  // A league nobody has opened is synced here rather than refused. We hold no
  // rosters for it, so there is nothing to answer with until Sleeper is asked,
  // and sending the reader off to open it somewhere else was never the answer
  // they came for.
  useEffect(() => {
    setFreeAgents(null);
    setFreeAgentError(null);
    setPlayer(null);
    setQuery("");
    setSyncingLeague(false);
    if (!selectedLeagueId || !sourceSlug) return;

    // Guards the reader who changes their mind mid-sync: a slow answer for a
    // league they have already moved on from must not overwrite the new one.
    let current = true;

    const picked = leaguesRef.current.find(
      (l) => l.sleeperLeagueId === selectedLeagueId,
    );
    const needsSync = Boolean(picked && (!picked.synced || picked.rosterId === null));
    const userId = sleeperUserIdRef.current;

    startLoadingAgents(async () => {
      if (needsSync && userId) {
        setSyncingLeague(true);
        const synced = await syncConnectedLeague({
          sleeperLeagueId: selectedLeagueId,
          sleeperUserId: userId,
        });
        if (!current) return;
        setSyncingLeague(false);
        if (!synced.ok) {
          setFreeAgentError(synced.error);
          return;
        }
        setLeagues((prev) =>
          prev.map((l) =>
            l.sleeperLeagueId === selectedLeagueId ? { ...l, ...synced.patch } : l,
          ),
        );
        if (!synced.patch.synced) {
          setFreeAgentError(
            "Sleeper gave us no rosters for that league, so there is nothing to price a bid against yet.",
          );
          return;
        }
        if (synced.patch.rosterId === null) {
          setFreeAgentError(
            `We synced that league but could not find a team owned by ${username.trim() || "you"} in it.`,
          );
          return;
        }
      }

      const result = await fetchLeagueFreeAgents({
        sleeperLeagueId: selectedLeagueId,
        formatSlug,
        sourceSlug,
      });
      if (!current) return;
      if (!result.ok) {
        setFreeAgentError(result.error);
        return;
      }
      setFreeAgents(result.players);
      setRosteredCount(result.rostered);
      setLeaguePositions(result.positions);
    });

    return () => {
      current = false;
    };
    // `username` is read only for an error message, and `leagues` and
    // `sleeperUserId` come through refs above, so none of them belongs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeagueId, formatSlug, sourceSlug]);

  const connect = useCallback(() => {
    setConnectError(null);
    startConnecting(async () => {
      const result = await connectSleeperLeagues({ username, season });
      if (!result.ok) {
        setConnectError(result.error);
        setLeagues([]);
        setSleeperUserId(null);
        return;
      }
      setSleeperUserId(result.sleeperUserId);
      setLeagues(result.leagues);
      const first = result.leagues.find((l) => l.synced && l.rosterId !== null);
      setSelectedLeagueId(first?.sleeperLeagueId ?? "");
    });
  }, [username, season]);

  const priceOne = useCallback(() => {
    if (!player?.sleeper_id || !selected?.rosterId) return;
    setBidError(null);
    startPricing(async () => {
      const result = await runLeagueBid({
        sleeperLeagueId: selected.sleeperLeagueId,
        sleeperRosterId: selected.rosterId as number,
        candidateSleeperId: player.sleeper_id as string,
        needLevel,
        fallbackBudget,
      });
      if (!result.ok) {
        setBidError(result.error);
        setReport(null);
        return;
      }
      setReport(result.report);
    });
  }, [player, selected, needLevel, fallbackBudget]);

  const priceAll = useCallback(() => {
    if (!player?.sleeper_id || !sleeperUserId) return;
    setAllError(null);
    startCheckingAll(async () => {
      const result = await runAllLeagueBids({
        sleeperUserId,
        sleeperLeagueIds: priceable.map((l) => l.sleeperLeagueId),
        candidateSleeperId: player.sleeper_id as string,
        needLevel,
        fallbackBudget,
      });
      if (!result.ok) {
        setAllError(result.error);
        setAllRows(null);
        return;
      }
      setAllRows(result.rows);
      setAllNotChecked(result.notChecked);
    });
  }, [player, sleeperUserId, priceable, needLevel, fallbackBudget]);

  const busy = connecting || pricing || checkingAll || loadingAgents;

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface p-5 sm:p-6"
      style={{
        boxShadow: "0 0 70px -40px rgba(168, 85, 247, 0.9)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 62%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 text-brand-purple"
        >
          <Link2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2
            id={`${ids}-heading`}
            className="text-xl font-semibold tracking-tight text-ink sm:text-2xl"
          >
            Price a bid against your actual roster
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            We project every remaining week with him and without him, in your
            league&apos;s scoring. Sleeper username only, no account.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {/* Step 1: who are you */}
        {/* Capped on purpose. The panel spans whatever the page gives it, but
            a username box and a season select have a natural size and the extra
            width would all land in the text field. */}
        <div className="grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label htmlFor={`${ids}-username`} className="block text-sm font-medium text-ink">
              Sleeper username
            </label>
            <input
              id={`${ids}-username`}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  connect();
                }
              }}
              aria-describedby={connectError ? `${ids}-connect-error` : undefined}
              aria-invalid={connectError ? true : undefined}
              className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-season`} className="block text-sm font-medium text-ink">
              Season
            </label>
            <select
              id={`${ids}-season`}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30 sm:w-28"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={connect}
            disabled={busy || username.trim().length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-brand-purple/50 bg-brand-purple/15 px-5 py-2.5 text-sm font-semibold text-brand-purple transition-colors hover:bg-brand-purple/25 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {connecting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {connecting ? "Finding" : "Find my leagues"}
          </button>
        </div>

        {connectError && (
          <p id={`${ids}-connect-error`} role="alert" className="text-sm text-signal-danger">
            {connectError}
          </p>
        )}

        {/* Step 2: which league, which player.
            Two columns on a wide screen because the two choices are one step,
            not two, and stacking them made the second look like a follow-up the
            reader had to scroll to find. Stacks on a phone with nothing
            dropped. */}
        {connected && (
          <form
            id={`${ids}-league-step`}
            onSubmit={(e) => {
              e.preventDefault();
              priceOne();
            }}
            className="scroll-mt-24 rounded-card border border-line bg-base/50 p-4 sm:p-5"
          >
            <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
              {/* Pick your league */}
              <section aria-labelledby={`${ids}-league-heading`} className="min-w-0">
                <h3
                  id={`${ids}-league-heading`}
                  className="flex items-center gap-2 text-sm font-semibold text-ink"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 text-brand-purple"
                  >
                    <Trophy className="h-4 w-4" />
                  </span>
                  Pick your league
                </h3>

                <label htmlFor={`${ids}-league`} className="sr-only">
                  Your league
                </label>
                <select
                  id={`${ids}-league`}
                  value={selectedLeagueId}
                  onChange={(e) => {
                    setSelectedLeagueId(e.target.value);
                    setReport(null);
                    setBidError(null);
                  }}
                  className="mt-3 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                >
                  <option value="">Select a league</option>
                  {leagues.map((l) => (
                    <option key={l.sleeperLeagueId} value={l.sleeperLeagueId}>
                      {l.name}
                      {l.synced && l.rosterId !== null
                        ? l.remainingBudget !== null
                          ? ` (${l.remainingBudget} FAAB left)`
                          : ""
                        : " (syncs when picked)"}
                    </option>
                  ))}
                </select>

                {leagues.some((l) => !l.synced || l.rosterId === null) && (
                  <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
                    <Layers
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
                    />
                    <span>
                      Leagues marked &quot;syncs when picked&quot; are new to us. Pick one
                      and we read it from Sleeper on the spot.
                    </span>
                  </p>
                )}
              </section>

              {/* Pick your player */}
              <section
                aria-labelledby={`${ids}-player-heading`}
                className="min-w-0 border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
              >
                <h3
                  id={`${ids}-player-heading`}
                  className="flex items-center gap-2 text-sm font-semibold text-ink"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
                  >
                    <UserSearch className="h-4 w-4" />
                  </span>
                  Pick your player
                </h3>

                <div className="mt-3">
                  {loadingAgents ? (
                    <p className="flex items-center gap-2 text-sm text-ink-muted">
                      <Loader2
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin text-brand-cyan"
                      />
                      {syncingLeague
                        ? "Reading this league from Sleeper. A few seconds."
                        : "Checking who is available."}
                    </p>
                  ) : freeAgentError ? (
                    <p role="alert" className="text-sm text-signal-danger">
                      {freeAgentError}
                    </p>
                  ) : freeAgents ? (
                    <PlayerCombobox
                      players={freeAgents}
                      query={query}
                      onQueryChange={setQuery}
                      selected={player}
                      onSelect={(p) => {
                        setPlayer(p);
                        setQuery(p ? p.name : "");
                      }}
                      formatName={formatName}
                      label="Free agent you are bidding on"
                      helpText={`${freeAgents.length} free agents, in the positions this league starts (${leaguePositions.join(", ")}). ${rosteredCount} ranked players are already owned.`}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Pick a league first and we will list who is free in it.
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="mt-5 flex flex-wrap gap-3 border-t border-line pt-5">
              {/* A real submit, styled like the hero's primary action, so the
                  one thing the reader came here to press looks like it. */}
              <button
                type="submit"
                disabled={busy || !player?.sleeper_id || !selected?.rosterId}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {pricing ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Calculator aria-hidden="true" className="h-4 w-4" />
                )}
                {pricing ? "Pricing" : "Price this bid"}
              </button>

              {priceable.length > 1 && (
                <button
                  type="button"
                  onClick={priceAll}
                  disabled={busy || !player?.sleeper_id}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {checkingAll && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  <Users aria-hidden="true" className="h-4 w-4" />
                  {checkingAll ? "Checking" : `All ${priceable.length} leagues`}
                </button>
              )}
            </div>
          </form>
        )}

        {/* Short on purpose: the detail is in the cards below. */}
        <p className="sr-only" role="status" aria-live="polite">
          {syncingLeague
            ? "Syncing this league from Sleeper. This takes a few seconds."
            : pricing || checkingAll
            ? "Working on it."
            : report
              ? `${report.headline}. Bid ${report.ladder.likely} FAAB, walk away above ${report.ladder.walkAway}.`
              : allRows
                ? `Checked ${allRows.length} leagues.`
                : ""}
        </p>

        {bidError && (
          <p role="alert" className="text-sm text-signal-danger">
            {bidError}
          </p>
        )}
        {allError && (
          <p role="alert" className="text-sm text-signal-danger">
            {allError}
          </p>
        )}

        {report && (
          <div id={`${ids}-result`} className="scroll-mt-24 space-y-3">
            <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-3 text-sm leading-relaxed text-ink-muted">
              {leagueModeNotice}
            </p>
            <BidResult view={viewFromLeagueReport(report)} />
          </div>
        )}

        {allRows && (
          <MultiLeagueList
            rows={allRows}
            notChecked={allNotChecked}
            playerName={player?.name ?? null}
          />
        )}
      </div>
    </section>
  );
}

/**
 * One player, every league.
 *
 * A list of stacked rows rather than a table, so nothing has to be dropped on a
 * phone. Every figure a desktop reader sees is present at every width.
 */
function MultiLeagueList({
  rows,
  notChecked,
  playerName,
}: {
  rows: MultiLeagueRow[];
  notChecked: number;
  playerName: string | null;
}) {
  return (
    <section
      aria-label={`${playerName ?? "This player"} across your leagues`}
      className="rounded-card border border-line bg-base/50 p-4"
    >
      <h3 className="text-sm font-semibold text-ink">
        {playerName ?? "This player"} across your leagues
      </h3>

      <ul role="list" className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <li key={row.sleeperLeagueId} className="rounded-card border border-line bg-surface/60 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-semibold text-ink">{row.leagueName}</p>
              {row.status === "ok" && row.report && (
                <p className="font-mono text-sm font-bold tabular-nums text-brand-cyan">
                  <span aria-hidden="true">
                    {row.report.ladder.likely} to {row.report.ladder.walkAway} FAAB
                  </span>
                  <span className="sr-only">
                    Bid {row.report.ladder.likely} FAAB, walk away above{" "}
                    {row.report.ladder.walkAway}.
                  </span>
                </p>
              )}
            </div>

            {row.status === "ok" && row.report ? (
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                {row.report.marginal?.isBenchOnly
                  ? "Does not crack your lineup here. Bench value only."
                  : `+${row.report.marginal?.netPointsPerWeek.toFixed(1) ?? "0.0"} a week, starts ${row.report.marginal?.weeksStarting ?? 0} of ${row.report.marginal?.weeksConsidered ?? 0} weeks.` +
                    (row.report.marginal?.playoffOddsBefore != null &&
                    row.report.marginal?.playoffOddsAfter != null
                      ? ` Playoff odds ${row.report.marginal.playoffOddsBefore.toFixed(0)}% to ${row.report.marginal.playoffOddsAfter.toFixed(0)}%.`
                      : "") +
                    ` ${row.report.market.yourBudget} FAAB left.`}
              </p>
            ) : row.status === "rostered" ? (
              <p className="mt-1 text-sm text-ink-muted">
                Already rostered{row.rosteredBy ? ` by ${row.rosteredBy}` : ""}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">{row.message}</p>
            )}
          </li>
        ))}
      </ul>

      {notChecked > 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          {notChecked} more league{notChecked === 1 ? "" : "s"} unchecked. Pricing is
          heavy, so we cap how many run at once. Do those one at a time above.
        </p>
      )}
    </section>
  );
}
