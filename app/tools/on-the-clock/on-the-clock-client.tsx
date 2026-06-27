"use client";

/**
 * Client root for the On The Clock draft cockpit.
 *
 * PHASE 5 (live data wiring). The draft DATA flow is now live:
 *   - connect -> GET /api/on-the-clock/leagues (no Sleeper from the client),
 *   - select a league -> GET /api/on-the-clock/draft?draft_id= (warm read; the
 *     server warms a cold cache once through the durable lock),
 *   - Sync draft -> POST /api/on-the-clock/draft/sync (server-enforced cooldown),
 *   - Supabase Realtime on on_the_clock_pick_cache merges co-viewer picks with NO
 *     Sleeper call and NO automatic sync. There is NO polling anywhere.
 * The draft board, pick list, My Draft, on-the-clock status, and connected-team
 * detection all read from the live shaped cache.
 *
 * LIVE (Phase 6A/6B/6C): the available Big Board, Best remaining by position, BOTH
 * recommendation cards (Best Available = pure value; Team Need = value-aware roster
 * need via lib/on-the-clock/recommend.ts), AND the Trade Analyzer (pool-aware value
 * check via lib/on-the-clock/trade-analyzer.ts; pick values projected from the
 * board and flagged estimated). No mock panels remain.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Gauge,
  Target,
  ListChecks,
  LayoutGrid,
  List,
  ArrowLeftRight,
  Users,
  WifiOff,
} from "lucide-react";
import type {
  LeagueCard,
  OnTheClockSettings,
  PlayerPool,
  ShapedDraftCache,
  SyncStatus,
} from "@/lib/on-the-clock/types";
import type { BoardResult, DraftPosition } from "@/lib/on-the-clock/board-types";
import { recommend } from "@/lib/on-the-clock/recommend";
import { createClient } from "@/lib/supabase/client";
import { fetchLeagues, fetchDraft, syncDraft, fetchBoard } from "@/lib/on-the-clock/client";
import {
  deriveDraftState,
  mapRealtimePickRow,
  mergePick,
  teamNameForSeat,
  lastPickLabel as lastPickLabelFor,
  formatLastSynced,
  syncStatusLine,
  excludeDrafted,
  filterPool,
  draftShapeFromMeta,
} from "@/lib/on-the-clock/draft-derive";
import { buildTradeCatalog } from "@/lib/on-the-clock/trade-analyzer";
import { buildTeamRollups } from "@/lib/on-the-clock/rosters";
import {
  normalizeTradedPicks,
  resolveCurrentDraftPicks,
  resolveTradedFuturePicks,
} from "@/lib/on-the-clock/pick-ownership";
import { UsernameGate } from "./username-gate";
import { LeaguePicker } from "./league-picker";
import { StepRail } from "./step-rail";
import { CommandHeader } from "./command-header";
import { OnTheClockCard } from "./on-the-clock-card";
import { PlayerSpotlight, SecondaryPick } from "./player-spotlight";
import { Panel } from "./panel";
import { DraftRoomStatus, BestRemainingByPosition } from "./dashboard-panels";
import { AvailableList } from "./available-list";
import { DraftBoard } from "./draft-board";
import { PickList } from "./pick-list";
import { MyDraft } from "./my-draft";
import { TradeAnalyzer } from "./trade-analyzer";
import { RostersRankings } from "./rosters-rankings";
import { LoadingCard, ErrorCard, EmptyCard } from "./states";

type Step = "connect" | "pick-league" | "room";
type View = "pick" | "drafted" | "rosters" | "trade";
type DraftedMode = "board" | "list";
type LiveStatus = "off" | "connecting" | "live" | "unavailable";

const VIEWS: Array<{ id: View; label: string; icon: typeof Target }> = [
  { id: "pick", label: "Who to pick", icon: Target },
  { id: "drafted", label: "Drafted players", icon: ListChecks },
  { id: "rosters", label: "Rosters & Rankings", icon: Users },
  { id: "trade", label: "Trade Analyzer", icon: ArrowLeftRight },
];

/** Coerce a Sleeper pick/roster position string to one of the six draft buckets. */
function coercePosition(pos: string | null): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

