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
  History,
  Users,
  Trophy,
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
import type { DraftSnapshotPayload } from "@/lib/on-the-clock/snapshot-types";
import { recommend } from "@/lib/on-the-clock/recommend";
import { createClient } from "@/lib/supabase/client";
import {
  fetchLeagues,
  fetchDraft,
  syncDraft,
  fetchBoard,
  fetchSnapshot,
  fetchTransactions,
} from "@/lib/on-the-clock/client";
import type { HistoryTransaction, TradeHistoryContext } from "@/lib/on-the-clock/trade-history";
import {
  deriveDraftState,
  mapRealtimePickRow,
  mergePick,
  teamNameForSeat,
  teamNameForRoster,
  lastPickLabel as lastPickLabelFor,
  formatLastSynced,
  syncStatusLine,
  excludeDrafted,
  filterPool,
  inferPlayerPool,
  describeInferredPool,
  draftShapeFromMeta,
} from "@/lib/on-the-clock/draft-derive";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { buildTradeCatalog } from "@/lib/on-the-clock/trade-analyzer";
import { buildTeamRollups } from "@/lib/on-the-clock/rosters";
import { computeDraftAwards } from "@/lib/on-the-clock/awards";
import {
  normalizeTradedPicks,
  resolveCurrentDraftPicks,
  resolveTradedFuturePicks,
} from "@/lib/on-the-clock/pick-ownership";
import { UsernameGate } from "./username-gate";
import { LeaguePicker } from "./league-picker";
import { PoolNotice, markPoolNoticeSeen, poolNoticeSeen } from "./pool-notice";
import { StepRail } from "./step-rail";
import { CommandHeader } from "./command-header";
import { PlayerSpotlight, SecondaryPick } from "./player-spotlight";
import { Panel } from "./panel";
import { DraftRoomStatus, BestRemainingByPosition } from "./dashboard-panels";
import { AvailableList } from "./available-list";
import { DraftBoard } from "./draft-board";
import { PickList } from "./pick-list";
import { MyDraft } from "./my-draft";
import { TradeAnalyzer } from "./trade-analyzer";
import { RostersRankings, TeamPositionGrid } from "./rosters-rankings";
import { RankingsAwards } from "./rankings-awards";
import { TradeHistory } from "./trade-history";
import { LoadingCard, ErrorCard, EmptyCard } from "./states";

type Step = "connect" | "pick-league" | "room";
type View = "pick" | "drafted" | "rosters" | "history" | "trade" | "rankings";
type DraftedMode = "board" | "list";
type LiveStatus = "off" | "connecting" | "live" | "unavailable";

