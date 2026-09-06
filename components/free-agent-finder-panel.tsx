"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  CircleCheck,
  CircleSlash,
  Info,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { LeagueLogo } from "@/components/league-logo";
import { searchFreeAgent } from "@/app/my-beacon/sleeper-leagues/free-agent-actions";
import {
  ROSTER_SLOT_LABEL,
  type FreeAgentLeague,
  type FreeAgentReport,
} from "@/lib/free-agent-finder";
import type { SearchablePlayer } from "@/lib/ranking-boards";

/**
 * Is this player available in any of my leagues?
 *
 * Pick a player, get one answer per league. The leagues where the answer is yes
 * come first, because they are the only rows anybody opened this for; the rest
 * are underneath so the reader can see the question WAS asked of them, which is
 * the difference between "he is taken there" and "we did not look".
 *
 * SEARCHES SYNCED LEAGUES ONLY, AND SYNCS NOTHING. Availability is decided by
 * the absence of a player from a league's stored rosters, so a league we hold no
 * rosters for cannot be answered at all: with nothing to be absent from,
 * everyone would read as free. Those leagues are counted and named as
 * unanswered, never folded in with the real yeses. The notice above the form
 * says how many are in that state before a search is run, not after.
 */
export function FreeAgentFinderPanel({
  open,
  onClose,
  sleeperLeagueIds,
  sleeperUserId,
  syncedLeagueCount,
  sleeperUsername,
}: {
  open: boolean;
  onClose: () => void;
  /** Every league Sleeper reports for this reader, synced or not. */
  sleeperLeagueIds: string[];
  /** The reader's own Sleeper id, so their own roster reads as theirs. */
  sleeperUserId: string | null;
  /** Of those leagues, how many we hold rosters for. */
  syncedLeagueCount: number;
  /** Forwarded on the league links so a deep view lands on this roster. */
  sleeperUsername: string | null;
}) {
  const [player, setPlayer] = useState<SearchablePlayer | null>(null);
  const [report, setReport] = useState<FreeAgentReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalLeagues = sleeperLeagueIds.length;

  async function runSearch(next: SearchablePlayer) {
    setPlayer(next);
    setReport(null);
    setError(null);

    // Without a Sleeper id there is nothing to match against a roster, and
    // guessing by name would put a wrong answer under a confident heading.
    if (!next.sleeperId) {
      setError(
        `We do not have a Sleeper id for ${next.name}, so we cannot check him against your rosters.`,
      );
      return;
    }

    setPending(true);
    try {
      const result = await searchFreeAgent({
        sleeperPlayerId: next.sleeperId,
        sleeperLeagueIds,
        sleeperUserId,
      });
      if (result.ok) setReport(result.report);
      else setError(result.error);
    } catch {
      setError("The search did not go through. Try that again.");
    } finally {
      setPending(false);
    }
  }

  function clearPlayer() {
    setPlayer(null);
    setReport(null);
    setError(null);
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="lg"
      title="Free Agent Finder"
      subtitle={
        syncedLeagueCount > 0
          ? `Searching ${syncedLeagueCount} synced ${syncedLeagueCount === 1 ? "league" : "leagues"}`
          : "No synced leagues yet"
      }
    >
      <SyncNotice synced={syncedLeagueCount} total={totalLeagues} />

      {syncedLeagueCount === 0 ? (
        <EmptyState />
      ) : (
        <>
          <PlayerCombobox onSelect={runSearch} />

          {player && <SelectedPlayer player={player} onClear={clearPlayer} />}

          {/* The live region holds the ONE-LINE answer and nothing else. An
              earlier pass wrapped the whole result area, which meant selecting a
              player announced all twenty-eight league rows in one breath before
              the reader could get a word in. The summary is the answer; the list
              below it is where you go to act on it. */}
          <div
            role="status"
            aria-live="polite"
            aria-busy={pending}
            className="mt-4"
          >
            {pending ? (
              <p className="rounded-card border border-line bg-base/50 px-4 py-3 text-sm text-ink-muted">
                Checking every synced league for {player?.name}...
              </p>
            ) : error ? (
              <p className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-signal-danger">
                {error}
              </p>
            ) : report && player ? (
              <ReportSummary report={report} playerName={player.name} />
            ) : null}
          </div>

          {!pending && !error && report && player && (
            <ReportList
              report={report}
              playerName={player.name}
              sleeperUsername={sleeperUsername}
            />
          )}
        </>
      )}
    </SidePanel>
  );
}

/* ---------- notice ---------- */

