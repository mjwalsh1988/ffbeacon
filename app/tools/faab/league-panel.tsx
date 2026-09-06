"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
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
import { saveSleeperHandle } from "@/app/actions/sleeper-handle";
import { SleeperHandleGate } from "@/components/sleeper-handle/handle-gate";
import type { IdentityCardStatus } from "@/components/sleeper-handle/identity-card";
import {
  LeagueChoiceList,
  type LeagueChoice,
} from "@/components/league-choice-list";
import {
  gateViewer,
  type HandleGateState,
  type SleeperViewer,
} from "@/lib/sleeper-handle/types";
import { useStepScroll } from "@/lib/use-step-scroll";
import { BidResult, viewFromLeagueReport } from "./bid-result";
import { PlayerCombobox, type FaabPlayer } from "./player-combobox";
import type {
  LeagueFaabReport,
  MultiLeagueRow,
  NeedLevel,
} from "@/lib/faab/types";
import { LOOKUP_THROTTLED_MESSAGE } from "@/lib/on-the-clock/lookup-failure";

/**
 * The connected-league path, and the first thing on the page.
 *
 * It leads rather than hides because it is the better answer: a bid measured
 * against the reader's actual roster beats one measured against a generic
 * league every time. The manual calculator sits underneath it behind an "or",
 * so nobody is forced through this to get a number.
 *
 * No sign-in. A Sleeper username is enough, the same way League Pulse works.
 * A reader who has one saved skips typing it: the panel opens on their leagues
 * instead of on a text field.
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
   * Who this panel is acting for, resolved on the server.
   *
   * This panel used to take a prefilled username and deliberately NOT submit
   * it, so a reader who came for the manual calculator was never charged a
   * league lookup they had not asked for. That reasoning still holds for a
   * guest and for a signed-in reader with nothing saved: both still press the
   * button themselves, and nothing runs until they do.
   *
   * It does not hold for a reader whose handle we already have. For them the
   * league list is the better answer and it should be waiting when the page
   * paints, so the saved states auto-run one lookup on mount (D8). The lookup
   * goes through the same `faab_connect` bucket as the button does.
   */
  gate: HandleGateState;
  /** The URL-first viewer, for the two gate states that carry none. */
  urlViewer: SleeperViewer | null;
  /** Format and ranking source the free-agent list is read against. */
  formatSlug: string;
  sourceSlug: string | null;
};

/** Who a lookup should run for, decided by the gate rather than by a form. */
type LookupSubject = { saved: true } | { username: string };

