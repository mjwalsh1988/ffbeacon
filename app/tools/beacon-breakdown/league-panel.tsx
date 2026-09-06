"use client";

/**
 * The league connector.
 *
 * Two steps and no account needed: name a Sleeper handle, pick a league.
 * Picking one navigates to a URL carrying the league and the reader's roster,
 * so the whole comparison is recomputed server-side against their actual team
 * and the resulting link is shareable with a leaguemate.
 *
 * A reader who saved a handle in My Beacon does not see step one at all. The
 * collapsed "Connect a league" block is replaced by the identity card, the
 * lookup runs itself once on mount through the saved handle (D8: the league
 * list is the better answer and it should be waiting), and the form still
 * exists behind Change for the visit where they want a leaguemate's leagues
 * instead. That auto-run is ONE call, through the same server action and the
 * same rate-limit bucket a typed lookup uses (D7). Nothing bypasses anything.
 *
 * Leagues nobody has opened before have no stored rosters, so picking one syncs
 * it from Sleeper first and then applies it. That wait is said out loud on the
 * row being synced rather than left to look like a stuck button. A league the
 * reader turns out not to have a team in is still refused afterwards, with that
 * reason said out loud too: "we did not look" and "you are not in it" must not
 * look the same.
 *
 * WHY THE LIST IS A SELECTION AND NOT A ROW OF LINKS. `LeagueChoiceList` is a
 * real radiogroup, so arrow keys move between rows AND change the selection,
 * which is what makes it a better control than the `<select>` it replaces
 * elsewhere. Navigating on selection would therefore navigate on every arrow
 * press, and a keyboard reader could never reach the third league. So the row
 * is the choice and "Use this league" is the action. The FAAB and Signal Check
 * pickers were brought to the same shape for the same reason, so all three
 * read alike and none of them fires network work on an arrow press.
 * `applyLeague` itself is unchanged.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, X } from "lucide-react";
import {
  LeagueChoiceList,
  type LeagueChoice,
} from "@/components/league-choice-list";
import { LeagueLogo } from "@/components/league-logo";
import {
  SleeperHandleGate,
  gateRenderPlan,
} from "@/components/sleeper-handle/handle-gate";
import type { IdentityCardStatus } from "@/components/sleeper-handle/identity-card";
import { saveSleeperHandle } from "@/app/actions/sleeper-handle";
import type { HandleGateState } from "@/lib/sleeper-handle/types";
import {
  connectBreakdownLeagues,
  syncBreakdownLeague,
  type BreakdownLeague,
} from "./actions";

const TOOL_PATH = "/tools/beacon-breakdown";

export type ActiveLeague = {
  sleeperLeagueId: string;
  name: string;
  teamName: string;
  record: string;
  season: number;
  scoringDescription: string;
  /** Sleeper's league image id. Null for the many leagues that never set one. */
  avatar: string | null;
};