/**
 * What this search can and cannot see, before it is run.
 *
 * Above the form on purpose. A caveat under an answer is an excuse; the same
 * sentence above the question is a scope, and it is the only thing standing
 * between a reader and the assumption that "no results" means "nobody has him".
 */
function SyncNotice({ synced, total }: { synced: number; total: number }) {
  const missing = Math.max(0, total - synced);
  return (
    <div
      role="note"
      className="mb-5 flex items-start gap-3 rounded-card border border-brand-cyan/35 bg-brand-cyan/5 px-4 py-3.5"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
      >
        <Info className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">
          This searches your synced leagues only.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          <span className="font-mono font-semibold tabular-nums text-brand-cyan">
            {synced} of {total}
          </span>{" "}
          {total === 1 ? "league is" : "leagues are"} synced right now.
          {missing > 0 ? (
            <>
              {" "}
              The other {missing} {missing === 1 ? "one has" : "ones have"} no
              rosters stored, so this cannot say who is on them. Press Sync all,
              or open a league, and it joins the next search.
            </>
          ) : (
            " Every league you are in can be answered."
          )}{" "}
          Nothing on this panel starts a sync.
        </p>
      </div>
    </div>
  );
}

/* ---------- combobox ---------- */

const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;
const MIN_QUERY = 2;

/**
 * Player search, same ARIA combobox pattern the rest of the site uses.
 *
 * Backed by /api/players/search, which is signed-in only and already filters to
 * currently-ranked fantasy players. That filter matters here: a search that
 * offered every one of Sleeper's eight thousand active names would keep
 * returning long-retired players who are, technically and uselessly, free
 * agents in all twelve of your leagues.
 */