export function LeaguePanel({
  formatName,
  needLevel,
  fallbackBudget,
  leagueModeNotice,
  seasons,
  gate,
  urlViewer,
  formatSlug,
  sourceSlug,
}: Props) {
  const ids = useId();
  const router = useRouter();
  // Prefilled with whoever the page is acting for, empty for a guest. The
  // reader who opens this form to change the SEASON should not have to retype
  // a handle the card is already showing them, and one who opens it to look up
  // a leaguemate types over it.
  // `gateViewer` is null for a guest and for a signed-in reader with nothing
  // saved, so a shared `?username=` link would prefill nothing for exactly the
  // readers most likely to be following one. `urlViewer` is the page's own
  // URL-first answer and covers those two states.
  const actingViewer = gateViewer(gate) ?? urlViewer;
  const [username, setUsername] = useState(actingViewer?.username ?? "");
  const [season, setSeason] = useState(seasons[0] ?? "");
  // Mirrors `gateRenderPlan`: ticked for a reader who has saved nothing and is
  // about to type their own handle, unticked when a handle already exists,
  // because the usual reason to reopen the form is a one-off look at somebody
  // else's leagues (D5).
  const [saveHandle, setSaveHandle] = useState(gate.kind === "member-unsaved");

  const [connecting, startConnecting] = useTransition();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  /** The handle the loaded list actually belongs to, as the server resolved it. */
  const [actingUsername, setActingUsername] = useState<string | null>(null);
  /** True once a lookup the reader pressed has run. Gates the step scroll. */
  const [lookupWasPressed, setLookupWasPressed] = useState(false);
  const [cardStatus, setCardStatus] = useState<IdentityCardStatus>("idle");
  const [cardMessage, setCardMessage] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<ConnectedLeague[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");
  /**
   * The league whose free agents are actually loaded, which is deliberately
   * NOT the highlighted one.
   *
   * `LeagueChoiceList` is a real radiogroup, so arrow keys move between rows
   * AND change the selection. The effect below syncs an unsynced league from
   * Sleeper and then claims a `faab_free_agents` rate-limit slot, so keying it
   * on the highlighted row meant a keyboard reader arrowing to the fifth
   * league had started four Sleeper syncs and spent four of their thirty
   * slots, and could lock themselves out of their own tool. A mouse user never
   * saw it, and the `<select>` this replaced never had the problem, because a
   * platform picker commits on Enter.
   *
   * So the row is the choice and "Use this league" is the action, the same
   * shape the Beacon Breakdown and Signal Check pickers use.
   */
  const [committedLeagueId, setCommittedLeagueId] = useState<string>("");

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
  // The COMMITTED league, not the highlighted one. Everything downstream of
  // this (the free agent list, the bid priced against a roster) belongs to the
  // league that was actually loaded. Pricing against a row the reader has
  // merely arrowed onto would price one league's player against another
  // league's roster.
  const selected =
    leagues.find((l) => l.sleeperLeagueId === committedLeagueId) ?? null;
  const priceable = leagues.filter((l) => l.synced && l.rosterId !== null);

  // `meta` carries exactly what the old select rendered in parentheses, so no
  // reader loses a word by the control changing shape. It sits inside the
  // label, so it is announced with the league rather than after it.
  const leagueChoices: LeagueChoice[] = leagues.map((l) => ({
    sleeperLeagueId: l.sleeperLeagueId,
    name: l.name,
    avatar: l.avatar,
    meta:
      l.synced && l.rosterId !== null
        ? l.remainingBudget !== null
          ? `${l.remainingBudget} FAAB left`
          : null
        : "Syncs when picked",
    busyLabel:
      syncingLeague && l.sleeperLeagueId === committedLeagueId
        ? "Reading this league from Sleeper."
        : null,
  }));

  // Both of these answer a question the reader just asked, so both land on the
  // answer rather than the top of the page. The lookup reveals the league and
  // player step below the username form; a bid reveals the number underneath
  // that. Neither changes the URL, so nothing moves the page on its own, and
  // on a phone the new block can open entirely below the fold. Going back to
  // disconnected or clearing a result passes null and moves nobody.
  //
  // The auto-run is the exception, and it has to be. A list that arrives
  // because the reader pressed a button is an answer they asked for; the same
  // list arriving on page load is not, and moving scroll and focus onto it
  // would take the page away from someone who came for the manual calculator
  // and never touched a control.
  useStepScroll(connected && lookupWasPressed ? "connected" : null, {
    id: `${ids}-league-step`,
  });
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
  // The handle the list belongs to, for the one message that names it. It comes
  // from the resolved viewer rather than the username field, because on the
  // saved states that field is not on screen at all.
  const actingUsernameRef = useRef(actingUsername);
  actingUsernameRef.current = actingUsername;

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
    if (!committedLeagueId || !sourceSlug) return;

    // Guards the reader who changes their mind mid-sync: a slow answer for a
    // league they have already moved on from must not overwrite the new one.
    let current = true;

    const picked = leaguesRef.current.find(
      (l) => l.sleeperLeagueId === committedLeagueId,
    );
    const needsSync = Boolean(
      picked && (!picked.synced || picked.rosterId === null),
    );
    const userId = sleeperUserIdRef.current;

    startLoadingAgents(async () => {
      if (needsSync && userId) {
        setSyncingLeague(true);
        const synced = await syncConnectedLeague({
          sleeperLeagueId: committedLeagueId,
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
            l.sleeperLeagueId === committedLeagueId
              ? { ...l, ...synced.patch }
              : l,
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
            `We synced that league but could not find a team owned by ${actingUsernameRef.current ?? "you"} in it.`,
          );
          return;
        }
      }

      const result = await fetchLeagueFreeAgents({
        sleeperLeagueId: committedLeagueId,
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
    // `leagues`, `sleeperUserId` and the acting handle all come through refs
    // above, so none of them belongs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedLeagueId, formatSlug, sourceSlug]);

  // Any lookup at all, auto-run or pressed, counts as the auto-run having
  // happened. Without this a save that refreshes the page into the saved state
  // would immediately spend a second lookup on the list already on screen.
  const autoRanRef = useRef(false);

  /**
   * One lookup.
   *
   * `announce` is true only for the auto-run and its Retry, because the
   * identity card's status region is the auto-run's line. A lookup the reader
   * pressed reports through the error text beside the form they pressed it in,
   * and saying the same thing twice is worse than saying it once.
   */
  const performLookup = useCallback(
    async (who: LookupSubject, announce: boolean) => {
      autoRanRef.current = true;
      const result = await connectSleeperLeagues(
        "saved" in who
          ? { saved: true, season }
          : { username: who.username, season },
      );

      if (!result.ok) {
        setLeagues([]);
        setSleeperUserId(null);
        setActingUsername(null);
        setSelectedLeagueId("");
        setCommittedLeagueId("");
        if (announce) {
          const throttled = result.reason === "rate-limited";
          setCardStatus(throttled ? "throttled" : "failed");
          setCardMessage(throttled ? LOOKUP_THROTTLED_MESSAGE : result.error);
        } else {
          setCardStatus("idle");
          setCardMessage(null);
          setConnectError(result.error);
        }
        return;
      }

      setSleeperUserId(result.sleeperUserId);
      setActingUsername(result.username);
      setLeagues(result.leagues);
      setCardStatus("idle");
      setCardMessage(
        `Loaded ${result.leagues.length} league${result.leagues.length === 1 ? "" : "s"}.`,
      );
      const first = result.leagues.find((l) => l.synced && l.rosterId !== null);
      setSelectedLeagueId(first?.sleeperLeagueId ?? "");
      // A reader with exactly one league is not making a choice, and no arrow
      // key was involved, so the hazard the two-step exists for cannot apply.
      // Any more than that and they pick, then press.
      setCommittedLeagueId(
        result.leagues.length === 1 ? (first?.sleeperLeagueId ?? "") : "",
      );
    },
    [season],
  );

  const startLookup = useCallback(
    (who: LookupSubject, announce: boolean) => {
      setConnectError(null);
      // `announce` is exactly the auto-run, so its negation is exactly the
      // lookups a reader pressed.
      if (!announce) setLookupWasPressed(true);
      if (announce) {
        setCardStatus("loading");
        setCardMessage("Loading your leagues.");
      }
      startConnecting(async () => {
        await performLookup(who, announce);
      });
    },
    [performLookup],
  );

  /**
   * The form's own submit: look this handle up, and save it first if the
   * reader asked us to.
   *
   * Saving before looking up is deliberate. The save resolves the handle on
   * Sleeper and stores the user id, so the lookup that follows runs off the
   * saved identity and costs one Sleeper call rather than two.
   */
  const submitForm = useCallback(() => {
    const typed = username.trim();
    if (typed.length === 0) return;
    setConnectError(null);
    setLookupWasPressed(true);
    startConnecting(async () => {
      if (saveHandle) {
        const saved = await saveSleeperHandle({ username: typed });
        if (!saved.ok) {
          setConnectError(saved.error);
          return;
        }
        await performLookup({ saved: true }, false);
        // The gate is resolved on the server, so the identity card only
        // appears once this page re-reads it.
        router.refresh();
        return;
      }
      await performLookup({ username: typed }, false);
    });
  }, [username, saveHandle, performLookup, router]);

  /** The handle the auto-run belongs to, or null when there is nothing to run. */
  const autoSubject = useMemo<LookupSubject | null>(() => {
    if (gate.kind === "member-saved") return { saved: true };
    if (gate.kind === "member-overridden")
      return { username: gate.viewer.username };
    return null;
  }, [gate]);

  // D8. Runs once, and the ref is what makes that true under React's
  // development double-invocation as well as under a router refresh.
  useEffect(() => {
    if (autoRanRef.current || !autoSubject) return;
    autoRanRef.current = true;
    startLookup(autoSubject, true);
  }, [autoSubject, startLookup]);

  const retryAutoLookup = useCallback(() => {
    if (!autoSubject) return;
    startLookup(autoSubject, true);
  }, [autoSubject, startLookup]);

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
        {/* Step 1: who are you.
            The gate decides whether that is a question at all. A reader with a
            saved handle gets the identity card and their leagues; everyone else
            gets the form below, unchanged.
            Width is capped on purpose: the panel spans whatever the page gives
            it, but a username box and a season select have a natural size and
            the extra width would all land in the text field. */}
        <SleeperHandleGate
          state={gate}
          toolName="the FAAB Calculator"
          nextPath="/tools/faab"
          headingLevel={3}
          status={cardStatus}
          statusMessage={cardMessage}
          onRetry={retryAutoLookup}
          clearHref="/tools/faab"
          className="max-w-3xl"
          renderForm={() => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitForm();
              }}
              className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
            >
              <div>
                <label
                  htmlFor={`${ids}-username`}
                  className="block text-sm font-medium text-ink"
                >
                  Sleeper username
                </label>
                <input
                  id={`${ids}-username`}
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-describedby={
                    connectError ? `${ids}-connect-error` : undefined
                  }
                  aria-invalid={connectError ? true : undefined}
                  className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                />
              </div>
              {/* The season lives with the form wherever the form is: inline
                  for a reader who is typing a handle, and inside the card's
                  disclosure for one who is not, because the auto-run has
                  already answered for the current season. */}
              <div>
                <label
                  htmlFor={`${ids}-season`}
                  className="block text-sm font-medium text-ink"
                >
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
                type="submit"
                disabled={busy || username.trim().length === 0}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-brand-purple/50 bg-brand-purple/15 px-5 py-2.5 text-sm font-semibold text-brand-purple transition-colors hover:bg-brand-purple/25 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {connecting && (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                )}
                {connecting ? "Finding" : "Find my leagues"}
              </button>

              {/* Signed-in readers only: there is nowhere to save it otherwise,
                  and the guest notice under this form asks them to make an
                  account instead. */}
              {gate.kind !== "guest" && (
                <div className="flex min-h-11 items-center gap-2 sm:col-span-3">
                  <input
                    id={`${ids}-save-handle`}
                    type="checkbox"
                    checked={saveHandle}
                    onChange={(e) => setSaveHandle(e.target.checked)}
                    className="h-4 w-4 rounded border-line bg-base text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  />
                  <label
                    htmlFor={`${ids}-save-handle`}
                    className="flex min-h-11 cursor-pointer items-center text-sm text-ink-muted"
                  >
                    Save this as my Sleeper username
                  </label>
                </div>
              )}

              {connectError && (
                <p
                  id={`${ids}-connect-error`}
                  role="alert"
                  className="text-sm text-signal-danger sm:col-span-3"
                >
                  {connectError}
                </p>
              )}
            </form>
          )}
        />

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
              <section
                aria-labelledby={`${ids}-league-heading`}
                className="min-w-0"
              >
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

                {/* A list rather than a select, because a select cannot show
                    the league's own logo. Native radios inside it, so arrow
                    keys move between leagues exactly as they did before. */}
                <LeagueChoiceList
                  label="Your league"
                  choices={leagueChoices}
                  value={selectedLeagueId}
                  onChange={(id) => {
                    setSelectedLeagueId(id);
                    setReport(null);
                    setBidError(null);
                  }}
                  className="mt-3"
                />

                <button
                  type="button"
                  onClick={() => setCommittedLeagueId(selectedLeagueId)}
                  // NOT disabled once the league is committed. Both of those
                  // clauses went true in the same commit as the click, and a
                  // browser blurs a focused element the moment it is disabled,
                  // so focus fell to <body> and a keyboard reader was left
                  // dozens of tabs from the thing they had just asked for.
                  // Pressing it again is idempotent, so there is nothing to
                  // guard against.
                  disabled={!selectedLeagueId || loadingAgents}
                  className="mt-3 inline-flex h-11 min-h-11 items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 px-4 text-sm font-medium text-ink transition-colors hover:border-brand-purple disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {loadingAgents
                    ? "Loading free agents..."
                    : selectedLeagueId === committedLeagueId
                      ? "League loaded"
                      : "Use this league"}
                </button>

                {leagues.some((l) => !l.synced || l.rosterId === null) && (
                  <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
                    <Layers
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
                    />
                    <span>
                      Leagues marked &quot;Syncs when picked&quot; are new to
                      us. Pick one and we read it from Sleeper on the spot.
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
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
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
                  {checkingAll && (
                    <Loader2
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                  )}
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
          <li
            key={row.sleeperLeagueId}
            className="rounded-card border border-line bg-surface/60 p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-semibold text-ink">{row.leagueName}</p>
              {row.status === "ok" && row.report && (
                <p className="font-mono text-sm font-bold tabular-nums text-brand-cyan">
                  <span aria-hidden="true">
                    {row.report.ladder.likely} to {row.report.ladder.walkAway}{" "}
                    FAAB
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
          {notChecked} more league{notChecked === 1 ? "" : "s"} unchecked.
          Pricing is heavy, so we cap how many run at once. Do those one at a
          time above.
        </p>
      )}
    </section>
  );
}