const VIEWS: Array<{ id: View; label: string; icon: typeof Target }> = [
  { id: "pick", label: "Who to pick", icon: Target },
  { id: "drafted", label: "Board", icon: ListChecks },
  { id: "rosters", label: "Rosters", icon: Users },
  { id: "history", label: "Trades", icon: History },
  { id: "trade", label: "Trade Analyzer", icon: ArrowLeftRight },
  { id: "rankings", label: "Awards", icon: Trophy },
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

  // ----- completed-draft snapshot (results locked server-side; see
  // lib/on-the-clock/draft-snapshot.ts). Non-null = snapshot mode. -----
  const [snapshot, setSnapshot] = useState<DraftSnapshotPayload | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotWarning, setSnapshotWarning] = useState<string | null>(null);

  // ----- one-time inferred player-pool notice -----
  const [poolNoticeOpen, setPoolNoticeOpen] = useState(false);

  // Staleness guard for async load continuations: selectLeague stamps the
  // active draft id, and every in-flight loadDraft / loadBoard / loadSnapshot
  // response is dropped unless it still matches. Without this, switching
  // leagues while a slow snapshot request is in flight could land league A's
  // frozen board and trades inside league B's room.
  const activeDraftIdRef = useRef<string | null>(null);

  // ----- trade history (lazy-loaded when the tab opens; cached per league) -----
  const [tradeHistory, setTradeHistory] = useState<HistoryTransaction[] | null>(null);
  const [tradeHistoryTruncated, setTradeHistoryTruncated] = useState(false);
  const [tradeHistoryLoading, setTradeHistoryLoading] = useState(false);
  const [tradeHistoryError, setTradeHistoryError] = useState<string | null>(null);
  // The league id whose trades are loaded (or claimed in-flight), so the tab does
  // not refetch on every render. Reset to null to force a reload.
  const historyLoadedFor = useRef<string | null>(null);

  // ----- sync -----
  const [syncing, setSyncing] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [syncMessage, setSyncMessage] = useState("Not synced yet");

  // ----- realtime -----
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(realtimeEnabled ? "connecting" : "off");

  // ----- view -----
  // (the player pool is DERIVED, not state: see inferPlayerPool below)
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

  // ----- board load (FF Beacon, format auto-detected from the league) -----
  const loadBoard = useCallback(async (card: LeagueCard, poolForAdp: PlayerPool) => {
    if (activeDraftIdRef.current !== card.draftId) return;
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
    const result = await fetchBoard(card.formatSlug, poolForAdp);
    if (activeDraftIdRef.current !== card.draftId) return; // league switched away
    if (result.ok) {
      setBoard(result.data.board);
    } else {
      setBoard(null);
      setBoardError(result.message);
    }
    setBoardLoading(false);
  }, []);

  // ----- snapshot load (completed drafts; locked results, snapshot-first) -----
  const loadSnapshot = useCallback(
    async (card: LeagueCard, fallbackPool: PlayerPool) => {
      setSnapshotLoading(true);
      setSnapshotWarning(null);
      const result = await fetchSnapshot({
        draftId: card.draftId,
        formatSlug: card.formatSlug,
        leagueName: card.name,
      });
      if (activeDraftIdRef.current !== card.draftId) return; // league switched away
      if (result.ok && result.data.snapshot) {
        const snap = result.data.snapshot;
        setSnapshot(snap);
        // The frozen cache is the render source: picks, users, rosters, traded
        // picks all come from the moment the snapshot was finalized.
        setCache(snap.cache);
        setTradeHistory(snap.transactions);
        setTradeHistoryTruncated(false);
        historyLoadedFor.current = card.leagueId;
      } else {
        // Fall back to live mode so the room still renders; results for a
        // completed draft may drift until a snapshot can be locked, so say so.
        if (!result.ok) {
          setSnapshotWarning(
            "We could not lock this draft's final results right now, so current values are shown temporarily. Reload later to lock them.",
          );
        } else if (result.data.reason === "no-board") {
          setSnapshotWarning(
            "No FF Beacon values exist for this league's format yet, so this draft cannot be graded.",
          );
        }
        void loadBoard(card, fallbackPool);
      }
      setSnapshotLoading(false);
    },
    [loadBoard],
  );

  // ----- draft load -----
  const loadDraft = useCallback(
    async (card: LeagueCard) => {
      setDraftLoading(true);
      setDraftError(null);
      const result = await fetchDraft(card.draftId);
      if (activeDraftIdRef.current !== card.draftId) return; // league switched away
      if (result.ok && result.data.cache) {
        const loaded = result.data.cache;
        setCache(loaded);
        setSyncMessage(formatLastSynced(loaded.draft.lastSyncedAt, Date.now()));
        // The player pool is inferred (no manual toggle): league type + draft
        // round count. Completed drafts route to snapshot mode; live drafts load
        // the current FF Beacon board (with ADP for the inferred pool's market).
        const inferredPool = inferPlayerPool({
          formatSlug: card.formatSlug,
          rounds: Number(loaded.draft.settings.rounds ?? 0),
        });
        if (loaded.draft.draftStatus === "complete") {
          void loadSnapshot(card, inferredPool);
        } else {
          void loadBoard(card, inferredPool);
        }
        if (!poolNoticeSeen(card.draftId)) setPoolNoticeOpen(true);
      } else if (result.ok) {
        setDraftError("We could not load that draft.");
      } else {
        setDraftError(result.message);
      }
      setDraftLoading(false);
    },
    [loadBoard, loadSnapshot],
  );

  // ----- trade history load (Sleeper trades for the league, server-fetched) -----
  const loadTradeHistory = useCallback(async (leagueId: string) => {
    // Claim the league id immediately so the open-tab effect won't refire while
    // this request is in flight.
    historyLoadedFor.current = leagueId;
    setTradeHistoryLoading(true);
    setTradeHistoryError(null);
    const result = await fetchTransactions(leagueId);
    if (result.ok) {
      setTradeHistory(result.data.transactions);
      setTradeHistoryTruncated(result.data.truncated);
    } else {
      setTradeHistoryError(result.message);
      historyLoadedFor.current = null; // allow a retry
    }
    setTradeHistoryLoading(false);
  }, []);

  const selectLeague = (l: LeagueCard) => {
    activeDraftIdRef.current = l.draftId;
    setLeague(l);
    setView("pick");
    setCache(null);
    setDraftError(null);
    setBoard(null);
    setBoardError(null);
    setBoardLoading(false);
    setSnapshot(null);
    setSnapshotWarning(null);
    setSnapshotLoading(false);
    setPoolNoticeOpen(false);
    setTradeHistory(null);
    setTradeHistoryTruncated(false);
    setTradeHistoryError(null);
    historyLoadedFor.current = null;
    setCooldownRemaining(0);
    setSyncMessage("Loading draft...");
    setLiveStatus(realtimeEnabled ? "connecting" : "off");
    setStep("room");
    // The board (or the completed-draft snapshot) loads after the draft, once
    // the round count is known, so the inferred pool drives the ADP market.
    void loadDraft(l);
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

  // ----- Supabase Realtime: merge co-viewer picks, never call Sleeper/sync.
  // Skipped entirely in snapshot mode: a completed draft can never change. -----
  useEffect(() => {
    if (!league || !realtimeEnabled || snapshot) {
      setLiveStatus(realtimeEnabled && !snapshot ? "connecting" : "off");
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
  }, [league, realtimeEnabled, snapshot]);

  // ----- lazy-load trade history the first time the Trades OR Rankings & Awards tab
  // is opened for a league (the awards need the league's trades too). Snapshot
  // mode never fetches: the frozen trades were set when the snapshot loaded. -----
  useEffect(() => {
    if ((view !== "history" && view !== "rankings") || !league || snapshot) return;
    if (historyLoadedFor.current === league.leagueId) return;
    void loadTradeHistory(league.leagueId);
  }, [view, league, snapshot, loadTradeHistory]);

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
            Actively drafting leagues lead the list, with pre-draft and completed drafts
            below. Open a completed draft to review its results, grades, trades, and
            awards.
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

  // ----- Snapshot mode vs live mode -----
  // Completed draft with a finalized snapshot: everything renders from the
  // frozen payload (board, cache, trades, awards); nothing recalculates from
  // current values. Active drafts stay fully live.
  const snapshotMode = snapshot !== null;
  const activeBoard: BoardResult | null = snapshotMode
    ? {
        status: "ok",
        players: snapshot.board.players,
        formatSlug: snapshot.board.formatSlug,
        formatLabel: snapshot.board.formatLabel,
        sourceSlug: "ffbeacon",
        sourceLabel: "FF Beacon",
        valueSourceSlug: "ffbeacon",
        sourceActive: true,
        season: snapshot.board.season,
        pickValues: snapshot.board.pickValues,
        adpFormatKey: snapshot.board.adpFormatKey,
        adpSnapshotDate: snapshot.board.adpSnapshotDate,
      }
    : board;
  const activeBoardLoading = snapshotMode ? false : boardLoading || snapshotLoading;
  const activeBoardError = snapshotMode ? null : boardError;

  // The player pool is inferred, never toggled: the snapshot's recorded pool in
  // snapshot mode, else league type + round count (see inferPlayerPool).
  const draftRounds = Number(draftCache.draft.settings.rounds ?? 0);
  const pool: PlayerPool = snapshotMode
    ? snapshot.playerPool
    : inferPlayerPool({ formatSlug: league?.formatSlug, rounds: draftRounds });

  // ADP context: player-keyed map (for board/list pick indicators + awards) and
  // the neutral threshold. Snapshot mode uses the threshold the draft was GRADED
  // with (frozen at finalize), so a later admin tuning can never change a
  // finalized draft's icons or verdicts; live mode uses the current setting.
  const adpThreshold = snapshotMode
    ? snapshot.thresholdPicks
    : settings.valueIndicators.thresholdPicks;

  // Transaction-aware pick ownership: every current-draft pick (any owner) + concrete
  // traded future picks, resolved from the cached Sleeper traded_picks. Computed here
  // (ahead of the on-the-clock labels) so "who is on the clock" reflects the roster
  // that CURRENTLY owns the upcoming pick, not the seat's original owner. Reused below
  // by the Trade Analyzer and Trade History catalogs.
  const tradeSeason = Number(league?.season ?? draftCache.draft.season) || 0;
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

  // The roster that currently owns the on-the-clock pick (trade-aware). When a pick
  // has been traded, this is the team that traded FOR it, not the seat's original
  // owner. Null when the draft is complete or ownership could not be resolved.
  const onTheClockPick =
    derived.onTheClockPickNo > 0
      ? currentPicks.find((p) => p.overall === derived.onTheClockPickNo) ?? null
      : null;
  const onTheClockOwnerRosterId = onTheClockPick?.currentOwnerRosterId ?? null;

  // It's your turn when YOU currently own the on-the-clock pick (so a pick you
  // traded for makes it your turn, and a pick you traded away does not). Falls back
  // to the seat match only when ownership or your roster is unknown.
  const isYourTurn =
    onTheClockOwnerRosterId !== null && derived.myRosterId !== null
      ? onTheClockOwnerRosterId === derived.myRosterId
      : derived.mySlot > 0 && derived.onTheClockSlot === derived.mySlot;
  const onTheClockTeam =
    derived.onTheClockSlot > 0
      ? onTheClockOwnerRosterId !== null
        ? teamNameForRoster(draftCache, onTheClockOwnerRosterId)
        : teamNameForSeat(draftCache, derived.onTheClockSlot)
      : "Draft complete";
  const onTheClockPickLabel =
    derived.onTheClockPickNo > 0
      ? `pick ${derived.onTheClockPickNo} overall, R${derived.onTheClockRound}.${derived.onTheClockPickInRound}`
      : "no picks remaining";
  const yourSeatLabel = derived.mySlot > 0 ? `You · Seat ${derived.mySlot}` : "Team not detected";

  // Real available board (FF Beacon): ranked players minus drafted, filtered to the
  // pool. Empty until the per-league board (or snapshot) finishes loading.
  const boardPlayers = activeBoard?.status === "ok" ? activeBoard.players : [];
  const available = filterPool(excludeDrafted(boardPlayers, draftCache.picks), pool);

  // Sleeper player id -> ADP, from the board rows (live: latest snapshot; frozen:
  // the snapshot resolved for the draft's completion time).
  const adpBySleeperId: Record<string, number> = {};
  for (const pl of boardPlayers) {
    if (pl.sleeperId && typeof pl.adp === "number") adpBySleeperId[pl.sleeperId] = pl.adp;
  }

  // Real recommendation engine (Phase 6B): Best Available (pure value) + Team Need
  // (value-aware roster need). Inputs are derived from the live cache + board.
  const detectedFormatSlug = activeBoard?.formatSlug ?? league?.formatSlug ?? "";
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
    formatLabel: activeBoard?.formatLabel ?? league?.formatLabel ?? "",
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
  const tradeReady = activeBoard?.status === "ok";
  // roster_id -> display name, for owner labels on picks (board/trade).
  const teamNameByRosterId: Record<number, string> = {};
  // Rosters & Rankings shows the owner's username as the primary label and the
  // custom team name (when set) subtly after it; kept local so board/trade labels
  // are unchanged.
  const rollupOwnerNameByRosterId: Record<number, string> = {};
  const rollupTeamNameByRosterId: Record<number, string | null> = {};
  // roster_id -> owner Sleeper avatar id, used by the award cards on the Rankings &
  // Awards tab. Captured during sync (league_users.avatar); null when unset.
  const avatarByRosterId: Record<number, string | null> = {};
  for (const r of draftCache.rosters) {
    const user = r.ownerId ? draftCache.users.find((u) => u.userId === r.ownerId) : undefined;
    teamNameByRosterId[r.rosterId] = user?.displayName ?? `Team ${r.rosterId}`;
    rollupOwnerNameByRosterId[r.rosterId] =
      user?.displayName || user?.username || `Team ${r.rosterId}`;
    rollupTeamNameByRosterId[r.rosterId] = user?.teamName ?? null;
    avatarByRosterId[r.rosterId] = user?.avatar ?? null;
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
        futurePickValues: activeBoard?.pickValues ?? [],
        teamNameByRosterId,
        myRosterId: derived.myRosterId,
        draftSettings: draftCache.draft.settings,
        onTheClockPickNo: derived.onTheClockPickNo,
        currentSeason: tradeSeason,
      })
    : [];

  // Board view (Drafted -> Board): only the board breaks out to the full viewport; the
  // supporting rows above it stay inside the container.
  const boardFull = view === "drafted" && draftedMode === "board";

  // Rosters & Rankings rollups: per-team drafted-player value + future-pick value,
  // ranked by total. Computed while the Rosters or Rankings & Awards tab is open, or in
  // the full board view (whose "Your draft" row reuses this roster layout), and only
  // when the board is ready, so the realtime re-render on every pick stays cheap.
  const teamRollups =
    (view === "rosters" || view === "rankings" || boardFull) && tradeReady
      ? buildTeamRollups({
          rosters: draftCache.rosters,
          picks: draftCache.picks,
          tradedPicks,
          valueBoard: boardPlayers,
          futurePickValues: activeBoard?.pickValues ?? [],
          ownerNameByRosterId: rollupOwnerNameByRosterId,
          teamNameByRosterId: rollupTeamNameByRosterId,
          myRosterId: derived.myRosterId,
          draftSettings: draftCache.draft.settings,
          draftSeason: tradeSeason,
        })
      : [];

  // The connected user's rollup, for the board view's "Your draft" row (same roster
  // layout as the Rosters tab). Null when their team is not detected.
  const myBoardRollup = boardFull ? (teamRollups.find((t) => t.isYou) ?? null) : null;

  // Trade History context: values every trade against the FULL board (independent of
  // the room's pool toggle, since a trade can involve any player or pick). Made picks
  // use the player taken; upcoming picks project from the post-draft board; future
  // picks are discounted projections. Built only while the tab is open so the
  // realtime re-render on every pick stays cheap elsewhere.
  const tradeHistoryContext: TradeHistoryContext | null =
    (view === "history" || view === "rankings") && tradeReady
      ? {
          valueBoard: boardPlayers,
          available: excludeDrafted(boardPlayers, draftCache.picks),
          poolBoard: boardPlayers,
          futurePickValues: activeBoard?.pickValues ?? [],
          currentPicks,
          teamNameByRosterId,
          myRosterId: derived.myRosterId,
          teams: Number(draftCache.draft.settings.teams ?? 0),
          onTheClockPickNo: derived.onTheClockPickNo,
          currentSeason: tradeSeason,
        }
      : null;

  // Rankings & Awards. Snapshot mode uses the awards LOCKED at finalize (they can
  // never drift). Live mode recomputes on every sync from the rollups, the
  // league's trades, the made picks, the ADP map, and the league's slot model.
  // Only while that tab is open (and the board is ready) so other tabs stay cheap.
  const awards = snapshotMode
    ? snapshot.awards
    : view === "rankings" && tradeReady
      ? computeDraftAwards({
          rollups: teamRollups,
          avatarByRosterId,
          transactions: tradeHistory ?? [],
          tradeContext: tradeHistoryContext,
          picks: draftCache.picks,
          draftSettings: draftCache.draft.settings,
          settings,
          adpBySleeperId,
        })
      : [];

  // Snapshot provenance line shown in the command bar (snapshot mode only).
  const snapshotNotice = snapshotMode ? buildSnapshotNotice(snapshot) : null;

  // Format/source chips: source is ALWAYS FF Beacon (forced); format is auto-detected
  // from the Sleeper league. Use the league's detected label until the board confirms it.
  const formatLabel = activeBoard?.formatLabel ?? league?.formatLabel ?? "Detecting...";
  const formatIsClosest = league?.formatIsClosest ?? false;
  const sourceActive = activeBoard ? activeBoard.sourceActive : true;

  // The three supporting panels (room status, best remaining, your draft) for the
  // sticky right rail, shown on every view except Rosters and the full board view.
  const sidebarPanels = (
    <>
      <DraftRoomStatus
        draft={draftCache.draft}
        onTheClockTeam={onTheClockTeam}
        onTheClockRound={derived.onTheClockRound}
        onTheClockPickInRound={derived.onTheClockPickInRound}
        onTheClockOverallPickNo={derived.onTheClockPickNo}
        isYourTurn={isYourTurn}
        lastPickLabel={lastPickLabelFor(derived.lastPick)}
      />
      <BestRemainingByPosition players={available} />
      <Panel eyebrow="Your team" title="Your draft">
        <MyDraft
          picks={draftCache.picks}
          connectedUserId={myUserId ?? ""}
          connectedUserSlot={derived.mySlot}
          connectedUserRosterId={derived.myRosterId}
        />
      </Panel>
    </>
  );

  return (
    <div
      className={`rounded-modal border border-line bg-base/40 ${
        boardFull ? "" : "overflow-hidden"
      }`}
    >
      <CommandHeader
        leagueName={league?.name ?? "League"}
        draft={draftCache.draft}
        formatLabel={formatLabel}
        formatIsClosest={formatIsClosest}
        pool={pool}
        onTheClockTeam={onTheClockTeam}
        onTheClockPickLabel={onTheClockPickLabel}
        isYourTurn={isYourTurn}
        yourSeatLabel={yourSeatLabel}
        sync={
          snapshotMode ? null : { syncing, cooldownRemaining, statusMessage: syncMessage, onSync }
        }
        snapshotNotice={snapshotNotice}
      />

      {/* One-time explanation of the auto-detected player pool. */}
      <PoolNotice
        open={poolNoticeOpen}
        pool={pool}
        message={describeInferredPool({
          // In snapshot mode the message describes the format the FINALIZER
          // resolved (the pool it recorded), not the league card's live hint.
          formatSlug: snapshotMode ? snapshot.formatSlug : league?.formatSlug,
          rounds: draftRounds,
          pool,
        })}
        formatLabel={formatLabel}
        onClose={() => {
          setPoolNoticeOpen(false);
          if (league) markPoolNoticeSeen(league.draftId);
        }}
      />

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <BackToLeagues onClick={() => setStep("pick-league")} />

        {/* Snapshot fallback warning: a completed draft that could not lock its
            results yet is temporarily showing live values. */}
        {snapshotWarning && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 rounded-card border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
          >
            {snapshotWarning}
          </p>
        )}

        {/* Realtime fallback note: subtle, never blocks the room. Irrelevant for a
            finalized snapshot, whose data can never change. */}
        {!snapshotMode && liveStatus !== "live" && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-subtle">
            <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
            {liveStatus === "connecting"
              ? "Connecting live updates..."
              : "Live updates unavailable. Use Sync draft to refresh."}
          </p>
        )}

        {/* Admin note: FF Beacon values are loading but the source is not publicly
            active yet. Dev/admin-facing; the board still renders. */}
        {activeBoard && !sourceActive && (
          <p className="mt-2 rounded-card border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Admin: FF Beacon values are not marked active in the source registry yet.
            On The Clock is showing them anyway because it forces FF Beacon.
          </p>
        )}

        {/* Rosters & Rankings (and the full-width board view) stretch to the full
            container width: the right rail is hidden so the content has room. */}
        <div
          className={`mt-4 grid gap-5 ${
            view === "rosters" || boardFull ? "" : "xl:grid-cols-[minmax(0,1fr)_360px]"
          }`}
        >
          {/* ---- Main content area: switches between views ---- */}
          <div className="min-w-0 space-y-5">
            {/* View switcher: a standout control bar that reads as the cockpit's
                primary navigation (elevated surface, beacon hairline, soft glow). */}
            <div
              className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/70 p-1.5 shadow-[0_0_70px_-50px_rgba(168,85,247,0.7)] sm:p-2"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
              }}
            >
              {/* Top-edge beacon hairline, decorative (matches the cockpit panels). */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
                }}
              />
              <div role="tablist" aria-label="Draft views" className="flex flex-wrap gap-1.5">
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
                      className={`flex min-h-11 items-center gap-1.5 rounded-card border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-0 ${
                        active
                          ? "border-brand-cyan/70 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_22px_-8px_rgba(34,211,238,0.85)]"
                          : "border-transparent bg-base/50 text-ink-muted hover:bg-surface hover:text-ink"
                      }`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      {v.label}
                    </button>
                  );
                })}
              </div>
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
                {activeBoardLoading ? (
                  <LoadingCard label="Loading the FF Beacon board..." />
                ) : activeBoardError ? (
                  <ErrorCard message={activeBoardError} />
                ) : !activeBoard || activeBoard.status === "source-unavailable" ? (
                  <EmptyCard
                    title="FF Beacon values are not set up."
                    body="Admin: the FF Beacon source row is missing from the source registry. On The Clock uses FF Beacon values for the available board."
                  />
                ) : activeBoard.status !== "ok" ? (
                  <EmptyCard
                    title={`No FF Beacon rankings for ${activeBoard.formatLabel} yet.`}
                    body="The draft board and picks still work. The available big board and values will appear once this format's FF Beacon rankings are published."
                  />
                ) : available.length === 0 ? (
                  <EmptyCard
                    title={pool === "rookies" ? "No rookies available." : "No players available."}
                    body={
                      pool === "rookies"
                        ? "We could not find ranked first-year players in FF Beacon for this format yet. Check back once rookie values are published."
                        : "Every ranked player in this pool has been drafted."
                    }
                  />
                ) : (
                  <AvailableList
                    players={available}
                    adpThreshold={adpThreshold}
                    adpAvailable={Boolean(activeBoard?.adpFormatKey)}
                  />
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
                <>
                  {/* Rows 1 and 2 stay within the container; only the board (Row 3)
                      breaks out to the full viewport width. */}
                  {/* Row 1: room status (1/3) beside best remaining (2/3, two-column). */}
                  <div className="mb-5 grid gap-5 lg:grid-cols-3">
                    <div className="lg:col-span-1">
                      <DraftRoomStatus
                        draft={draftCache.draft}
                        onTheClockTeam={onTheClockTeam}
                        onTheClockRound={derived.onTheClockRound}
                        onTheClockPickInRound={derived.onTheClockPickInRound}
                        onTheClockOverallPickNo={derived.onTheClockPickNo}
                        isYourTurn={isYourTurn}
                        lastPickLabel={lastPickLabelFor(derived.lastPick)}
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <BestRemainingByPosition players={available} columns={2} />
                    </div>
                  </div>

                  {/* Row 2: the connected user's roster, same layout as the Rosters tab
                      (every position shown even when empty; future picks with show-more). */}
                  <div className="mb-5">
                    <Panel eyebrow="Your team" title="Your draft">
                      {myBoardRollup ? (
                        <TeamPositionGrid team={myBoardRollup} />
                      ) : (
                        <EmptyCard
                          title={
                            tradeReady
                              ? "We could not detect your team yet."
                              : "FF Beacon values are loading."
                          }
                          body={
                            tradeReady
                              ? "Make a pick or check your Sleeper username, and your roster will appear here by position with your future picks."
                              : "Your roster will appear here once this format's FF Beacon values load."
                          }
                        />
                      )}
                    </Panel>
                  </div>

                  {/* Row 3: the board, broken out to the full viewport width. */}
                  <div className="relative left-1/2 w-screen -translate-x-1/2 px-6 sm:px-8 lg:px-10">
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
                        adpBySleeperId={adpBySleeperId}
                        adpThreshold={adpThreshold}
                      />
                    </Panel>
                  </div>
                </>
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
                    adpBySleeperId={adpBySleeperId}
                    adpThreshold={adpThreshold}
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

            {/* View: Trade History (mini Signal Check per trade; keeps the right rail) */}
            <div
              role="tabpanel"
              id="otc-view-history"
              aria-labelledby="otc-tab-history"
              tabIndex={0}
              hidden={view !== "history"}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <TradeHistory
                transactions={tradeHistory ?? []}
                context={tradeHistoryContext}
                loading={tradeHistoryLoading}
                error={tradeHistoryError}
                boardReady={tradeReady}
                formatLabel={formatLabel}
                truncated={tradeHistoryTruncated}
                onRefresh={() => {
                  // Snapshot mode never refetches: the trades are frozen.
                  if (league && !snapshotMode) void loadTradeHistory(league.leagueId);
                }}
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

            {/* View: Rankings & Awards (live awards + condensed power rankings table) */}
            <div
              role="tabpanel"
              id="otc-view-rankings"
              aria-labelledby="otc-tab-rankings"
              tabIndex={0}
              hidden={view !== "rankings"}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <RankingsAwards
                awards={awards}
                teams={teamRollups}
                myRosterId={derived.myRosterId}
                boardReady={tradeReady}
                tradesLoading={tradeHistoryLoading}
                tradesError={tradeHistoryError}
                onRetryTrades={() => {
                  if (league && !snapshotMode) void loadTradeHistory(league.leagueId);
                }}
              />
            </div>
          </div>

          {/* ---- Persistent right rail (hidden on the full-width Rosters tab and on
              the full-width board view, where the panels move to a top bar) ---- */}
          {view !== "rosters" && !boardFull && (
            <aside aria-label="Draft room panels" className="space-y-5 xl:sticky xl:top-32 xl:self-start">
              {sidebarPanels}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Plain-language provenance line for the command bar's snapshot-mode banner.
 * Timestamps render in Eastern time per the site-wide display rule. The ADP
 * partition date is anchored to UTC noon before formatting so a date-only value
 * cannot roll back a day in Eastern time.
 */
function buildSnapshotNotice(s: DraftSnapshotPayload): string {
  const bits: string[] = [`Locked ${formatEastern(s.finalizedAt)}.`];
  if (s.valueSnapshotDate) {
    bits.push(`FF Beacon values from ${formatEasternDate(s.valueSnapshotDate)}.`);
  }
  if (s.adpSnapshotDate) {
    bits.push(`Sleeper ADP from ${formatEasternDate(`${s.adpSnapshotDate}T12:00:00.000Z`)}.`);
  }
  if (s.confidence === "low") {
    bits.push(
      "Historical data was limited, so these results are estimated from the nearest available snapshots.",
    );
  } else if (
    s.valueSnapshotSource === "next_available" ||
    s.adpSnapshotSource === "next_available"
  ) {
    bits.push("Some inputs use the nearest snapshot after the draft finished (estimated).");
  }
  return bits.join(" ");
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