function PlayerCombobox({
  onSelect,
}: {
  onSelect: (player: SearchablePlayer) => void;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const statusId = useId();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchablePlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_QUERY;

  useEffect(() => {
    if (!longEnough) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "20" });
        const res = await fetch(`/api/players/search?${params.toString()}`, {
          headers: FETCH_HEADERS,
        });
        const data = (await res.json()) as { players?: SearchablePlayer[] };
        if (!cancelled) {
          setResults(data.players ?? []);
          setActiveIdx(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, longEnough]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function commit(result: SearchablePlayer) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && results[activeIdx]) {
        event.preventDefault();
        commit(results[activeIdx]);
      }
    } else if (event.key === "Escape") {
      // Only when the list is open, so Escape still closes the panel itself
      // once there is nothing here to close.
      if (open) {
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  const showList = open && longEnough;
  const statusText = !longEnough
    ? ""
    : loading
      ? "Searching"
      : `${results.length} ${results.length === 1 ? "player" : "players"}`;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
        Search for a player
      </label>
      <div className="relative mt-2">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={
            showList && results[activeIdx]
              ? `${listboxId}-opt-${activeIdx}`
              : undefined
          }
          aria-describedby={`${helpId} ${statusId}`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Start typing a player name..."
          className="min-h-11 w-full rounded-card border border-line bg-base py-2 pl-9 pr-3 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm"
        />
      </div>
      <p id={helpId} className="mt-1.5 text-[11px] text-ink-subtle">
        Type at least {MIN_QUERY} characters, then pick a player from the list
        to check him against every synced league.
      </p>
      <p id={statusId} aria-live="polite" className="sr-only">
        {statusText}
      </p>

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface shadow-2xl shadow-black/50"
        >
          {loading ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">Searching...</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">
              No matches for &quot;{trimmed}&quot;.
            </li>
          ) : (
            results.map((p, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={p.playerId}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(p);
                  }}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {[p.position, p.team].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

/* ---------- selected player ---------- */

function SelectedPlayer({
  player,
  onClear,
}: {
  player: SearchablePlayer;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-card border border-line-accent bg-surface px-3 py-2.5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-beacon text-black"
      >
        <UserRound className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <Link
          href={`/players/${player.slug}`}
          className="block truncate text-sm font-bold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {player.name}
        </Link>
        <span className="block truncate text-[11px] text-ink-subtle">
          {[player.position, player.team].filter(Boolean).join(", ") ||
            "Position unknown"}
        </span>
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${player.name} and search for someone else`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ---------- report ---------- */

/** The answer in one sentence. This is what the live region announces. */
function ReportSummary({
  report,
  playerName,
}: {
  report: FreeAgentReport;
  playerName: string;
}) {
  const { leagues, freeCount, rosteredCount } = report;

  if (leagues.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-4 text-sm leading-relaxed text-ink-muted">
        We could not read your rosters just now, so there is no answer to give.
        Close this and open it again, and if it keeps happening the leagues
        probably need a sync.
      </p>
    );
  }

  return (
    <p className="text-sm leading-relaxed text-ink">
      <span className="font-bold">{playerName}</span> is a free agent in{" "}
      <span className="font-mono font-bold tabular-nums text-signal-success">
        {freeCount}
      </span>{" "}
      of your {leagues.length} searched{" "}
      {leagues.length === 1 ? "league" : "leagues"}, and rostered in{" "}
      <span className="font-mono font-bold tabular-nums text-ink">
        {rosteredCount}
      </span>
      .
    </p>
  );
}

/** Every searched league, free agents first, plus what could not be searched. */
function ReportList({
  report,
  playerName,
  sleeperUsername,
}: {
  report: FreeAgentReport;
  playerName: string;
  sleeperUsername: string | null;
}) {
  const { leagues, unsyncedCount } = report;
  if (leagues.length === 0) return null;

  return (
    <>
      <ul
        role="list"
        aria-label={`Your leagues, and whether ${playerName} is a free agent in each. Free agents first.`}
        className="mt-3 space-y-2"
      >
        {leagues.map((league) => (
          <LeagueRow
            key={league.sleeperLeagueId}
            league={league}
            playerName={playerName}
            sleeperUsername={sleeperUsername}
          />
        ))}
      </ul>

      {unsyncedCount > 0 && (
        <p className="mt-4 rounded-card border border-line bg-base/50 px-3 py-2 text-xs leading-relaxed text-ink-muted">
          {unsyncedCount} more {unsyncedCount === 1 ? "league" : "leagues"}{" "}
          could not be searched, because we hold no rosters for{" "}
          {unsyncedCount === 1 ? "it" : "them"} yet. {playerName} may or may not
          be available there.
        </p>
      )}
    </>
  );
}

/**
 * One league's answer.
 *
 * Shape, then fill, then colour, so the state never rests on hue alone: a free
 * agent is a filled check in a green well, a rostered player is a barred circle
 * in a plain one, and both carry the words. The words are what a screen reader
 * gets; the icons are aria-hidden because they say the same thing twice.
 *
 * The league logo leads the row and says nothing: it is decorative, the league
 * name is right beside it, and the link's aria-label is unchanged. It renders
 * at every width; the gap tightens on a phone rather than the logo dropping.
 */
function LeagueRow({
  league,
  playerName,
  sleeperUsername,
}: {
  league: FreeAgentLeague;
  playerName: string;
  sleeperUsername: string | null;
}) {
  const params = new URLSearchParams();
  if (sleeperUsername) params.set("username", sleeperUsername);
  params.set("name", league.leagueName);
  const href = `/leagues/${league.sleeperLeagueId}?${params.toString()}`;

  const holder = league.isYours
    ? "on your team"
    : league.rosteredBy
      ? `on ${league.rosteredBy}'s team`
      : "on another team";
  const detail = league.isFreeAgent
    ? "Free agent"
    : `Rostered, ${holder}${league.slot ? `, ${ROSTER_SLOT_LABEL[league.slot].toLowerCase()}` : ""}`;

  return (
    <li>
      <Link
        href={href}
        aria-label={`${league.leagueName}. ${playerName} is ${league.isFreeAgent ? "a free agent here" : detail.toLowerCase()}. Open this league.`}
        className={`flex items-center gap-2.5 rounded-card border px-3 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:gap-3 ${
          league.isFreeAgent
            ? "border-signal-success/45 bg-signal-success/10 hover:border-signal-success/80"
            : "border-line bg-base/40 hover:border-line-accent hover:bg-surface"
        }`}
      >
        <LeagueLogo
          avatarId={league.avatar}
          name={league.leagueName}
          size={32}
        />
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
            league.isFreeAgent
              ? "border-signal-success/50 bg-signal-success/15 text-signal-success"
              : "border-line-accent bg-surface text-ink-subtle"
          }`}
        >
          {league.isFreeAgent ? (
            <CircleCheck className="h-4 w-4" />
          ) : (
            <CircleSlash className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {league.leagueName}
          </span>
          <span
            className={`mt-0.5 block truncate text-[11px] ${
              league.isFreeAgent
                ? "font-semibold text-signal-success"
                : "text-ink-subtle"
            }`}
          >
            {detail}
          </span>
        </span>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
      <p className="text-sm font-semibold text-ink">Nothing to search yet.</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        Availability is worked out from the rosters we have already stored, so a
        league has to be synced before it can be searched. Press Sync all, or
        open a league, and it shows up here. Nothing on this panel starts a sync
        on its own.
      </p>
    </div>
  );
}