export function LeaguePanel({
  active,
  handleGate,
  defaultSeason,
  applyHrefBase,
  clearHref,
}: {
  /** Set when a league is already applied to this comparison. */
  active: ActiveLeague | null;
  /** Who this connector is acting for, resolved server-side. */
  handleGate: HandleGateState;
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
  const plan = gateRenderPlan(handleGate);
  /** True for the two states that carry a saved handle: card, no visible form. */
  const savedMode = plan.card;

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState(defaultSeason);
  // Unticked when a handle is already saved, ticked for a signed-in reader who
  // has none. The usual reason to open this form when you already have one
  // saved is a one-off look at somebody else's leagues (D5).
  const [saveHandle, setSaveHandle] = useState(plan.saveByDefault);
  const [leagues, setLeagues] = useState<BreakdownLeague[] | null>(null);
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>("");
  /** The league currently being pulled from Sleeper, so only its row spins. */
  const [syncingLeagueId, setSyncingLeagueId] = useState<string | null>(null);
  /** The lookup failed. In saved mode this is what opens the form. */
  const [connectError, setConnectError] = useState<string | null>(null);
  /**
   * True when the last failure was the rate limit and nothing else.
   *
   * D7: a 429 on an AUTO-RUN is a Retry on the card, never a reason to drop
   * the reader into a username form and ask them to retype a handle that is
   * perfectly good. Without a reason to branch on, every failure looked the
   * same and the card force-opened the form for all of them.
   */
  const [connectThrottled, setConnectThrottled] = useState(false);
  /** Applying a league failed. Never a reason to reopen the username form. */
  const [pickError, setPickError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [connecting, setConnecting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  /**
   * True only when the reader pressed something to get this list.
   *
   * The auto-run happens on page load, and moving focus into a list nobody
   * asked for takes a reader out of whatever they were reading and drops them
   * halfway down the page. The card's status region says the leagues arrived
   * instead, which is an announcement rather than a relocation.
   */
  const shiftFocusRef = useRef(false);

  // Move focus to the results once they arrive so a screen reader lands on the
  // list it just asked for rather than staying on the submit button.
  useEffect(() => {
    if (!shiftFocusRef.current) return;
    if (leagues && leagues.length > 0) {
      shiftFocusRef.current = false;
      listRef.current?.focus();
    }
  }, [leagues]);

  const runConnect = useCallback(
    async (
      input: { username: string } | { saved: true },
      forSeason: string,
    ) => {
      setConnectError(null);
      setConnectThrottled(false);
      setPickError(null);
      setLeagues(null);
      setPicked("");
      setConnecting(true);
      try {
        const result = await connectBreakdownLeagues(
          "saved" in input
            ? { saved: true, season: forSeason }
            : { username: input.username, season: forSeason },
        );
        if (!result.ok) {
          setConnectError(result.error);
          setConnectThrottled(result.reason === "rate-limited");
          return;
        }
        setSleeperUserId(result.sleeperUserId);
        setLeagues(result.leagues);
      } catch {
        setConnectError(
          "Something went wrong reaching Sleeper. Try again in a moment.",
        );
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  // The auto-run. Once per mount, which the ref is what guarantees: React
  // mounts an effect twice in development strict mode, and two runs would spend
  // two of the reader's ten lookups a minute to learn the same thing.
  const autoRanRef = useRef(false);
  useEffect(() => {
    // `active` means a league is already applied and the early return below
    // renders that instead, so the list this would build is never shown. It
    // was spending a Sleeper call and a rate-limit slot per page load for it.
    if (!savedMode || active || autoRanRef.current) return;
    autoRanRef.current = true;
    void runConnect({ saved: true }, season);
  }, [savedMode, active, season, runConnect]);

  async function onConnect(event: React.FormEvent) {
    event.preventDefault();
    shiftFocusRef.current = true;
    const typed = username.trim();

    // Saving first, so the handle we look up and the handle we stored are the
    // same one. A refused save (Sleeper does not know it) stops the lookup too,
    // because the lookup was going to fail on the same handle.
    if (saveHandle && handleGate.kind !== "guest") {
      const saved = await saveSleeperHandle({ username: typed });
      if (!saved.ok) {
        setConnectError(saved.error);
        return;
      }
    }

    await runConnect({ username: typed }, season);
  }

  const retry = useCallback(() => {
    shiftFocusRef.current = true;
    void runConnect({ saved: true }, season);
  }, [runConnect, season]);

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
   * Apply the picked league. One that has never been read is pulled from
   * Sleeper first, which is the same work opening it in League Pulse would have
   * done, and then applied without the reader having to press it again.
   */
  async function applyLeague(league: BreakdownLeague) {
    setPickError(null);

    if (league.rosterId != null) {
      navigateTo(league, league.rosterId);
      return;
    }

    if (!sleeperUserId) {
      setPickError("Find your leagues again, then pick this one.");
      return;
    }

    setSyncingLeagueId(league.sleeperLeagueId);
    try {
      const result = await syncBreakdownLeague({
        sleeperLeagueId: league.sleeperLeagueId,
        sleeperUserId,
      });
      if (!result.ok) {
        setPickError(result.error);
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
        setPickError(
          `Sleeper gave us no rosters for ${league.name}, so there is nothing to compare against.`,
        );
        return;
      }
      if (result.rosterId == null) {
        setPickError(
          `We read ${league.name} but could not find your team in it.`,
        );
        return;
      }
      navigateTo(league, result.rosterId);
    } catch {
      setPickError(
        "Something went wrong reaching Sleeper. Try again in a moment.",
      );
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
          <div className="flex min-w-0 items-start gap-3">
            <LeagueLogo avatarId={active.avatar} name={active.name} size={40} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                <Users aria-hidden="true" className="h-3.5 w-3.5" />
                Comparing for your team
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {active.teamName}
                <span className="font-normal text-ink-muted">
                  {" "}
                  ({active.record})
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {active.name}, {active.season}. Scored as{" "}
                {active.scoringDescription}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => startTransition(() => router.push(clearHref))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:border-brand-cyan/50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {pending ? (
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin"
              />
            ) : (
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            Use the general comparison
          </button>
        </div>
      </section>
    );
  }

  const pickedLeague =
    leagues?.find((l) => l.sleeperLeagueId === picked) ?? null;
  const busy = connecting || pending || syncingLeagueId !== null;

  const choices: LeagueChoice[] = (leagues ?? []).map((league) => {
    const noTeam = league.synced && league.rosterId == null;
    const syncing = syncingLeagueId === league.sleeperLeagueId;
    const size = league.teams ? `${league.teams} teams` : "Sleeper league";
    return {
      sleeperLeagueId: league.sleeperLeagueId,
      name: league.name,
      avatar: league.avatar,
      meta: league.synced ? size : `${size}, we read this one when you pick it`,
      // Only a league we read and found no team in is a dead end. One nobody
      // has read yet is not: picking it reads it.
      disabledReason: noTeam ? "We could not find your team in it" : null,
      busyLabel: syncing ? "Reading it from Sleeper now" : null,
      categoryKey: league.categoryKey,
    };
  });

  // In saved mode the card is a status line and the leagues are the page, so
  // the gaps around it close right up. The guest disclosure keeps its own
  // breathing room: there the form IS what the reader came to use.
  const resultsGap = savedMode ? "mt-2" : "mt-4";

  const connectForm = (
    <form onSubmit={onConnect} className="flex flex-wrap items-end gap-3">
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
        {connecting && (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        )}
        {connecting ? "Finding leagues" : "Find my leagues"}
      </button>

      {/* Nothing to save into while signed out, so the notice under this form
          carries the sign-in link instead. */}
      {handleGate.kind !== "guest" && (
        <label
          htmlFor={`${baseId}-save`}
          className="flex min-h-11 w-full items-center gap-2 text-xs text-ink-muted"
        >
          <input
            id={`${baseId}-save`}
            name="save"
            type="checkbox"
            checked={saveHandle}
            onChange={(e) => setSaveHandle(e.target.checked)}
            className="h-4 w-4 rounded border-line bg-base text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          Save this as my Sleeper username
        </label>
      )}
    </form>
  );

  const results = (
    <>
      {pickError && (
        <p
          role="alert"
          className={`${resultsGap} rounded-card border border-signal-warning/40 bg-signal-warning/5 px-3 py-2 text-sm text-ink`}
        >
          {pickError}
        </p>
      )}

      {leagues && leagues.length > 0 && (
        <div
          ref={listRef}
          tabIndex={-1}
          className={`${resultsGap} focus-visible:outline-none`}
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            Your {season} leagues
          </h4>
          <LeagueChoiceList
            label={`Your ${season} leagues`}
            choices={choices}
            value={picked}
            onChange={setPicked}
            logoSize={40}
            className="mt-2"
          />
          <button
            type="button"
            disabled={!pickedLeague || busy}
            onClick={() => {
              if (pickedLeague) void applyLeague(pickedLeague);
            }}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {syncingLeagueId !== null && (
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin"
              />
            )}
            {pickedLeague && !pickedLeague.synced
              ? "Sync and use this league"
              : "Use this league"}
          </button>
        </div>
      )}
    </>
  );

  if (savedMode) {
    // The card IS the collapsed block here, so there is no dashed "Connect a
    // league" box around it and no second heading above it.
    let status: IdentityCardStatus = "idle";
    let statusMessage: string | null = null;
    if (syncingLeagueId !== null) {
      statusMessage =
        "Reading that league from Sleeper. This takes a few seconds.";
    } else if (connecting) {
      status = "loading";
      statusMessage = "Loading your leagues.";
    } else if (connectError && connectThrottled) {
      // The one failure that is not about the reader's handle. The card stays,
      // the form stays closed, and Retry re-runs the same lookup.
      status = "throttled";
      statusMessage = connectError;
    } else if (connectError) {
      // "failed" opens the form on its own, which is the right move for every
      // OTHER way this call can fail: a handle Sleeper no longer knows, a
      // season with nothing in it, and a reader who wants a leaguemate's
      // leagues instead all end at the same box.
      status = "failed";
      statusMessage = connectError;
    } else if (leagues) {
      statusMessage = `Loaded ${leagues.length} ${leagues.length === 1 ? "league" : "leagues"}.`;
    }

    return (
      <div className="space-y-2">
        <SleeperHandleGate
          state={handleGate}
          toolName="the Beacon Breakdown"
          nextPath={TOOL_PATH}
          headingLevel={3}
          status={status}
          statusMessage={statusMessage}
          onRetry={retry}
          compact
          renderForm={() => connectForm}
        />
        {results}
      </div>
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
            Connect a Sleeper league and we will score both players under your
            league&apos;s own rules, then work out how many points each one
            really adds to your starting lineup.
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

      <div id={`${baseId}-form`}>
        {open && (
          <>
            {/* The gate renders the form and, under it, the one sentence about
                saving a username: the sign-in link for a guest, the checkbox
                above for a signed-in reader who has saved nothing. */}
            <SleeperHandleGate
              state={handleGate}
              toolName="the Beacon Breakdown"
              nextPath={TOOL_PATH}
              headingLevel={3}
              renderForm={() => connectForm}
              className="mt-4"
            />

            <p aria-live="polite" className="sr-only">
              {connecting ? "Looking up your leagues." : ""}
              {leagues && !connecting ? `Found ${leagues.length} leagues.` : ""}
              {syncingLeagueId
                ? " Reading that league from Sleeper. This takes a few seconds."
                : ""}
            </p>

            {connectError && (
              <p
                role="alert"
                className="mt-3 rounded-card border border-signal-warning/40 bg-signal-warning/5 px-3 py-2 text-sm text-ink"
              >
                {connectError}
              </p>
            )}

            {results}
          </>
        )}
      </div>
    </section>
  );
}