export function OnTheClockClient({
  defaultSeason,
  defaultUsername = "",
  realtimeEnabled = true,
  cooldownSeconds = 30,
  settings,
}: {
  defaultSeason: string;
  defaultUsername?: string;
  realtimeEnabled?: boolean;
  cooldownSeconds?: number;
  /** Admin On The Clock settings (drives the Team Need engine). */
  settings: OnTheClockSettings;
}) {
  // ----- flow -----
  const [step, setStep] = useState<Step>("connect");

  // ----- discovery (leagues) -----
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<LeagueCard[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const lookupRef = useRef<{ username: string; season: string }>({ username: "", season: defaultSeason });

  // ----- draft room -----
  const [league, setLeague] = useState<LeagueCard | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [cache, setCache] = useState<ShapedDraftCache | null>(null);

  // ----- ranked board (FF Beacon, per league's auto-detected format) -----
  const [board, setBoard] = useState<BoardResult | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // ----- sync -----
  const [syncing, setSyncing] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [syncMessage, setSyncMessage] = useState("Not synced yet");

  // ----- realtime -----
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(realtimeEnabled ? "connecting" : "off");

  // ----- view -----
  const [pool, setPool] = useState<PlayerPool>("everyone");
  const [view, setView] = useState<View>("pick");
  const [draftedMode, setDraftedMode] = useState<DraftedMode>("board");
  const viewTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // ----- discovery handlers -----
  const runLookup = useCallback(
    async (username: string, season: string, mode: "connect" | "refresh") => {
      if (mode === "connect") {
        setConnecting(true);
        setConnectError(null);
      } else {
        setRefreshing(true);
        setRefreshError(null);
      }
      const result = await fetchLeagues(username, season);
      if (result.ok) {
        setLeagues(result.data.leagues);
        setTruncated(result.data.truncated);
        setMyUserId(result.data.userId);
        lookupRef.current = { username, season };
        if (mode === "connect") setStep("pick-league");
      } else if (mode === "connect") {
        setConnectError(result.message);
      } else {
        setRefreshError(result.message);
      }
      if (mode === "connect") setConnecting(false);
      else setRefreshing(false);
    },
    [],
  );

  const connect = (username: string, season: string) => {
    void runLookup(username, season, "connect");
  };
  const refreshLeagues = () => {
    const { username, season } = lookupRef.current;
    if (!username) return;
    void runLookup(username, season, "refresh");
  };

  // ----- draft load -----
  const loadDraft = useCallback(
    async (card: LeagueCard) => {
      setDraftLoading(true);
      setDraftError(null);
      const result = await fetchDraft(card.draftId);
      if (result.ok && result.data.cache) {
        const loaded = result.data.cache;
        setCache(loaded);
        setSyncMessage(formatLastSynced(loaded.draft.lastSyncedAt, Date.now()));
        // Default the pool from the draft type (rookie drafts default to Rookies
        // only); the user can override with the command-bar toggle afterward.
        setPool(loaded.draft.draftType === "rookie" ? "rookies" : "everyone");
      } else if (result.ok) {
        setDraftError("We could not load that draft.");
      } else {
        setDraftError(result.message);
      }
      setDraftLoading(false);
    },
    [],
  );

  // ----- board load (FF Beacon, format auto-detected from the league) -----
  const loadBoard = useCallback(async (card: LeagueCard) => {
    if (!card.formatSlug) {
      setBoard(null);
      setBoardError(
        "We could not match this league to an FF Beacon format, so the available board is unavailable.",
      );
      setBoardLoading(false);
      return;
    }
    setBoardLoading(true);
    setBoardError(null);
    const result = await fetchBoard(card.formatSlug);
    if (result.ok) {
      setBoard(result.data.board);
    } else {
      setBoard(null);
      setBoardError(result.message);
    }
    setBoardLoading(false);
  }, []);

  const selectLeague = (l: LeagueCard) => {
    setLeague(l);
    setView("pick");
    setCache(null);
    setDraftError(null);
    setBoard(null);
    setBoardError(null);
    setCooldownRemaining(0);
    setSyncMessage("Loading draft...");
    setLiveStatus(realtimeEnabled ? "connecting" : "off");
    setStep("room");
    void loadDraft(l);
    void loadBoard(l);
  };

  // ----- sync handler -----
  const onSync = useCallback(async () => {
    if (!league || syncing || cooldownRemaining > 0) return;
    setSyncing(true);
    setSyncMessage("Syncing the room...");
    const result = await syncDraft({
      draftId: league.draftId,
      leagueId: league.leagueId,
      season: league.season,
    });
    const now = Date.now();
    if (!result.ok) {
      setSyncMessage(result.message);
      setSyncing(false);
      return;
    }
    const data = result.data;
    if (data.cache) setCache(data.cache);
    const status: SyncStatus = data.status;
    setSyncMessage(
      syncStatusLine(status, {
        lastSyncedAt: data.lastSyncedAt,
        cooldownRemainingSeconds: data.cooldownRemainingSeconds,
        nowMs: now,
        error: data.error,
      }),
    );
    // A successful sync starts the full shared cooldown; a blocked claim uses the
    // server's reported remaining window so the button matches the server clock.
    if (status === "synced") setCooldownRemaining(cooldownSeconds);
    else if (status === "cooldown" || status === "synced-by-other") {
      setCooldownRemaining(Math.max(0, Math.round(data.cooldownRemainingSeconds)));
    }
    setSyncing(false);
  }, [league, syncing, cooldownRemaining, cooldownSeconds]);

  // ----- cooldown countdown (UI only; NOT polling, never calls Sleeper) -----
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setTimeout(() => setCooldownRemaining((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldownRemaining]);

  // ----- Supabase Realtime: merge co-viewer picks, never call Sleeper/sync -----
  useEffect(() => {
    if (!league || !realtimeEnabled) {
      setLiveStatus(realtimeEnabled ? "connecting" : "off");
      return;
    }
    const draftId = league.draftId;
    setLiveStatus("connecting");
    const supabase = createClient();
    const channel = supabase
      .channel(`otc-draft-${draftId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "on_the_clock_pick_cache",
          filter: `sleeper_draft_id=eq.${draftId}`,
        },
        (payload) => {
          const shaped = mapRealtimePickRow(payload.new);
          if (!shaped) return;
          // Realtime ONLY mutates local pick state from the row payload. No fetch.
          setCache((prev) => {
            if (!prev) return prev;
            const picks = mergePick(prev.picks, shaped);
            return {
              ...prev,
              picks,
              draft: { ...prev.draft, pickCount: Math.max(prev.draft.pickCount, picks.length) },
            };
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveStatus("unavailable");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [league, realtimeEnabled]);

  const onViewKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = VIEWS.length - 1;
    let next = -1;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next >= 0) {
      e.preventDefault();
      const id = VIEWS[next].id;
      setView(id);
      viewTabRefs.current[id]?.focus();
    }
  };

  // ----- Step 1: Connect -----
  if (step === "connect") {
    return (
      <div className="mx-auto max-w-3xl">
        <div
          className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          {/* Beacon-gradient accent bar pinned to the top of the cockpit shell. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
            >
              <Gauge className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Draft cockpit
              </p>
              <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                Connect your draft to begin
              </h3>
            </div>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Enter your Sleeper username to load your live draft and step into the cockpit.
          </p>

          <div className="mt-6">
            <StepRail current={1} />
          </div>
          <div className="mt-5">
            <UsernameGate
              defaultUsername={defaultUsername}
              defaultSeason={defaultSeason}
              onConnect={connect}
              pending={connecting}
              error={connectError}
            />
          </div>
        </div>
      </div>
    );
  }

  // ----- Step 2: Choose draft -----
  if (step === "pick-league") {
    return (
      <div className="mx-auto max-w-4xl">
        <div
          className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          {/* Beacon-gradient accent bar pinned to the top of the cockpit shell. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <button
            type="button"
            onClick={() => setStep("connect")}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Change username
          </button>
          <div className="mt-4 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
            >
              <Gauge className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Draft cockpit
              </p>
              <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                Choose your draft
              </h3>
            </div>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Only leagues that are actively drafting show up here. Pick one to open its
            draft room.
          </p>

          <div className="mt-6">
            <StepRail current={2} />
          </div>
          <div className="mt-5">
            <LeaguePicker
              leagues={leagues}
              onSelect={selectLeague}
              onRefresh={refreshLeagues}
              refreshing={refreshing}
              error={refreshError}
              truncated={truncated}
            />
          </div>
        </div>
      </div>
    );
  }

  // ----- Step 3/4: Draft room (dashboard) -----
  // Loading / error gates before the room renders.
  if (draftLoading && !cache) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackToLeagues onClick={() => setStep("pick-league")} />
        <div className="mt-4">
          <LoadingCard label="Loading the draft room..." />
        </div>
      </div>
    );
  }
  if (!cache) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackToLeagues onClick={() => setStep("pick-league")} />
        <div className="mt-4 space-y-3">
          <ErrorCard message={draftError ?? "We could not load that draft."} />
          {league && (
            <button
              type="button"
              onClick={() => void loadDraft(league)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-2 text-sm font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const draftCache = cache;
  const derived = deriveDraftState(draftCache, myUserId);
  const teams = Number(draftCache.draft.settings.teams ?? 0);
  const isYourTurn = derived.mySlot > 0 && derived.onTheClockSlot === derived.mySlot;
  const onTheClockTeam =
    derived.onTheClockSlot > 0 ? teamNameForSeat(draftCache, derived.onTheClockSlot) : "Draft complete";
  const onTheClockPickLabel =
    derived.onTheClockPickNo > 0
      ? `pick ${derived.onTheClockPickNo} overall, R${derived.onTheClockRound}.${derived.onTheClockPickInRound}`
      : "no picks remaining";
  const yourSeatLabel = derived.mySlot > 0 ? `You · Seat ${derived.mySlot}` : "Team not detected";

  // Real available board (FF Beacon): ranked players minus drafted, filtered to the
  // pool. Empty until the per-league board finishes loading.
  const boardPlayers = board?.status === "ok" ? board.players : [];
  const available = filterPool(excludeDrafted(boardPlayers, draftCache.picks), pool);

  // Real recommendation engine (Phase 6B): Best Available (pure value) + Team Need
  // (value-aware roster need). Inputs are derived from the live cache + board.
  const detectedFormatSlug = board?.formatSlug ?? league?.formatSlug ?? "";
  const isDynasty = /dynasty/i.test(detectedFormatSlug);

  // My in-draft picks -> positions.
  const myPicks = draftCache.picks.filter(
    (p) =>
      (myUserId !== null && p.pickedBy === myUserId) ||
      (derived.mySlot > 0 && p.draftSlot === derived.mySlot),
  );
  const myDraftedPositions = myPicks
    .map((p) => coercePosition(p.position))
    .filter((p): p is DraftPosition => p !== null);

  // Pre-draft roster (dynasty only) -> positions, mapped from the board by Sleeper id.
  let seededPositions: DraftPosition[] = [];
  if (isDynasty && derived.myRosterId !== null) {
    const myRoster = draftCache.rosters.find((r) => r.rosterId === derived.myRosterId);
    if (myRoster) {
      const posBySleeperId = new Map<string, DraftPosition>();
      for (const pl of boardPlayers) if (pl.sleeperId) posBySleeperId.set(pl.sleeperId, pl.position);
      seededPositions = myRoster.players
        .map((id) => posBySleeperId.get(id) ?? null)
        .filter((p): p is DraftPosition => p !== null);
    }
  }

  const rosterKnown =
    derived.mySlot > 0 || myDraftedPositions.length > 0 || seededPositions.length > 0;

  const rec = recommend({
    available,
    pool,
    formatSlug: detectedFormatSlug,
    formatLabel: board?.formatLabel ?? league?.formatLabel ?? "",
    draftSettings: draftCache.draft.settings,
    myDraftedPositions,
    seededPositions,
    rosterKnown,
    currentRound: derived.onTheClockRound,
    settings,
  });
  const bestCard = rec.best;
  const needCard = rec.need;
  const recommendationsAlign = rec.aligned;

  // Trade Analyzer catalog (Phase 6C / 6C.1): values every asset from the board the
  // client already holds. mode follows the pool (Everyone = startup, Rookies = rookie).
  // poolBoard is the pre-exclusion pool board (future picks project from a board not
  // depleted by the current draft); `available` is post-exclusion for upcoming picks;
  // boardPlayers (full, all positions) values already-made picks.
  const tradeReady = board?.status === "ok";
  const tradeSeason = Number(league?.season ?? draftCache.draft.season) || 0;
  // Transaction-aware pick ownership: every current-draft pick (any owner) + concrete
  // traded future picks, resolved from the cached Sleeper traded_picks.
  const tradedPicks = normalizeTradedPicks(draftCache.tradedPicks);
  const currentPicks = resolveCurrentDraftPicks({
    teams: Number(draftCache.draft.settings.teams ?? 0),
    rounds: Number(draftCache.draft.settings.rounds ?? 0),
    shape: draftShapeFromMeta(draftCache.draft),
    slotToRosterId: draftCache.draft.slotToRosterId,
    madePicks: draftCache.picks,
    tradedPicks,
    currentSeason: tradeSeason,
  });
  const tradedFuturePicks = resolveTradedFuturePicks(tradedPicks, tradeSeason);
  // roster_id -> display name, for owner labels on picks (board/trade).
  const teamNameByRosterId: Record<number, string> = {};
  // Rosters & Rankings prefers the owner's custom team name and surfaces the
  // @username separately; these are kept local so board/trade labels are unchanged.
  const rollupTeamNameByRosterId: Record<number, string> = {};
  const rollupUsernameByRosterId: Record<number, string | null> = {};
  for (const r of draftCache.rosters) {
    const user = r.ownerId ? draftCache.users.find((u) => u.userId === r.ownerId) : undefined;
    teamNameByRosterId[r.rosterId] = user?.displayName ?? `Team ${r.rosterId}`;
    rollupTeamNameByRosterId[r.rosterId] =
      user?.teamName || user?.displayName || `Team ${r.rosterId}`;
    rollupUsernameByRosterId[r.rosterId] = user?.username || user?.displayName || null;
  }
  const tradeGroups = tradeReady
    ? buildTradeCatalog({
        mode: pool === "rookies" ? "rookie" : "startup",
        pool,
        available,
        poolBoard: filterPool(boardPlayers, pool),
        valueBoard: boardPlayers,
        currentPicks,
        tradedFuturePicks,
        teamNameByRosterId,
        myRosterId: derived.myRosterId,
        draftSettings: draftCache.draft.settings,
        onTheClockPickNo: derived.onTheClockPickNo,
        currentSeason: tradeSeason,
      })
    : [];

  // Rosters & Rankings rollups: per-team drafted-player value + future-pick value,
  // ranked by total. Only computed while that tab is open (and the board is ready)
  // so the realtime re-render on every pick stays cheap on the other tabs.
  const teamRollups =
    view === "rosters" && tradeReady
      ? buildTeamRollups({
          rosters: draftCache.rosters,
          picks: draftCache.picks,
          tradedPicks,
          valueBoard: boardPlayers,
          teamNameByRosterId: rollupTeamNameByRosterId,
          ownerUsernameByRosterId: rollupUsernameByRosterId,
          myRosterId: derived.myRosterId,
          draftSettings: draftCache.draft.settings,
          draftSeason: tradeSeason,
        })
      : [];

  // Format/source chips: source is ALWAYS FF Beacon (forced); format is auto-detected
  // from the Sleeper league. Use the league's detected label until the board confirms it.
  const formatLabel = board?.formatLabel ?? league?.formatLabel ?? "Detecting...";
  const formatIsClosest = league?.formatIsClosest ?? false;
  const sourceActive = board ? board.sourceActive : true;

  return (
    <div className="overflow-hidden rounded-modal border border-line bg-base/40">
      <CommandHeader
        leagueName={league?.name ?? "League"}
        draft={draftCache.draft}
        formatLabel={formatLabel}
        formatIsClosest={formatIsClosest}
        pool={pool}
        onPoolChange={setPool}
        onTheClockTeam={onTheClockTeam}
        onTheClockPickLabel={onTheClockPickLabel}
        isYourTurn={isYourTurn}
        yourSeatLabel={yourSeatLabel}
        sync={{ syncing, cooldownRemaining, statusMessage: syncMessage, onSync }}
      />

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <BackToLeagues onClick={() => setStep("pick-league")} />

        {/* Realtime fallback note: subtle, never blocks the room. */}
        {liveStatus !== "live" && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-subtle">
            <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
            {liveStatus === "connecting"
              ? "Connecting live updates..."
              : "Live updates unavailable. Use Sync draft to refresh."}
          </p>
        )}

        {/* Admin note: FF Beacon values are loading but the source is not publicly
            active yet. Dev/admin-facing; the board still renders. */}
        {board && !sourceActive && (
          <p className="mt-2 rounded-card border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Admin: FF Beacon values are not marked active in the source registry yet.
            On The Clock is showing them anyway because it forces FF Beacon.
          </p>
        )}

        {/* Rosters & Rankings stretches to the full container width: the right
            rail is hidden so every team's horizontal row has room. */}
        <div
          className={`mt-4 grid gap-5 ${
            view === "rosters" ? "" : "xl:grid-cols-[minmax(0,1fr)_360px]"
          }`}
        >
          {/* ---- Main content area: switches between views ---- */}
          <div className="min-w-0 space-y-5">
            {/* View switcher (tabs) */}
            <div role="tablist" aria-label="Draft views" className="flex flex-wrap gap-2">
              {VIEWS.map((v, i) => {
                const active = view === v.id;
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    ref={(el) => {
                      viewTabRefs.current[v.id] = el;
                    }}
                    role="tab"
                    id={`otc-tab-${v.id}`}
                    aria-selected={active}
                    aria-controls={`otc-view-${v.id}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setView(v.id)}
                    onKeyDown={(e) => onViewKeyDown(e, i)}
                    className={`flex min-h-11 items-center gap-2 rounded-card border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      active
                        ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                        : "border-line bg-surface/60 text-ink-muted hover:text-ink"
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    {v.label}
                  </button>
                );
              })}
            </div>

            {/* View: Who to pick */}
            <div
              role="tabpanel"
              id="otc-view-pick"
              aria-labelledby="otc-tab-pick"
              tabIndex={0}
              hidden={view !== "pick"}
              className="space-y-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {derived.onTheClockPickNo > 0 && (
                <OnTheClockCard
                  round={derived.onTheClockRound}
                  pickInRound={derived.onTheClockPickInRound}
                  overallPickNo={derived.onTheClockPickNo}
                  teamLabel={onTheClockTeam}
                  isYourTurn={isYourTurn}
                />
              )}

              <section aria-labelledby="draft-signal-title">
                <div className="mb-3">
                  <h2
                    id="draft-signal-title"
                    className="text-xl font-bold tracking-tight text-ink sm:text-2xl"
                  >
                    Draft signal
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Who to pick right now.{" "}
                    <span className="font-medium text-ink">Best Available</span> is the highest FF
                    Beacon value left on your real board.{" "}
                    <span className="font-medium text-ink">Team Need</span> weighs that value against
                    the holes in your lineup and your league format.
                  </p>
                </div>
                {recommendationsAlign && bestCard.player ? (
                  // Value and need point at the same player: show one aligned card,
                  // never demote the user to a worse runner-up.
                  <PlayerSpotlight data={needCard} variant="aligned" />
                ) : (
                  <div className="space-y-3">
                    <PlayerSpotlight data={bestCard} variant="best" />
                    <div className="relative">
                      <div className="mb-1.5">
                        <span className="text-xs font-semibold text-ink-muted">Team Need</span>
                      </div>
                      <SecondaryPick data={needCard} variant="need" />
                    </div>
                  </div>
                )}
              </section>

              <Panel
                eyebrow="The pool"
                title="Available players"
                helper="Real undrafted players from FF Beacon, sorted by current value. Drafted players drop off automatically."
              >
                {boardLoading ? (
                  <LoadingCard label="Loading the FF Beacon board..." />
                ) : boardError ? (
                  <ErrorCard message={boardError} />
                ) : !board || board.status === "source-unavailable" ? (
                  <EmptyCard
                    title="FF Beacon values are not set up."
                    body="Admin: the FF Beacon source row is missing from the source registry. On The Clock uses FF Beacon values for the available board."
                  />
                ) : board.status !== "ok" ? (
                  <EmptyCard
                    title={`No FF Beacon rankings for ${board.formatLabel} yet.`}
                    body="The draft board and picks still work. The available big board and values will appear once this format's FF Beacon rankings are published."
                  />
                ) : available.length === 0 ? (
                  <EmptyCard
                    title={pool === "rookies" ? "No rookies available." : "No players available."}
                    body={
                      pool === "rookies"
                        ? "We could not find ranked first-year players in FF Beacon for this format. Switch the pool to Everyone, or check back once rookie values are published."
                        : "Every ranked player in this pool has been drafted."
                    }
                  />
                ) : (
                  <AvailableList players={available} />
                )}
              </Panel>
            </div>

            {/* View: Drafted players (LIVE from the synced cache) */}
            <div
              role="tabpanel"
              id="otc-view-drafted"
              aria-labelledby="otc-tab-drafted"
              tabIndex={0}
              hidden={view !== "drafted"}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
                    Drafted players
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Everyone taken so far, live from the draft. View it as a board or as a list.
                  </p>
                </div>
                <div
                  role="group"
                  aria-label="Drafted players layout"
                  className="inline-flex overflow-hidden rounded-card border border-line"
                >
                  {(
                    [
                      { id: "board", label: "Board", icon: LayoutGrid },
                      { id: "list", label: "List", icon: List },
                    ] as Array<{ id: DraftedMode; label: string; icon: typeof LayoutGrid }>
                  ).map(({ id, label, icon: Icon }) => {
                    const active = draftedMode === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setDraftedMode(id)}
                        className={`inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan ${
                          active ? "bg-beacon text-black" : "bg-base text-ink-muted hover:text-ink"
                        }`}
                      >
                        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {draftedMode === "board" ? (
                <Panel
                  eyebrow="Every seat"
                  title="Draft board"
                  helper="Columns are seats, rows are rounds. Each cell shows the overall pick number and who was taken."
                  bodyClassName="px-0 sm:px-0"
                >
                  <DraftBoard
                    draft={draftCache.draft}
                    picks={draftCache.picks}
                    currentPicks={currentPicks}
                    teamNameByRosterId={teamNameByRosterId}
                    connectedUserSlot={derived.mySlot}
                    onTheClockPickNo={derived.onTheClockPickNo}
                    lastPickNo={derived.lastPick?.pickNo ?? 0}
                  />
                </Panel>
              ) : (
                <Panel
                  eyebrow="History"
                  title="All picks"
                  helper="Every pick in order, a full readable peer of the board."
                >
                  <PickList
                    picks={draftCache.picks}
                    users={draftCache.users}
                    draft={draftCache.draft}
                    teamNameByRosterId={teamNameByRosterId}
                    connectedUserId={myUserId ?? ""}
                  />
                </Panel>
              )}
            </div>

            {/* View: Rosters & Rankings (full width; right rail hidden) */}
            <div
              role="tabpanel"
              id="otc-view-rosters"
              aria-labelledby="otc-tab-rosters"
              tabIndex={0}
              hidden={view !== "rosters"}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <RostersRankings
                teams={teamRollups}
                myRosterId={derived.myRosterId}
                boardReady={tradeReady}
              />
            </div>

            {/* View: Trade Analyzer (LIVE Phase 6C; pool-aware value check) */}
            <div
              role="tabpanel"
              id="otc-view-trade"
              aria-labelledby="otc-tab-trade"
              tabIndex={0}
              hidden={view !== "trade"}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {/* Keyed on draft + pool so switching leagues OR Everyone <-> Rookies
                  remounts the analyzer and clears both sides (no carryover). */}
              <TradeAnalyzer
                key={`${league?.draftId ?? "none"}-${pool}`}
                pool={pool}
                groups={tradeGroups}
                boardReady={tradeReady}
              />
            </div>
          </div>

          {/* ---- Persistent right rail (hidden on the full-width Rosters tab) ---- */}
          {view !== "rosters" && (
            <aside aria-label="Draft room panels" className="space-y-5 xl:sticky xl:top-32 xl:self-start">
              <DraftRoomStatus
                draft={draftCache.draft}
                onTheClockTeam={onTheClockTeam}
                onTheClockPickLabel={onTheClockPickLabel}
                isYourTurn={isYourTurn}
                lastPickLabel={lastPickLabelFor(derived.lastPick)}
              />
              <BestRemainingByPosition players={available} />
              <Panel eyebrow="Your team" title="Your draft">
                <MyDraft
                  picks={draftCache.picks}
                  draft={draftCache.draft}
                  connectedUserId={myUserId ?? ""}
                  connectedUserSlot={derived.mySlot}
                />
              </Panel>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function BackToLeagues({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
      Back to leagues
    </button>
  );
}
