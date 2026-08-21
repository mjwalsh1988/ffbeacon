"use client";

/**
 * Client root for the On The Clock draft cockpit.
 *
 * PHASE 5 (live data wiring). The draft DATA flow is now live:
 *   - connect -> GET /api/on-the-clock/leagues (no Sleeper from the client),
 *   - select a league -> GET /api/on-the-clock/draft?draft_id= (warm read; the
 *     server warms a cold cache once through the durable lock),
 *   - Sync draft -> POST /api/on-the-clock/draft/sync (server-enforced cooldown),
 *   - an open room ALSO refreshes itself on the draft's shared auto interval
 *     (lib/on-the-clock/use-draft-sync.ts), which claims the same durable lock, so
 *     a dozen tabs on one draft still produce one Sleeper fetch a minute between
 *     them. It stops the moment the draft reports complete,
 *   - Supabase Realtime on on_the_clock_pick_cache merges co-viewer picks with NO
 *     Sleeper call.
 * The draft board, pick list, My Draft, on-the-clock status, and connected-team
 * detection all read from the live shaped cache.
 *
 * LIVE (Phase 6A/6B/6C): the available Big Board, Best remaining by position, BOTH
 * recommendation cards (Best Available = pure value; Team Need = value-aware roster
 * need via lib/on-the-clock/recommend.ts), AND the Trade Builder (pool-aware value
 * check via lib/on-the-clock/trade-analyzer.ts; pick values projected from the
 * board and flagged estimated). No mock panels remain.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Gauge, LayoutGrid, List, WifiOff } from "lucide-react";
import type {
  BuildMode,
  LeagueCard,
  OnTheClockSettings,
  PlayerPool,
  ShapedDraftCache,
  ShapedPick,
  SyncStatus,
} from "@/lib/on-the-clock/types";
import type { BoardResult, DraftPosition, RankedPlayer } from "@/lib/on-the-clock/board-types";
import type { SimulatedPick } from "@/lib/on-the-clock/adp-sim";
import type { TeamRollup } from "@/lib/on-the-clock/rosters";
import type { Award } from "@/lib/on-the-clock/awards";
import type { DraftGrade } from "@/lib/on-the-clock/draft-grade";
import type { PickSurplus } from "@/lib/on-the-clock/surplus";
import type { PassedOn } from "@/lib/on-the-clock/draft-recap";
import type { TradeItemGroup } from "@/lib/on-the-clock/trade-analyzer";
import type { CurrentDraftPick } from "@/lib/on-the-clock/pick-ownership";
import type { DraftSnapshotPayload } from "@/lib/on-the-clock/snapshot-types";
import { recommend } from "@/lib/on-the-clock/recommend";
import {
  buildCaveat,
  buildRationale,
  type RationaleInput,
  type RationalePoint,
  type SeasonFinish,
} from "@/lib/on-the-clock/rationale";
import { createClient } from "@/lib/supabase/client";
import {
  useDraftSync,
  type SyncBlockedReason,
  type SyncRunner,
} from "@/lib/on-the-clock/use-draft-sync";
import {
  fetchLeagues,
  fetchDraft,
  syncDraft,
  fetchBoard,
  fetchSnapshot,
  fetchTransactions,
  fetchPulse,
  fetchPlayerBrief,
  type OtcPulsePayload,
} from "@/lib/on-the-clock/client";
import type { PulsePlayerSummary } from "@/lib/on-the-clock/pulse-types";
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
  sameDraftCacheContent,
} from "@/lib/on-the-clock/draft-derive";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { buildTradeCatalog } from "@/lib/on-the-clock/trade-analyzer";
import { buildTeamRollups } from "@/lib/on-the-clock/rosters";
import { computeDraftAwards } from "@/lib/on-the-clock/awards";
import { computeDraftGrades } from "@/lib/on-the-clock/draft-grade";
import { buildMarketCurve, computePickSurplus } from "@/lib/on-the-clock/surplus";
import { tradeMarginsFor } from "@/lib/on-the-clock/trade-margins";
import {
  goneBefore,
  nextPickForRoster,
  simulateRemainingDraft,
  survivorsAt,
} from "@/lib/on-the-clock/adp-sim";
import { detectRun, detectTierCliffs, turnAlert } from "@/lib/on-the-clock/draft-alerts";
import type { GoneBeforeEntry } from "@/lib/on-the-clock/draft-alerts";
import { buildRecapText, computePassedOn } from "@/lib/on-the-clock/draft-recap";
import type { ResolveContext } from "@/lib/on-the-clock/trade-assets";
import { buildPickValueLookup, lookupPickValue } from "@/lib/on-the-clock/trade-analyzer";
import {
  normalizeTradedPicks,
  resolveCurrentDraftPicks,
  resolveTradedFuturePicks,
} from "@/lib/on-the-clock/pick-ownership";
import { useStepScroll } from "@/lib/use-step-scroll";
import { DraftRoomRail, type DraftRailView } from "./draft-room-rail";
import { DraftViewSheet } from "./draft-view-sheet";
import { UsernameGate } from "./username-gate";
import { LeaguePicker } from "./league-picker";
import { PoolNotice, markPoolNoticeSeen, poolNoticeSeen } from "./pool-notice";
import { ReportFormatDialog, type FormatReportContext } from "./report-format-dialog";
import { StepRail } from "./step-rail";
import { CommandHeader } from "./command-header";
import { PlayerSpotlight, type SpotlightExtras } from "./player-spotlight";
import { SidebarSheet } from "./sidebar-sheet";
import { Panel } from "./panel";
import { DraftRoomStatus, BestRemainingByPosition } from "./dashboard-panels";
import { AvailableList } from "./available-list";
import { DraftBoard } from "./draft-board";
import { PickList } from "./pick-list";
import { MyDraft } from "./my-draft";
import { TradeAnalyzer } from "./trade-analyzer";
import { RostersRankings } from "./rosters-rankings";
import { RankingsAwards } from "./rankings-awards";
import { DraftPulseBoard } from "./draft-pulse-board";
import type { DraftPulseTeam } from "@/lib/on-the-clock/draft-pulse";
import { DraftGrades } from "./draft-grades";
import { DraftAlertAnnouncer, DraftRadar } from "./draft-radar";
import { BuildModeSelector, BuildModeNotice } from "./build-mode-selector";
import { PassedOnPanel, RecapBox, RoomSummary } from "./draft-extras";
import { readBuildMode, writeBuildMode, readWatchlist, writeWatchlist } from "./draft-prefs";
import { TradeHistory } from "./trade-history";
import { LoadingCard, ErrorCard, EmptyCard } from "./states";

/**
 * A pulse payload with its per-player map filled back in.
 *
 * The wire type allows `players: null`, which means "you already have this
 * exact map". Every consumer in the room wants the map, so the fetch effect
 * restores it from the ref and nothing below has to know the difference.
 */
type ResolvedPulse = Omit<OtcPulsePayload, "players"> & {
  players: Record<string, PulsePlayerSummary>;
};

type Step = "connect" | "pick-league" | "room";

/**
 * The cockpit shell that both pre-room steps render inside. Named so the step
 * change can land the reader on the step itself rather than on the hero above
 * it. Only one of the two is ever mounted, so the id stays unique.
 */
const STEP_PANEL_ID = "otc-step-panel";

/**
 * The draft room shell. The room opens at the top of the page, but focus has to
 * land on the room itself: the page top is the site header, and a screen reader
 * left there hears nothing about the draft that just opened.
 */
const ROOM_ID = "otc-draft-room";
type View =
  | "pick"
  | "drafted"
  | "rosters"
  | "pulse"
  | "history"
  | "trade"
  | "rankings"
  | "grades";
type DraftedMode = "board" | "list";
type LiveStatus = "off" | "connecting" | "live" | "unavailable";

/**
 * The eight views of the draft room, in rail order. They live in the site
 * navigation rail rather than in a strip across the room; see draft-room-rail.tsx
 * for why they switch in place instead of navigating.
 *
 * The hint is what the navigation drawer paints under each label and what every
 * rail row carries in its accessible name, so each one says what the view
 * answers rather than restating its title.
 */
const VIEWS: ReadonlyArray<DraftRailView<View>> = [
  { id: "pick", label: "Who to pick", hint: "Your next pick, and why", icon: "target" },
  { id: "drafted", label: "Board", hint: "Every pick so far", icon: "listChecks" },
  { id: "rosters", label: "Rosters", hint: "What each team has taken", icon: "users" },
  { id: "pulse", label: "Draft Pulse", hint: "How each roster is shaping up", icon: "gauge" },
  { id: "history", label: "Trades", hint: "Picks and players that changed hands", icon: "history" },
  { id: "trade", label: "Trade Builder", hint: "Price a deal before you offer it", icon: "swap" },
  { id: "rankings", label: "Awards", hint: "Standouts of the draft so far", icon: "trophy" },
  { id: "grades", label: "Grades", hint: "How every team drafted", icon: "graduationCap" },
];

/** Label for one view, for the heading that names the region it renders into. */
const VIEW_LABELS = Object.fromEntries(VIEWS.map((v) => [v.id, v.label])) as Record<
  View,
  string
>;

// Frozen empties, shared by reference. A fresh [] or new Map() every render is
// what defeats a child's useMemo, which is the whole point of the block below.
/**
 * The width at which the side rail gets its own column. Below it the rail's
 * panels move into the bottom sheet. Kept in one place so the media query and
 * the `xl:hidden` classes on the sheet can never drift apart.
 */
const RAIL_QUERY = "(min-width: 1280px)";

/** Whether the reader has asked for less motion, for the view-switch scroll. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const NO_PLAYERS: RankedPlayer[] = [];
const NO_PICKS: ShapedPick[] = [];
const NO_CURRENT_PICKS: CurrentDraftPick[] = [];
const NO_SIMULATION: Map<number, SimulatedPick> = new Map();
const NO_GONE: GoneBeforeEntry[] = [];
const NO_ROLLUPS: TeamRollup[] = [];
const NO_AWARDS: Award[] = [];
const NO_GRADES: DraftGrade[] = [];
const NO_SURPLUS: PickSurplus[] = [];
const NO_PASSED_ON: PassedOn[] = [];
const NO_TRADE_GROUPS: TradeItemGroup[] = [];
const NO_PULSE_TEAMS: DraftPulseTeam[] = [];

/**
 * The views that read the league's trade feed. A refresh only refetches it while
 * one of them is open, because that feed is its own Sleeper fan-out (a walk of
 * the weekly transaction endpoints) rather than a field on the draft cache.
 */
const VIEWS_READING_TRADES: ReadonlySet<View> = new Set<View>(["history", "rankings", "grades"]);

/**
 * The floor between two refetches of the trade feed.
 *
 * Deliberately longer than the automatic refresh interval. This feed is the most
 * expensive thing the room can ask for: the server walks Sleeper's transaction
 * endpoint week by week, up to twenty-six times, and there is no shared per-league
 * claim in front of it the way there is for the draft, so every viewer parked on
 * a trades view pays for their own walk. Trades during a draft are rare enough
 * that a couple of minutes costs nothing, and the tab carries its own Refresh
 * control for anyone who wants it sooner.
 */
const TRADE_HISTORY_MIN_REFRESH_MS = 2 * 60_000;

/**
 * How stale the FF Beacon board may get inside a room that stays open.
 *
 * A day, because that is how often the numbers on it actually change. Every table
 * behind this board is written by a nightly cron and by nothing else: rankings and
 * player_value_trends by recalculate-derived, player_value_history by the value
 * syncs, player_market_snapshots by sync-sleeper-market, draft_pick_values and
 * draft_value_targets by rebuild-draft-value. The whole chain lands between 3am
 * and 11am Eastern and then nothing moves until the next one. Refetching a board
 * of six hundred players through the afternoon could only ever return the bytes
 * already on screen.
 *
 * Note what this is NOT about. Who is still available updates on every single
 * refresh, because that is the board minus the picks in the draft cache, and the
 * picks are what a sync brings back. This constant governs the underlying values
 * and ADP alone.
 *
 * Worth keeping rather than deleting, because slow dynasty drafts on Sleeper run
 * for days on eight-hour pick clocks, and a room left open through one of those
 * would otherwise price every remaining pick off values from whenever it was
 * opened.
 */
const BOARD_MIN_REFRESH_MS = 24 * 60 * 60_000;

/** Coerce a Sleeper pick/roster position string to one of the six draft buckets. */
function coercePosition(pos: string | null): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

export function OnTheClockClient({
  masthead,
  defaultSeason,
  defaultUsername = "",
  realtimeEnabled = true,
  autoRefreshEnabled = true,
  autoRefreshSeconds = 60,
  settings,
}: {
  /**
   * The page hero, rendered on the server and handed in so this component can
   * decide when it belongs. Every step before a draft is open shows it; the
   * room does not, because a drafter reading the board under a clock does not
   * need marketing copy above it, and the room already names itself.
   */
  masthead: ReactNode;
  defaultSeason: string;
  defaultUsername?: string;
  realtimeEnabled?: boolean;
  /** Whether an open room refreshes itself without anyone pressing Sync. */
  autoRefreshEnabled?: boolean;
  /** The room's shared automatic refresh interval, in seconds. */
  autoRefreshSeconds?: number;
  /** Admin On The Clock settings (drives the Team Need engine). */
  settings: OnTheClockSettings;
}) {
  // ----- flow -----
  const [step, setStep] = useState<Step>("connect");
  // Each step replaces the whole page, but the URL never changes, so nothing
  // moves the scroll position on its own. Picking a league from the bottom of
  // a long list used to open the draft room already scrolled halfway down it.
  //
  // Where a step lands depends on what the step is. The draft room is a new
  // place, so it opens at the top and is read downward. The two steps before
  // it are the wizard answering a question: someone who just typed a Sleeper
  // username wants their leagues, not the hero above the form they have
  // finished with, so those land on the step panel itself.
  useStepScroll(
    step,
    step === "room" ? { focusId: ROOM_ID } : { id: STEP_PANEL_ID },
  );

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

  // ----- "report incorrect format" dialog (opened from the pool notice) -----
  const [reportOpen, setReportOpen] = useState(false);

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
  // The two countdowns are NOT state here. useDraftSync hands out the instants
  // they run to, and the panel that shows them does its own ticking, so a room
  // with a live board does not re-render once a second to move a number.
  const [syncMessage, setSyncMessage] = useState("Not synced yet");
  // The cache exactly as it stands on screen, mirrored into a ref, so the sync
  // runner can compare against it without being rebuilt every time a pick lands.
  // Realtime advances the same cache between syncs, so reading it from the last
  // response would be wrong.
  const cacheRef = useRef<ShapedDraftCache | null>(null);
  // The stamp of the newest sync this room has HEARD ABOUT, which is not the same
  // as the stamp on the cache it is rendering. When a refresh comes back byte for
  // byte identical the cache object is deliberately left alone (see runSync), so
  // the stamp has to live somewhere the render does not touch. It is what tells
  // the server it can skip resending a board we already have.
  const lastSyncedAtRef = useRef<string | null>(null);
  // When the board and the league's trade feed were last fetched, so a refresh
  // can leave alone what cannot have changed. Both reset with the league.
  const boardLoadedAt = useRef(0);
  const tradeHistoryLoadedAt = useRef(0);
  // The draft whose snapshot has already been requested, so the completion
  // handoff fires once rather than on every refresh after the draft ends.
  const snapshotRequestedFor = useRef<string | null>(null);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  // ----- realtime -----
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(realtimeEnabled ? "connecting" : "off");

  // ----- Draft Pulse + projections (lazy; never blocks the room) -----
  const [pulse, setPulse] = useState<ResolvedPulse | null>(null);
  const [pulseLoading, setPulseLoading] = useState(false);
  // The per-player projection map is ~43 KB and identical for a whole draft, so
  // it is held here and its fingerprint is sent on the next request. The server
  // then omits the map, and this ref supplies it. Cleared with the league.
  const boardEtagRef = useRef<string | null>(null);
  const playersRef = useRef<Record<string, PulsePlayerSummary>>({});
  // A signature of everything that would change the answer, so we refetch when a
  // pick lands or the board finishes loading, and NOT on every unrelated
  // re-render (realtime fires one per pick). Keying on the pick count alone was
  // wrong: the first fetch fires before the board arrives, with an empty
  // candidate list, and the pick count has not moved by the time it does, so the
  // marginal half would never load at all.
  const pulseSignature = useRef<string>("");

  // ----- build mode + watchlist (per draft, in localStorage) -----
  const [buildMode, setBuildMode] = useState<BuildMode>(settings.buildMode.defaultMode);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [rosterSort, setRosterSort] = useState<"value" | "pulse">("value");

  // ----- view -----
  // (the player pool is DERIVED, not state: see inferPlayerPool below)
  const [view, setView] = useState<View>("pick");

  /**
   * Switch view from the navigation rail.
   *
   * The rail sits a long way from the room, so a press has to take the reader
   * with it. The view's region gets focus, which is what tells a screen reader
   * that something changed and gives it a labelled place to start reading, and
   * it is scrolled to the top of the room so a sighted drafter is not left
   * looking at the page header. The old strip needed neither: it sat directly
   * above the panel it switched, and the tab-to-panel relationship carried the
   * announcement.
   *
   * The move runs in an effect keyed on the view rather than in a frame
   * scheduled beside `setView`, so it cannot run against a DOM where the target
   * region is still `hidden`. A `hidden` element cannot take focus and cannot
   * be scrolled to, and both calls would fail silently.
   *
   * `preventScroll` on the focus call, then an explicit scroll, so the region's
   * scroll-margin is honoured and the site header does not cover what we just
   * moved to.
   */
  const pendingViewFocus = useRef<View | null>(null);

  const selectView = useCallback((id: View) => {
    pendingViewFocus.current = id;
    setView(id);
  }, []);

  useEffect(() => {
    if (pendingViewFocus.current !== view) return;
    pendingViewFocus.current = null;
    const region = document.getElementById(`otc-view-${view}`);
    if (!region) return;
    region.focus({ preventScroll: true });
    region.scrollIntoView({
      block: "start",
      behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches ? "auto" : "smooth",
    });
  }, [view]);
  const [draftedMode, setDraftedMode] = useState<DraftedMode>("board");

  // ---------------------------------------------------------------------------
  // Derived room state.
  //
  // All of this used to run in the render body, so a single realtime pick rebuilt
  // a 600-element board, re-sorted it, re-ran the recommendation engine and the
  // ADP simulation, whatever tab the user was actually looking at. The fresh
  // arrays also meant the useMemo inside available-list.tsx never hit, so the
  // list re-sorted on every pick as well.
  //
  // It lives up here because hooks cannot be declared below the step-based early
  // returns, and because the Draft Pulse effect fires from the same values.
  // ---------------------------------------------------------------------------

  // Completed draft with a finalized snapshot: everything renders from the frozen
  // payload (board, cache, trades, awards); nothing recalculates from current
  // values. Active drafts stay fully live.
  const snapshotMode = snapshot !== null;

  // The draft has ended. Nothing on Sleeper can change from here, so the room
  // stops refreshing itself the moment it sees this, without waiting for the
  // snapshot to finish locking.
  const draftComplete = cache?.draft.draftStatus === "complete";

  // ----- the room's sync clock -----
  //
  // Declared up here because selectLeague and loadDraft both drive it, and hooks
  // cannot be declared below them. The runner it calls needs the loaders, which
  // are three hundred lines further down, so it reaches them through this ref
  // rather than by reordering the file around one callback.
  const runSyncRef = useRef<SyncRunner>(async () => null);
  const runSyncStable = useCallback<SyncRunner>((trigger) => runSyncRef.current(trigger), []);

  // Seeded from the server render and then kept current by every response, so a
  // room that has been open since before the owner changed the interval follows
  // the new one instead of describing the old.
  const [autoSeconds, setAutoSeconds] = useState(autoRefreshSeconds);

  // A press that could not run says why. It is the one moment the exact wait is
  // worth speaking, which is why the button carries no state that announces
  // itself as the shared window opens and closes on its own.
  const onSyncBlocked = useCallback((reason: SyncBlockedReason) => {
    setSyncMessage(
      reason.kind === "syncing"
        ? "Already syncing. The room will update in a moment."
        : `Just refreshed. Sync is available again in ${reason.seconds} ${
            reason.seconds === 1 ? "second" : "seconds"
          }.`,
    );
  }, []);

  const syncClock = useDraftSync({
    active: step === "room" && league !== null && !snapshotMode && !draftComplete,
    autoEnabled: autoRefreshEnabled,
    autoRefreshSeconds: autoSeconds,
    runSync: runSyncStable,
    onBlocked: onSyncBlocked,
  });
  // Both are stable for the life of the room; pulled out so the callbacks that
  // depend on them are not rebuilt on every render of a live board.
  const { noteAttempt: noteSyncAttempt, reset: resetSyncClock } = syncClock;

  /**
   * Below xl the layout has no second column, so the side rail moves into a
   * bottom sheet behind a bar at the top of the content column.
   *
   * This is a real media query rather than a `hidden xl:block` class because
   * the panels have to be rendered in exactly ONE place: several of them carry
   * fixed DOM ids, and `display:none` leaves the duplicates in the document
   * where they break every aria-labelledby that points at them.
   *
   * Reading matchMedia in the initializer is safe here even though this is a
   * client component Next also renders on the server. The room never reaches
   * the server HTML: `step` starts at "connect" and the rail lives behind two
   * early returns, so the server and the first client render agree on the
   * markup whatever this value is.
   */
  const [railInSheet, setRailInSheet] = useState(
    () => typeof window !== "undefined" && !window.matchMedia(RAIL_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(RAIL_QUERY);
    const apply = () => setRailInSheet(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ADP neutral band, in picks. Declared up here rather than beside the render
  // because the spotlight rationale (a hook, below) needs it too, and hooks
  // cannot read a value declared under the step-based early returns.
  //
  // Snapshot mode uses the threshold the draft was GRADED with (frozen at
  // finalize), so a later admin tuning can never change a finalized draft's
  // icons or verdicts; live mode uses the current setting.
  const adpThreshold = snapshot !== null
    ? snapshot.thresholdPicks
    : settings.valueIndicators.thresholdPicks;

  const activeBoard: BoardResult | null = useMemo(() => {
    if (!snapshot) return board;
    return {
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
    };
  }, [snapshot, board]);

  const derivedState = useMemo(
    () => (cache ? deriveDraftState(cache, myUserId) : null),
    [cache, myUserId],
  );

  // The player pool is inferred, never toggled: the snapshot's recorded pool in
  // snapshot mode, else league type + round count (see inferPlayerPool).
  const draftRounds = Number(cache?.draft.settings.rounds ?? 0);
  const pool: PlayerPool = snapshot
    ? snapshot.playerPool
    : inferPlayerPool({ formatSlug: league?.formatSlug, rounds: draftRounds });

  const rawBoardPlayers = activeBoard?.status === "ok" ? activeBoard.players : NO_PLAYERS;
  const picks = cache?.picks ?? NO_PICKS;

  // Attach the projection summary to every board player that has one. A player
  // without one keeps undefined rather than zero, so every consumer can tell
  // "no opinion" from "projected to score nothing".
  const boardPlayers = useMemo(() => {
    if (!pulse) return rawBoardPlayers;
    return rawBoardPlayers.map((p) => {
      const proj = pulse.players[p.playerId];
      if (!proj) return p;
      return {
        ...p,
        projPointsPerWeek: proj.ppw,
        projSeasonPoints: proj.sp,
        beatRate: proj.br,
        availability: proj.av,
        accuracyWeeks: proj.wp,
      };
    });
  }, [rawBoardPlayers, pulse]);

  // Real available board (FF Beacon): ranked players minus drafted, filtered to
  // the pool. Empty until the per-league board (or snapshot) finishes loading.
  const available = useMemo(
    () => filterPool(excludeDrafted(boardPlayers, picks), pool),
    [boardPlayers, picks, pool],
  );

  // Sleeper player id -> ADP, from the board rows (live: latest snapshot; frozen:
  // the snapshot resolved for the draft's completion time).
  //
  // Keyed on the RAW board, not the projection-merged one. ADP cannot change
  // during a draft, but boardPlayers gets a new identity every time a pulse
  // response lands, and this map is a prop to both DraftBoard and PickList, so
  // keying it on boardPlayers handed those two a new object several times a pick
  // and defeated the memo on the board for a value that never moved.
  const adpBySleeperId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pl of rawBoardPlayers) {
      if (pl.sleeperId && typeof pl.adp === "number") map[pl.sleeperId] = pl.adp;
    }
    return map;
  }, [rawBoardPlayers]);

  // Projection summaries keyed for the recommendation's reason copy and its
  // compete tilt. Hoisted out of the rec memo, which rebuilt 600 small objects
  // every time it ran.
  const projectionsForRec = useMemo(
    () =>
      pulse
        ? Object.fromEntries(
            Object.entries(pulse.players).map(([id, p]) => [id, { ppw: p.ppw, br: p.br }]),
          )
        : null,
    [pulse],
  );

  const detectedFormatSlug = activeBoard?.formatSlug ?? league?.formatSlug ?? "";
  const isDynasty = /dynasty/i.test(detectedFormatSlug);
  const tradeReady = activeBoard?.status === "ok";

  // The build-mode question is only real in a DYNASTY STARTUP. A redraft team is
  // competing by definition, and a rookie draft sits on top of a team whose
  // direction was set long before this room opened, so both are forced rather
  // than asked. See the plan's answer to question 4.
  const isStartup = pool === "everyone";
  const modeSelectable = settings.buildMode.enabled && isDynasty && isStartup;
  const effectiveMode: BuildMode = modeSelectable ? buildMode : isDynasty ? "balanced" : "compete";

  // Transaction-aware pick ownership: every current-draft pick (any owner) plus
  // concrete traded future picks, resolved from the cached Sleeper traded_picks.
  const tradeSeason = Number(league?.season ?? cache?.draft.season ?? 0) || 0;
  const tradedPicks = useMemo(
    () => normalizeTradedPicks(cache?.tradedPicks ?? null),
    [cache?.tradedPicks],
  );
  const currentPicks = useMemo(() => {
    if (!cache) return NO_CURRENT_PICKS;
    return resolveCurrentDraftPicks({
      teams: Number(cache.draft.settings.teams ?? 0),
      rounds: Number(cache.draft.settings.rounds ?? 0),
      shape: draftShapeFromMeta(cache.draft),
      slotToRosterId: cache.draft.slotToRosterId,
      madePicks: cache.picks,
      tradedPicks,
      currentSeason: tradeSeason,
    });
  }, [cache, tradedPicks, tradeSeason]);
  const tradedFuturePicks = useMemo(
    () => resolveTradedFuturePicks(tradedPicks, tradeSeason),
    [tradedPicks, tradeSeason],
  );

  // roster_id -> the several names the room needs. Built once and passed down by
  // reference, so a child that memoizes on them actually gets a hit.
  const rosterNames = useMemo(() => {
    // Board and trade labels use the owner's Sleeper display name.
    const teamNameByRosterId: Record<number, string> = {};
    // Rosters & Rankings leads with the username and puts the custom team name
    // after it, so those get their own maps rather than changing the labels above.
    const rollupOwnerNameByRosterId: Record<number, string> = {};
    const rollupTeamNameByRosterId: Record<number, string | null> = {};
    // Owner Sleeper avatar id, used by the award cards. Null when unset.
    const avatarByRosterId: Record<number, string | null> = {};
    for (const r of cache?.rosters ?? []) {
      const user = r.ownerId ? cache?.users.find((u) => u.userId === r.ownerId) : undefined;
      teamNameByRosterId[r.rosterId] = user?.displayName ?? `Team ${r.rosterId}`;
      rollupOwnerNameByRosterId[r.rosterId] =
        user?.displayName || user?.username || `Team ${r.rosterId}`;
      rollupTeamNameByRosterId[r.rosterId] = user?.teamName ?? null;
      avatarByRosterId[r.rosterId] = user?.avatar ?? null;
    }
    return {
      teamNameByRosterId,
      rollupOwnerNameByRosterId,
      rollupTeamNameByRosterId,
      avatarByRosterId,
    };
  }, [cache?.rosters, cache?.users]);

  // The ADP simulation, run ONCE. It answers three questions at the same time:
  // which players the market takes before the user is back on the clock (the
  // radar), which will still be there (the dropoff term in Team Need), and who
  // would be taken at an unmade pick (the trade builder). One simulation, three
  // consumers, no chance of them disagreeing.
  const onTheClockPickNo = derivedState?.onTheClockPickNo ?? 0;
  const simulatedRemaining = useMemo(
    () =>
      tradeReady
        ? simulateRemainingDraft({ available, currentPicks, onTheClockPickNo })
        : NO_SIMULATION,
    [tradeReady, available, currentPicks, onTheClockPickNo],
  );

  const myNextPick = useMemo(
    () => nextPickForRoster(currentPicks, derivedState?.myRosterId ?? null, onTheClockPickNo || 1),
    [currentPicks, derivedState?.myRosterId, onTheClockPickNo],
  );

  // Everything the Draft Pulse call and the draft radar need, derived once.
  const pulseInputs = useMemo(
    () =>
      derivePulseInputs({
        cache,
        derivedState,
        available,
        simulated: simulatedRemaining,
        myNextPick,
        pool,
        // The room's own isDynasty, not a second derivation. This used to test
        // the league card's slug while everything else tested the BOARD's, so a
        // closest-match format that crossed the redraft/dynasty line told the
        // server to score a team without its existing roster while Team Need
        // counted it.
        isDynastyFormat: isDynasty,
        settings,
      }),
    [cache, derivedState, available, simulatedRemaining, myNextPick, pool, isDynasty, settings],
  );

  const picksUntilNext = pulseInputs?.picksUntilNext ?? null;

  // Names for the roster the recommendation is FOR, so the copy can say who a
  // pick would displace. The available board cannot supply them: a displaced
  // starter is already drafted and therefore off it.
  //
  // Hoisted out of the recommendation memo because the spotlight rationale needs
  // the same map to name a displaced starter, and building it twice would let
  // the two disagree.
  const myRosterNames = useMemo(() => {
    const names: Record<string, string> = {};
    if (!cache || derivedState?.myRosterId === null || derivedState === null) return names;
    for (const pk of cache.picks) {
      if (pk.rosterId !== null && pk.rosterId === derivedState.myRosterId && pk.playerId) {
        names[pk.playerId] = `${pk.firstName ?? ""} ${pk.lastName ?? ""}`.trim() || "a starter";
      }
    }
    return names;
  }, [cache, derivedState]);

  // The recommendation engine (Best Available = pure value, Team Need =
  // value-aware roster need). Null only while the room has no cache, which is
  // the state the early return below already handles.
  const rec = useMemo(() => {
    if (!cache || !derivedState) return null;

    // My in-draft picks -> positions.
    const myDraftedPositions = cache.picks
      .filter(
        (p) =>
          (myUserId !== null && p.pickedBy === myUserId) ||
          (derivedState.mySlot > 0 && p.draftSlot === derivedState.mySlot),
      )
      .map((p) => coercePosition(p.position))
      .filter((p): p is DraftPosition => p !== null);

    // Pre-draft roster (dynasty only) -> positions, mapped from the board by
    // Sleeper id.
    let seededPositions: DraftPosition[] = [];
    if (isDynasty && derivedState.myRosterId !== null) {
      const myRoster = cache.rosters.find((r) => r.rosterId === derivedState.myRosterId);
      if (myRoster) {
        const posBySleeperId = new Map<string, DraftPosition>();
        for (const pl of boardPlayers) if (pl.sleeperId) posBySleeperId.set(pl.sleeperId, pl.position);
        seededPositions = myRoster.players
          .map((id) => posBySleeperId.get(id) ?? null)
          .filter((p): p is DraftPosition => p !== null);
      }
    }

    return recommend({
      available,
      pool,
      formatSlug: detectedFormatSlug,
      formatLabel: activeBoard?.formatLabel ?? league?.formatLabel ?? "",
      draftSettings: cache.draft.settings,
      rosterPositions: cache.draft.rosterPositions,
      myDraftedPositions,
      seededPositions,
      rosterKnown:
        derivedState.mySlot > 0 || myDraftedPositions.length > 0 || seededPositions.length > 0,
      currentRound: derivedState.onTheClockRound,
      settings,
      mode: effectiveMode,
      marginal: pulse?.marginal ?? null,
      projections: projectionsForRec,
      picksUntilNext,
      myRosterNames,
    });
  }, [
    cache,
    derivedState,
    myUserId,
    isDynasty,
    boardPlayers,
    available,
    pool,
    detectedFormatSlug,
    activeBoard?.formatLabel,
    league?.formatLabel,
    settings,
    effectiveMode,
    pulse,
    projectionsForRec,
    picksUntilNext,
    myRosterNames,
  ]);

  // -------------------------------------------------------------------------
  // Spotlight enrichment: season history for the two recommended players, and
  // the plain-English argument built on top of it.
  // -------------------------------------------------------------------------

  // Season finishes, keyed by "<format>|<playerId>" so switching leagues cannot
  // serve one format's scoring under another's label.
  const [finishCache, setFinishCache] = useState<Record<string, SeasonFinish[]>>({});
  const [finishScoringLabel, setFinishScoringLabel] = useState<string | undefined>(undefined);
  const [finishesLoading, setFinishesLoading] = useState(false);
  // Ids already asked about. A player with no finish rows is a real answer, so
  // this must not retry him on every re-render.
  const requestedFinishes = useRef<Set<string>>(new Set());
  // Requests still in the air. A count, not a boolean, so a fast response
  // cannot clear the flag while a slower sibling is still running.
  const finishesInFlight = useRef(0);
  // Set on the way IN as well as cleared on the way out. React Strict Mode
  // mounts, unmounts and remounts the same instance in development, so a
  // cleanup-only version left this false for the rest of the session and every
  // history response was dropped before it reached the cache.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The joined id list, so the effect below depends on the CONTENTS rather than
  // on a fresh array identity, which changes on every pick.
  const bestPlayerId = rec?.best.player?.playerId;
  const needPlayerId = rec?.need.player?.playerId;
  const spotlightIdKey = [bestPlayerId, needPlayerId === bestPlayerId ? undefined : needPlayerId]
    .filter(Boolean)
    .join(",");

  // NO per-run cancellation here, deliberately. The effect's cleanup fires when
  // the recommended players change, which happens constantly in a live draft,
  // and a run cancelled that way had already marked its ids as requested. That
  // stranded those players with no history for the rest of the session and left
  // the loading flag stuck on. A late response is harmless instead: the cache
  // is a keyed merge, so it can only ever add the right rows under the right
  // keys. The only thing worth skipping is a response that lands after unmount.
  useEffect(() => {
    if (!detectedFormatSlug) return;
    const ids = spotlightIdKey ? spotlightIdKey.split(",") : [];
    const missing = ids.filter((id) => !requestedFinishes.current.has(`${detectedFormatSlug}|${id}`));
    if (missing.length === 0) return;
    for (const id of missing) requestedFinishes.current.add(`${detectedFormatSlug}|${id}`);

    finishesInFlight.current += 1;
    setFinishesLoading(true);
    void fetchPlayerBrief(detectedFormatSlug, missing).then((res) => {
      finishesInFlight.current -= 1;
      if (!mounted.current) return;
      if (finishesInFlight.current === 0) setFinishesLoading(false);
      // History is enrichment: a failure leaves the spotlight exactly as it was
      // before this existed. Releasing the ids lets a LATER recommendation
      // change try again, and cannot loop, because this effect only re-runs when
      // the id list itself changes.
      if (!res.ok) {
        for (const id of missing) requestedFinishes.current.delete(`${detectedFormatSlug}|${id}`);
        return;
      }
      setFinishScoringLabel(res.data.scoringLabel);
      setFinishCache((prev) => {
        const next = { ...prev };
        for (const b of res.data.briefs) next[`${detectedFormatSlug}|${b.playerId}`] = b.finishes;
        return next;
      });
    });
  }, [spotlightIdKey, detectedFormatSlug]);

  // The argument for each card. Pure, and rebuilt only when something it reads
  // actually changed, because it runs on every realtime pick otherwise.
  const spotlightExtras = useMemo((): { best: SpotlightExtras; need: SpotlightExtras } => {
    const blank: SpotlightExtras = { rationale: [], caveat: null, finishes: [] };
    if (!rec) return { best: blank, need: blank };

    const openSlots = rec.positionNeeds.map((n) => n.label);
    const marginalByPlayer = pulse?.marginal?.byPlayer ?? {};

    const buildFor = (kind: "best" | "need"): SpotlightExtras => {
      const card = kind === "best" ? rec.best : rec.need;
      const player = card.player;
      if (!player) return blank;
      const marginal = marginalByPlayer[player.playerId] ?? null;
      const displacedId = marginal?.displaces?.playerId ?? null;
      const input: RationaleInput = {
        kind,
        player,
        marginal,
        mode: rec.mode,
        engine: rec.engine,
        // Whether the projection service answered AT ALL, which is a fact about
        // us. A player with no projection row inside a working service is a
        // fact about him, and the two must not share a sentence.
        projectionsAvailable: pulse !== null,
        filledSlot: card.filledSlot,
        openSlots,
        picksUntilNext,
        displacedName: displacedId ? (myRosterNames[displacedId] ?? null) : null,
        adpThreshold,
        finishes: finishCache[`${detectedFormatSlug}|${player.playerId}`] ?? [],
        // The league's real shape, not a boolean.
        //
        // `type` comes from Sleeper's own league type, NOT from the format slug.
        // The slug prices a keeper league off the redraft board, so testing it
        // would tell a keeper drafter he is in a one-year league. Falling back
        // to the slug only when no league card is in hand keeps a snapshot
        // opened without one from claiming anything it cannot know.
        //
        // superflex/tep come from the engine, which reads the league's own slot
        // model, so a SUPER_FLEX league still counts as superflex when its
        // closest FF Beacon format is a one-quarterback one.
        league: {
          type: league?.keeperStyle ?? (isDynasty ? "dynasty" : "redraft"),
          superflex: rec.superflex,
          tep: rec.tep,
        },
        rosterKnown: rec.rosterKnown,
      };
      const rationale: RationalePoint[] = buildRationale(input);
      return {
        rationale,
        caveat: buildCaveat(input),
        finishes: input.finishes,
        finishScoringLabel,
        finishesLoading:
          finishesLoading && !(`${detectedFormatSlug}|${player.playerId}` in finishCache),
      };
    };

    return { best: buildFor("best"), need: buildFor("need") };
  }, [
    rec,
    pulse,
    picksUntilNext,
    myRosterNames,
    adpThreshold,
    finishCache,
    finishScoringLabel,
    finishesLoading,
    detectedFormatSlug,
    isDynasty,
    league?.keeperStyle,
  ]);

  // Runs, tier cliffs, and the turn warning. Memoized because detectTierCliffs
  // walks the whole board and the radar is mounted on every view.
  const alerts = useMemo(
    () =>
      [
        turnAlert(picksUntilNext, myNextPick?.overall ?? null),
        detectRun(picks, {
          window: settings.alerts.runWindow,
          threshold: settings.alerts.runThreshold,
        }),
        ...(tradeReady
          ? detectTierCliffs(available, {
              remaining: settings.alerts.tierCliffRemaining,
              onTheClockPickNo,
            })
          : []),
      ]
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 5),
    [picksUntilNext, myNextPick, picks, settings.alerts, tradeReady, available, onTheClockPickNo],
  );

  const goneList = useMemo(() => {
    if (!myNextPick) return NO_GONE;
    // Indexed once. This used to spread the whole simulation into an array and
    // scan it per listed player, which is the same 400-entry walk a dozen times.
    const byPlayerId = new Map<string, SimulatedPick>();
    for (const sp of simulatedRemaining.values()) byPlayerId.set(sp.player.playerId, sp);
    return goneBefore(simulatedRemaining, myNextPick.overall)
      .slice(0, settings.alerts.maxGoneBefore)
      .map((player) => {
        const found = byPlayerId.get(player.playerId);
        return { player, atPick: found?.overall ?? 0, adpKnown: found?.adpKnown ?? false };
      });
  }, [myNextPick, simulatedRemaining, settings.alerts.maxGoneBefore]);

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
  //
  // `quiet` is the refresh a sync performs on a board the room is already
  // showing: no loading state, and a failure keeps the board that is on screen
  // rather than replacing a working list with an error. The first load of a
  // league is never quiet, because there is nothing to keep.
  const loadBoard = useCallback(
    async (card: LeagueCard, poolForAdp: PlayerPool, opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      if (activeDraftIdRef.current !== card.draftId) return;
      if (!card.formatSlug) {
        if (quiet) return;
        setBoard(null);
        setBoardError(
          "No FF Beacon format matches this league, so there is no available board.",
        );
        setBoardLoading(false);
        return;
      }
      if (!quiet) {
        setBoardLoading(true);
        setBoardError(null);
      }
      const result = await fetchBoard(card.formatSlug, poolForAdp);
      if (activeDraftIdRef.current !== card.draftId) return; // league switched away
      // Stamped on the ATTEMPT, not on success, so a board that could not load
      // gets one quiet retry per window instead of one per refresh. A retry that
      // works clears the error and the list appears where the message was.
      boardLoadedAt.current = Date.now();
      if (result.ok) {
        setBoard(result.data.board);
        setBoardError(null);
      } else if (!quiet) {
        setBoard(null);
        setBoardError(result.message);
      }
      if (!quiet) setBoardLoading(false);
    },
    [],
  );

  // ----- snapshot load (completed drafts; locked results, snapshot-first) -----
  const loadSnapshot = useCallback(
    async (card: LeagueCard, fallbackPool: PlayerPool) => {
      // Claimed immediately, so a refresh that lands while this is in flight does
      // not start a second lock of the same draft.
      snapshotRequestedFor.current = card.draftId;
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
            "We could not lock the final results yet, so these are current values. Reload later to lock them.",
          );
        } else if (result.data.reason === "no-board") {
          setSnapshotWarning(
            "No FF Beacon values for this format yet, so this draft cannot be graded.",
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
        lastSyncedAtRef.current = loaded.draft.lastSyncedAt;
        setSyncMessage(formatLastSynced(loaded.draft.lastSyncedAt, Date.now()));
        // Both countdowns start on the DRAFT's clock, not on this tab's arrival:
        // someone opening the room forty seconds into the shared window sees
        // twenty seconds left, the same as everyone already in it.
        if (result.data.autoRefreshSeconds > 0) setAutoSeconds(result.data.autoRefreshSeconds);
        noteSyncAttempt({
          manualRemainingSeconds: result.data.cooldownRemainingSeconds,
          autoRemainingSeconds: result.data.autoRemainingSeconds,
          failed: false,
          autoDisabled: !result.data.autoRefreshEnabled,
        });
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
      } else {
        setDraftError(result.ok ? "We could not load that draft." : result.message);
        // Arm the clock on the way out. selectLeague has just cleared it, and
        // without this the room that failed to open would never try again on its
        // own: no timer, no countdown, and a Sync button as the only way back.
        noteSyncAttempt({
          manualRemainingSeconds: 0,
          autoRemainingSeconds: 0,
          failed: true,
          autoDisabled: false,
        });
      }
      setDraftLoading(false);
    },
    [loadBoard, loadSnapshot, noteSyncAttempt],
  );

  // ----- trade history load (Sleeper trades for the league, server-fetched) -----
  //
  // `quiet` is the refresh a sync performs on a feed the reader is already looking
  // at. Without it the list is replaced by a loading card and its live region
  // announces the count again, once a minute, unprompted. The first load of a tab
  // and both explicit Refresh controls stay loud, because there the reader asked
  // and is waiting for an answer.
  const loadTradeHistory = useCallback(
    async (leagueId: string, opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      // Claim the league id immediately so the open-tab effect won't refire while
      // this request is in flight.
      historyLoadedFor.current = leagueId;
      if (!quiet) {
        setTradeHistoryLoading(true);
        setTradeHistoryError(null);
      }
      const result = await fetchTransactions(leagueId);
      // Stamped on the ATTEMPT, so a failing feed gets one quiet retry per window
      // rather than one per refresh.
      tradeHistoryLoadedAt.current = Date.now();
      if (result.ok) {
        setTradeHistory(result.data.transactions);
        setTradeHistoryTruncated(result.data.truncated);
        setTradeHistoryError(null);
      } else if (!quiet) {
        setTradeHistoryError(result.message);
        historyLoadedFor.current = null; // allow a retry
      }
      if (!quiet) setTradeHistoryLoading(false);
    },
    [],
  );

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
    setPulse(null);
    setPulseLoading(false);
    pulseSignature.current = "";
    boardEtagRef.current = null;
    playersRef.current = {};
    setBuildMode(readBuildMode(l.draftId, settings.buildMode.defaultMode));
    setWatchlist(readWatchlist(l.draftId));
    setRosterSort("value");
    boardLoadedAt.current = 0;
    tradeHistoryLoadedAt.current = 0;
    lastSyncedAtRef.current = null;
    snapshotRequestedFor.current = null;
    resetSyncClock();
    setSyncMessage("Loading draft...");
    setLiveStatus(realtimeEnabled ? "connecting" : "off");
    setStep("room");
    // The board (or the completed-draft snapshot) loads after the draft, once
    // the round count is known, so the inferred pool drives the ADP market.
    void loadDraft(l);
  };

  // ----- the sync runner -----
  //
  // One request, then everything the room shows that could have moved with it.
  // The draft cache is most of the room: picks, rosters, league members and
  // traded picks all arrive in it, so the big board, the pick list, My Draft, the
  // rosters view, the trade builder and the awards all follow from one setCache.
  // Draft Pulse re-fires on its own signature the moment the pick count moves.
  //
  // Two things do NOT follow from the cache, and are refreshed here:
  //   - the league's trade feed, which is a separate Sleeper fan-out across the
  //     weekly transaction endpoints, so it goes only when the room is showing a
  //     view that reads it and not twice inside one window,
  //   - the FF Beacon board, whose values and ADP move on the nightly jobs rather
  //     than on picks, so it is refreshed on a slow clock and quietly.
  //
  // The same runner serves both triggers. What differs is what it SAYS: a press
  // always gets an answer, while an automatic refresh that found nothing new
  // leaves the status line exactly as it was, so a room open for two hours does
  // not announce itself to a screen reader a hundred and twenty times.
  const runSync = useCallback<SyncRunner>(
    async (trigger) => {
      if (!league) return null;
      const draftId = league.draftId;
      if (trigger === "manual") setSyncMessage("Syncing the room...");

      const result = await syncDraft({
        draftId,
        leagueId: league.leagueId,
        season: league.season,
        trigger,
        knownLastSyncedAt: lastSyncedAtRef.current,
      });

      // The reader opened a different league while this was in flight. Drop it
      // whole: applying this cache, or rescheduling on its clock, would be the
      // same bug the staleness guard on loadDraft exists to prevent.
      if (activeDraftIdRef.current !== draftId) return null;

      const now = Date.now();
      if (!result.ok) {
        // A transport-level failure (throttled, server error, offline). Said once;
        // an identical string is not re-announced, so a repeat is silent.
        setSyncMessage(result.message);
        // 503 is the feature switched off underneath an open room. Retrying that
        // on a backoff ladder for the rest of the session asks a settled question
        // over and over, so the loop stops instead.
        if (result.code === "feature-disabled") {
          return {
            manualRemainingSeconds: 0,
            autoRemainingSeconds: 0,
            failed: true,
            autoDisabled: true,
          };
        }
        // The button holds rather than reopening the instant the failure lands.
        // A 429 carries the server's own retry window; anything else gets a few
        // seconds so a bad connection cannot be hammered.
        const hold = result.status === 429 ? (result.retryAfterSeconds ?? 60) : 5;
        return {
          manualRemainingSeconds: hold,
          autoRemainingSeconds: 0,
          failed: true,
          autoDisabled: false,
        };
      }

      const data = result.data;
      const status: SyncStatus = data.status;
      if (data.autoRefreshSeconds > 0) setAutoSeconds(data.autoRefreshSeconds);
      lastSyncedAtRef.current = data.lastSyncedAt ?? lastSyncedAtRef.current;

      // Measured against what is ON SCREEN, not against the last response.
      // Realtime usually beats a sync to the same picks, in which case this is
      // zero and there is genuinely nothing new to say. A null cache means the
      // server found nothing had changed and sent no board at all.
      const onScreen = cacheRef.current?.picks.length ?? 0;
      const landed = data.cache ? Math.max(0, data.cache.picks.length - onScreen) : 0;
      if (data.cache) {
        const fresh = data.cache;
        // Replaced only when something in it actually differs.
        //
        // Most refreshes of a quiet draft return a cache identical to the one on
        // screen apart from its sync stamp, and handing that to setCache would
        // give every array in the room a new identity: the board would re-filter
        // six hundred players, the ADP simulation would re-run, the roster
        // rollups would rebuild, all to arrive back where they started. Every
        // viewer would pay that once a minute for the whole draft. The stamp
        // itself lives in a ref for exactly this reason.
        setCache((prev) => (prev && sameDraftCacheContent(prev, fresh) ? prev : fresh));
      }

      if (trigger === "manual" || landed > 0 || status === "error") {
        const line = syncStatusLine(status, {
          lastSyncedAt: data.lastSyncedAt,
          cooldownRemainingSeconds: data.cooldownRemainingSeconds,
          nowMs: now,
          error: data.error,
        });
        setSyncMessage(
          landed > 0 ? `${landed} new ${landed === 1 ? "pick" : "picks"}. ${line}` : line,
        );
      }

      // The draft ended while the room was open. Lock the results: the room
      // switches to the frozen snapshot and the whole sync control goes away,
      // because there is nothing left on Sleeper for it to fetch.
      if (data.cache?.draft.draftStatus === "complete") {
        if (!snapshot && snapshotRequestedFor.current !== draftId) {
          void loadSnapshot(league, pool);
        }
      } else if (!snapshot) {
        if (
          historyLoadedFor.current === league.leagueId &&
          VIEWS_READING_TRADES.has(view) &&
          now - tradeHistoryLoadedAt.current >= TRADE_HISTORY_MIN_REFRESH_MS
        ) {
          void loadTradeHistory(league.leagueId, { quiet: true });
        }
        if (now - boardLoadedAt.current >= BOARD_MIN_REFRESH_MS) {
          void loadBoard(league, pool, { quiet: true });
        }
      }

      return {
        manualRemainingSeconds: data.cooldownRemainingSeconds,
        autoRemainingSeconds: data.autoRemainingSeconds,
        failed: status === "error",
        autoDisabled: !data.autoRefreshEnabled,
        contended: status === "synced-by-other",
      };
    },
    [league, pool, view, snapshot, loadSnapshot, loadTradeHistory, loadBoard],
  );

  // The clock above was declared before the loaders this runner needs, so it
  // calls through here.
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

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
            // Keep the SAME draft object when the count has not moved. A fresh
            // one re-fires every memo keyed on cache.draft for no new
            // information, which on a resent row is every time.
            const pickCount = Math.max(prev.draft.pickCount, picks.length);
            return {
              ...prev,
              picks,
              draft:
                pickCount === prev.draft.pickCount ? prev.draft : { ...prev.draft, pickCount },
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
    if ((view !== "history" && view !== "rankings" && view !== "grades") || !league || snapshot) return;
    if (historyLoadedFor.current === league.leagueId) return;
    void loadTradeHistory(league.leagueId);
  }, [view, league, snapshot, loadTradeHistory]);

  // ----- Draft Pulse. Lazy, debounced by pick count, and never blocking.
  // A failure leaves `pulse` null, which is the same state the room was in
  // before Draft Pulse existed: every value-based panel still renders and the
  // recommendation engine falls back to its slot-fill heuristic. -----
  useEffect(() => {
    if (!league || !pulseInputs) return;
    const signature = [
      league.draftId,
      cache?.draft.pickCount ?? 0,
      pulseInputs.myRosterId ?? "none",
      pulseInputs.candidateIds.length,
      pulseInputs.nextPickNo ?? "none",
    ].join("|");
    if (pulseSignature.current === signature) return;
    pulseSignature.current = signature;

    // Supersession is tracked by the SIGNATURE, not by a per-effect boolean set
    // from a cleanup. `pulseInputs` gets a new identity whenever the board or the
    // simulation is rebuilt, which happens on Realtime updates that carry no new
    // pick at all (the sync upserts every row, so Postgres emits an UPDATE for
    // unchanged ones). With a cleanup flag, that re-run cancelled the in-flight
    // request and then returned at the guard above without firing a replacement:
    // the response was dropped, and because the loading flag is cleared inside
    // the discarded continuation, the room sat on "Loading weekly projections"
    // until a genuinely new pick landed. On a first load that meant no
    // projections at all for the session.
    setPulseLoading(true);
    void fetchPulse({
      draftId: league.draftId,
      includePreDraftRoster: pulseInputs.includePreDraftRoster,
      myRosterId: pulseInputs.myRosterId,
      candidateIds: pulseInputs.candidateIds,
      survivorIds: pulseInputs.survivorIds,
      nextPickNo: pulseInputs.nextPickNo,
      picksUntilNext: pulseInputs.picksUntilNext,
      boardEtag: boardEtagRef.current,
    }).then((result) => {
      // A newer request has been fired, or the league changed. Drop this one.
      if (pulseSignature.current !== signature) return;
      if (result.ok) {
        const payload = result.data.pulse;
        // A null map means "unchanged since the etag you sent". Anything else is
        // a fresh map, including the first response of a room.
        const players =
          payload.players ??
          (payload.boardEtag === boardEtagRef.current ? playersRef.current : {});
        boardEtagRef.current = payload.boardEtag;
        playersRef.current = players;
        setPulse({ ...payload, players });
      } else {
        // Clear the signature so the next pick retries rather than pinning the
        // failure for the rest of the draft.
        pulseSignature.current = "";
        setPulse(null);
      }
      setPulseLoading(false);
    });
  }, [league, pulseInputs, cache?.draft.pickCount]);

  // Stable, so the memo on AvailableList actually holds. An inline arrow here is
  // a new function every render, which is enough on its own to re-sort 600 rows
  // on every incoming pick.
  const onToggleWatch = useCallback(
    (playerId: string) => {
      setWatchlist((prev) => {
        // Computed outside the updater on purpose: the updater must stay pure,
        // and StrictMode runs it twice.
        const next = new Set(prev);
        if (next.has(playerId)) next.delete(playerId);
        else next.add(playerId);
        return next;
      });
    },
    [],
  );

  // Persisting is a side effect, so it belongs in an effect rather than inside
  // the state updater. Skipped on the first render for a league, which is the
  // one that just READ the stored list.
  const watchlistDraftId = useRef<string | null>(null);
  useEffect(() => {
    if (!league) return;
    if (watchlistDraftId.current !== league.draftId) {
      watchlistDraftId.current = league.draftId;
      return;
    }
    writeWatchlist(league.draftId, watchlist);
  }, [league, watchlist]);

  /** The hero, then the step. Used by every return that is not the room. */
  const beforeRoom = (children: ReactNode) => (
    <>
      {masthead}
      <div className="mt-8">{children}</div>
    </>
  );

  // ----- Step 1: Connect -----
  if (step === "connect") {
    return beforeRoom(
      <div className="mx-auto max-w-3xl">
        <div
          id={STEP_PANEL_ID}
          className="relative scroll-mt-24 overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
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
            Enter your Sleeper username to load every draft you are in, whether drafting
            now, pre-draft, or completed, and step into the cockpit.
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
    return beforeRoom(
      <div className="mx-auto max-w-4xl">
        <div
          id={STEP_PANEL_ID}
          className="relative scroll-mt-24 overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
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
    return beforeRoom(
      // Carries the room's id so the step change lands focus here while the
      // draft loads, rather than finding nothing and leaving focus adrift.
      // Only one of the three room branches renders, so the id stays unique.
      <div id={ROOM_ID} className="mx-auto max-w-3xl scroll-mt-24">
        <BackToLeagues onClick={() => setStep("pick-league")} />
        <div className="mt-4">
          <LoadingCard label="Loading the draft room..." />
        </div>
      </div>
    );
  }
  // `derivedState` and `rec` are non-null exactly when `cache` is, so this one
  // guard narrows all three for the room below.
  if (!cache || !derivedState || !rec) {
    return beforeRoom(
      <div id={ROOM_ID} className="mx-auto max-w-3xl scroll-mt-24">
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
  const derived = derivedState;
  const {
    teamNameByRosterId,
    rollupOwnerNameByRosterId,
    rollupTeamNameByRosterId,
    avatarByRosterId,
  } = rosterNames;

  const activeBoardLoading = snapshotMode ? false : boardLoading || snapshotLoading;
  const activeBoardError = snapshotMode ? null : boardError;

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
  const yourSeatLabel = derived.mySlot > 0 ? `You, Seat ${derived.mySlot}` : "Team not detected";

  const modeNotice = modeSelectable
    ? null
    : isDynasty
      ? "Rookie draft, so the board blends value and lineup impact."
      : "Redraft league: every recommendation here is win-now.";

  const bestCard = rec.best;
  const needCard = rec.need;
  const recommendationsAlign = rec.aligned;

  // Trade Builder catalog (Phase 6C / 6C.1): values every asset from the board the
  // client already holds. mode follows the pool (Everyone = startup, Rookies = rookie).
  // poolBoard is the pre-exclusion pool board (future picks project from a board not
  // depleted by the current draft); `available` is post-exclusion for upcoming picks;
  // boardPlayers (full, all positions) values already-made picks.
  //
  // Only while the Trade Builder is open. The catalog walks every pick in the
  // draft plus the future buckets, and it was being rebuilt on every realtime
  // pick for viewers who were looking at a different view entirely.
  const tradeGroups =
    tradeReady && view === "trade"
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
          currentSeason: tradeSeason,
          simulated: simulatedRemaining,
        })
      : NO_TRADE_GROUPS;

  // Board view (Drafted -> Board): only the board breaks out to the full viewport; the
  // supporting rows above it stay inside the container.
  const boardFull = view === "drafted" && draftedMode === "board";

  // Rosters & Rankings rollups: per-team drafted-player value + future-pick value,
  // ranked by total. Computed only while a view that reads them is open and the
  // board is ready, so the realtime re-render on every pick stays cheap.
  //
  // The board view is not in that list. It was, for the "Your draft" row that
  // used to sit above the board and has been removed; nothing on the board reads
  // a rollup now, so building them there was work thrown away on every pick.
  //
  // GRADES BELONGS IN THIS LIST. It was missing, and computeDraftGrades returns
  // an empty array for empty rollups, so every LIVE draft showed no grades at
  // all: the tab rendered its "nothing to grade yet" state forever. Snapshot
  // mode hid it, because a version 2 snapshot serves frozen grades and never
  // reaches this. computeDraftAwards and tradeHistoryContext were both extended
  // for the grades tab; this one was not.
  const teamRollups =
    (view === "rosters" ||
      view === "rankings" ||
      view === "grades" ||
      view === "pulse") &&
    tradeReady
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
      : NO_ROLLUPS;

  // Trade History context: values every trade against the FULL board (independent of
  // the room's pool toggle, since a trade can involve any player or pick). Made picks
  // use the player taken; upcoming picks project from the post-draft board; future
  // picks are discounted projections. Built only while the tab is open so the
  // realtime re-render on every pick stays cheap elsewhere.
  const tradeHistoryContext: TradeHistoryContext | null =
    (view === "history" || view === "rankings" || view === "grades") && tradeReady
      ? {
          valueBoard: boardPlayers,
          available: excludeDrafted(boardPlayers, draftCache.picks),
          poolBoard: boardPlayers,
          futurePickValues: activeBoard?.pickValues ?? [],
          currentPicks,
          teamNameByRosterId,
          myRosterId: derived.myRosterId,
          teams: Number(draftCache.draft.settings.teams ?? 0),
          currentSeason: tradeSeason,
          // One simulation for the whole room. Without this, a trade card and
          // the trade builder priced the same unmade pick differently.
          simulated: simulatedRemaining,
        }
      : null;

  // Rankings & Awards. Snapshot mode uses the awards LOCKED at finalize (they can
  // never drift). Live mode recomputes on every sync from the rollups, the
  // league's trades, the made picks, the ADP map, and the league's slot model.
  // Only while that tab is open (and the board is ready) so other tabs stay cheap.
  const pulseTeams = snapshotMode
    ? (snapshot.pulse?.teams ?? NO_PULSE_TEAMS)
    : (pulse?.teams ?? NO_PULSE_TEAMS);

  // Has anything actually happened? Awards, grades, and Draft Pulse all answer
  // questions about picks, and before the first one they produced a full page of
  // real-looking placeholders: every award "up for grabs", every grade a zero,
  // every team tied on points. Those read as verdicts rather than as an absence
  // of one, so each tab now says plainly that the draft has not started.
  //
  // Draft Pulse takes this flag but does not rely on it alone: a dynasty ROOKIE
  // draft projects real points off existing rosters before a single rookie is
  // taken, and a draft WITH picks can still have no projections at all. That
  // panel decides between three states from this plus its own data.
  const draftStarted = draftCache.picks.length > 0;

  const awards = snapshotMode
    ? snapshot.awards
    : (view === "rankings" || view === "grades") && tradeReady
      ? computeDraftAwards({
          rollups: teamRollups,
          avatarByRosterId,
          transactions: tradeHistory ?? [],
          tradeContext: tradeHistoryContext,
          picks: draftCache.picks,
          draftSettings: draftCache.draft.settings,
          settings,
          adpBySleeperId,
          board: boardPlayers,
          pulseTeams,
          isDynasty,
        })
      : NO_AWARDS;

  // ---- Draft grades. Frozen in snapshot mode; live mode recomputes while the
  // tab is open so the rest of the room stays cheap on every realtime pick. ----
  // A version 2 snapshot serves frozen grades and never reads this, so computing
  // it there walked the whole board and every pick on every render of a
  // completed draft and threw the result away.
  // `draftStarted` too: with no picks, DraftGrades renders its not-started card
  // and throws this away, after sorting the whole 800-player board to build a
  // market curve for nothing.
  const gradesNeedSurplus =
    view === "grades" && draftStarted && !(snapshotMode && snapshot.snapshotVersion >= 2);
  const gradesContext =
    gradesNeedSurplus && tradeReady
      ? (() => {
          const valueByPlayerId = new Map<string, number>();
          const valueBySleeperId = new Map<string, number>();
          for (const p of boardPlayers) {
            valueByPlayerId.set(p.playerId, p.value);
            if (p.sleeperId) valueBySleeperId.set(p.sleeperId, p.value);
          }
          return computePickSurplus({
            picks: draftCache.picks,
            valueByPlayerId,
            valueBySleeperId,
            curve: buildMarketCurve(boardPlayers),
          });
        })()
      : NO_SURPLUS;

  const draftInProgress = draftCache.draft.draftStatus !== "complete";
  const grades =
    snapshotMode && snapshot.snapshotVersion >= 2
      ? snapshot.grades
      : view === "grades" && tradeReady && settings.grades.enabled
        ? computeDraftGrades({
            rollups: teamRollups,
            pulseTeams,
            pickSurpluses: gradesContext,
            tradeMarginByRoster: tradeMarginsFor(tradeHistory ?? [], tradeHistoryContext),
            startingSlotCount: pulse?.slots.length ?? 0,
            isDynasty,
            settings: settings.grades,
            inProgress: draftInProgress,
          })
        : NO_GRADES;

  // What each of your picks cost you against the board. Only computed on the
  // grades tab, where it is read.
  const passedOn =
    view === "grades" && tradeReady && derived.myRosterId !== null
      ? computePassedOn({
          rosterId: derived.myRosterId,
          picks: draftCache.picks,
          board: boardPlayers,
        }).slice(0, 8)
      : NO_PASSED_ON;

  const recapText =
    view === "grades"
      ? buildRecapText({
          leagueName: league?.name ?? "This league",
          season: league?.season ?? draftCache.draft.season,
          awards,
          grades,
          inProgress: draftInProgress,
        })
      : "";

  // Everything the trade builder needs to turn a board click into a real asset.
  const futurePickLookup = buildPickValueLookup(activeBoard?.pickValues ?? []);
  const tradeResolveContext: ResolveContext | null = tradeReady
    ? {
        currentPicks,
        simulated: simulatedRemaining,
        valueBoard: boardPlayers,
        pickValueFor: (season, round, bucket) =>
          lookupPickValue(futurePickLookup, season, round, bucket),
        teamNameByRosterId,
        myRosterId: derived.myRosterId,
      }
    : null;

  // Snapshot provenance line shown in the command bar (snapshot mode only).
  const snapshotNotice = snapshotMode ? buildSnapshotNotice(snapshot) : null;

  // Whether the room is currently refreshing itself. Read by the sync panel and
  // by the note that appears when Realtime drops, which would otherwise tell a
  // reader to press Sync for updates the room is already fetching.
  const autoRefreshActive = autoRefreshEnabled && !syncClock.autoStopped && !draftComplete;

  // Format/source chips: source is ALWAYS FF Beacon (forced); format is auto-detected
  // from the Sleeper league. Use the league's detected label until the board confirms it.
  const formatLabel = activeBoard?.formatLabel ?? league?.formatLabel ?? "Detecting...";
  const formatIsClosest = league?.formatIsClosest ?? false;
  const sourceActive = activeBoard ? activeBoard.sourceActive : true;

  // Context for the "report incorrect format" dialog: the searched Sleeper handle
  // plus the league identity and detected-vs-derived format. Only meaningful once
  // a league is open (the dialog is reached from the in-room pool notice).
  const reportContext: FormatReportContext | null = league
    ? {
        sleeperUsername: lookupRef.current.username || "Unknown",
        leagueName: league.name,
        leagueId: league.leagueId,
        draftId: league.draftId,
        season: league.season,
        totalRosters: league.totalRosters ?? null,
        draftStatus: league.draftStatus ?? null,
        assignedFormatLabel: formatLabel,
        assignedFormatSlug:
          activeBoard?.formatSlug ??
          league.formatSlug ??
          (snapshotMode ? snapshot.formatSlug : null),
        derivedFormatLabel: league.formatDerivedLabel ?? null,
        isClosestMatch: formatIsClosest,
      }
    : null;

  /**
   * The spoken summary. Built on demand rather than on every render, because it
   * is only ever needed when someone asks for it.
   */
  const buildRoomSummary = () =>
    [
      isYourTurn
        ? "You are on the clock."
        : `${onTheClockTeam} is on the clock at ${onTheClockPickLabel}.`,
      picksUntilNext !== null && picksUntilNext > 0
        ? `${picksUntilNext} ${picksUntilNext === 1 ? "pick" : "picks"} until you are up.`
        : "",
      needCard.player
        ? `Our pick for you is ${needCard.player.name}, ${needCard.player.position}. ${needCard.reason}`
        : "",
      alerts.length > 0 ? alerts.map((a) => a.message).join(" ") : "",
      derived.lastPick ? `Last pick: ${lastPickLabelFor(derived.lastPick)}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  // The four supporting panels (room status, radar, best remaining, your draft).
  //
  // A function of the heading level rather than a const, because these render in
  // two places that sit at different depths: the desktop rail, where they are
  // top-level panels, and the mobile Quick info dialog, where they sit under the
  // dialog's own h2 and would otherwise read as five peers instead of a
  // container with four panels inside it.
  const renderSidebarPanels = (headingLevel: 2 | 3) => (
    <>
      {/* Who is on the clock leads the rail, on every view. It is the one thing a
          drafter checks constantly, so it goes first by eye and first by tab
          order; the radar's "what is happening" is the follow-up question. */}
      <DraftRoomStatus
        draft={draftCache.draft}
        onTheClockTeam={onTheClockTeam}
        onTheClockRound={derived.onTheClockRound}
        onTheClockPickInRound={derived.onTheClockPickInRound}
        onTheClockOverallPickNo={derived.onTheClockPickNo}
        isYourTurn={isYourTurn}
        lastPickLabel={lastPickLabelFor(derived.lastPick)}
        headingLevel={headingLevel}
      />
      <DraftRadar
        alerts={alerts}
        picksUntilNext={picksUntilNext}
        nextPickLabel={
          myNextPick
            ? `R${myNextPick.round}.${String(myNextPick.pickInRound).padStart(2, "0")}, pick ${myNextPick.overall} overall`
            : null
        }
        goneBefore={goneList}
        boardReady={tradeReady}
        headingLevel={headingLevel}
      />
      <BestRemainingByPosition players={available} headingLevel={headingLevel} />
      <Panel eyebrow="Your team" title="Your draft" headingLevel={headingLevel}>
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
      id={ROOM_ID}
      className={`scroll-mt-24 rounded-modal border border-line bg-base/40 ${
        boardFull ? "" : "overflow-hidden"
      }`}
    >
      {/* The room's views go into the site rail, opened, rather than into a
          strip across the top of the room. Registered here rather than higher
          up so it only exists once a draft is actually open: the connect and
          league-picker steps return before this and have no views. */}
      <DraftRoomRail
        views={VIEWS}
        activeView={view}
        onSelect={selectView}
        leagueName={league?.name ?? null}
      />
      <CommandHeader
        leagueName={league?.name ?? "League"}
        viewLabel={VIEW_LABELS[view]}
        draft={draftCache.draft}
        formatLabel={formatLabel}
        formatIsClosest={formatIsClosest}
        pool={pool}
        onTheClockTeam={onTheClockTeam}
        onTheClockPickLabel={onTheClockPickLabel}
        isYourTurn={isYourTurn}
        yourSeatLabel={yourSeatLabel}
        onBack={() => setStep("pick-league")}
        sync={
          // Gone the moment the draft reports complete, not merely dimmed. The
          // clock stops at the same instant, so a control left on screen here
          // would be one that looks pressable and answers nothing.
          snapshotMode || draftComplete
            ? null
            : {
                syncing: syncClock.syncing,
                manualReadyAt: syncClock.manualReadyAt,
                autoDueAt: syncClock.autoDueAt,
                autoRefreshSeconds: autoSeconds,
                autoPaused: syncClock.autoPaused,
                autoAvailable: autoRefreshActive,
                statusMessage: syncMessage,
                onSync: syncClock.syncNow,
              }
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
        onReportFormat={
          reportContext
            ? () => {
                // Dismiss the notice (single modal at a time) and open the report.
                setPoolNoticeOpen(false);
                if (league) markPoolNoticeSeen(league.draftId);
                setReportOpen(true);
              }
            : undefined
        }
      />

      {/* Report-an-incorrect-format dialog, reached from the pool notice. Keyed by
          league so switching leagues remounts it fresh (no carried-over input). */}
      {reportContext && (
        <ReportFormatDialog
          key={reportContext.leagueId}
          open={reportOpen}
          context={reportContext}
          onClose={() => setReportOpen(false)}
        />
      )}

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        {/* The whole state of the room in one keystroke. Mounted HERE, in the
            room itself: every value it reads is declared below the loading
            early-return, so a copy up there would throw the moment it ran and
            would vanish the instant the room actually appeared. Back to leagues
            used to share this row and now sits above the title, in the header. */}
        <RoomSummary build={buildRoomSummary} />

        {/* The room's ONE alert announcer. It has to live out here, above the
            tabs: the draft radar panel that used to own it unmounts on the
            Rosters tab and on the full-width board view, so runs and tier
            cliffs that fired while a user was parked there were never
            spoken. */}
        <DraftAlertAnnouncer alerts={alerts} />

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
              : autoRefreshActive
                ? `Live updates between viewers are unavailable. The room still refreshes itself every ${autoSeconds} seconds.`
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
            {/* The side rail, on anything narrower than xl. It leads the
                content column on EVERY view, including the two that hide the
                desktop rail, because "who is on the clock" is worth the same on
                the rosters view as it is anywhere else. */}
            {railInSheet && (
              <SidebarSheet
                label="Quick info"
                summary="Who is on the clock, the radar, best remaining, and your draft."
                // Below lg there is no navigation rail, so the room carries its
                // own view switcher rather than sending a drafter through the
                // site drawer mid-clock. It rides in this bar so the two share
                // one docked position instead of covering each other.
                leading={
                  <DraftViewSheet views={VIEWS} activeView={view} onSelect={selectView} />
                }
              >
                {renderSidebarPanels(3)}
              </SidebarSheet>
            )}

            {/* View: Who to pick */}
            <div
              role="region"
              id="otc-view-pick"
              aria-labelledby="otc-view-pick-title"
              tabIndex={0}
              hidden={view !== "pick"}
              className="xl:scroll-mt-24 space-y-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-pick-title" className="sr-only">
                {VIEW_LABELS.pick}
              </h2>
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
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  {modeSelectable ? (
                    <BuildModeSelector
                      mode={buildMode}
                      onChange={(next) => {
                        setBuildMode(next);
                        if (league) writeBuildMode(league.draftId, next);
                      }}
                    />
                  ) : (
                    <BuildModeNotice reason={modeNotice ?? ""} />
                  )}
                  {/* Which engine answered, stated rather than implied. A room
                      reasoning from value alone should say so. */}
                  <p className="text-xs text-ink-subtle">
                    {rec.engine === "points"
                      ? `Weighing projected points and FF Beacon value${
                          rec.pointsWeight > 0
                            ? `, ${Math.round(rec.pointsWeight * 100)}% on points right now`
                            : ""
                        }.`
                      : pulseLoading
                        ? "Loading weekly projections..."
                        : "No weekly projections, so this is value and scarcity only."}
                  </p>
                </div>
                {recommendationsAlign && bestCard.player ? (
                  // Value and need point at the same player: show one aligned card,
                  // never demote the user to a worse runner-up.
                  <PlayerSpotlight data={needCard} variant="aligned" {...spotlightExtras.need} />
                ) : (
                  // Two full peers, not a hero and a footnote. Team Need is the
                  // card most drafters act on, and it used to be a single line of
                  // name and value with no reasoning attached to it at all.
                  <div className="space-y-4">
                    <PlayerSpotlight data={bestCard} variant="best" {...spotlightExtras.best} />
                    <PlayerSpotlight data={needCard} variant="need" {...spotlightExtras.need} />
                  </div>
                )}
              </section>

              <Panel
                eyebrow="The pool"
                title="Available players"
                helper="Sorted by FF Beacon value. Drafted players drop off automatically."
              >
                {activeBoardLoading ? (
                  <LoadingCard label="Loading the FF Beacon board..." />
                ) : activeBoardError ? (
                  <ErrorCard message={activeBoardError} />
                ) : !activeBoard || activeBoard.status === "source-unavailable" ? (
                  <EmptyCard
                    title="FF Beacon values are not set up."
                    body="Admin: the FF Beacon source row is missing from the source registry."
                  />
                ) : activeBoard.status !== "ok" ? (
                  <EmptyCard
                    title={`No FF Beacon rankings for ${activeBoard.formatLabel} yet.`}
                    body="The board and picks still work. Values appear once this format's FF Beacon rankings publish."
                  />
                ) : available.length === 0 ? (
                  <EmptyCard
                    title={pool === "rookies" ? "No rookies available." : "No players available."}
                    body={
                      pool === "rookies"
                        ? "No ranked first-year players for this format yet. Check back once rookie values publish."
                        : "Every ranked player in this pool has been drafted."
                    }
                  />
                ) : (
                  <AvailableList
                    players={available}
                    adpThreshold={adpThreshold}
                    adpAvailable={Boolean(activeBoard?.adpFormatKey)}
                    orderScore={rec.orderScore}
                    mode={effectiveMode}
                    projectionsAvailable={pulse !== null}
                    watchlist={watchlist}
                    onToggleWatch={onToggleWatch}
                  />
                )}
              </Panel>
            </div>

            {/* View: Drafted players (LIVE from the synced cache) */}
            <div
              role="region"
              id="otc-view-drafted"
              aria-labelledby="otc-view-drafted-title"
              tabIndex={0}
              hidden={view !== "drafted"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-drafted-title" className="sr-only">
                {VIEW_LABELS.drafted}
              </h2>
              {/* The ONLY view whose body is gated on being open. The region
                  element itself stays mounted, because it is what the rail row
                  points at and what the reader is returned to.
                  A hidden panel is not painted but is still reconciled, and this
                  one is 400-odd cells with a headshot in each, on every realtime
                  pick, for every viewer who is looking at something else. It is
                  also the only panel that holds no state worth keeping: the
                  board/list toggle lives in the room, and the two children are
                  stateless. Every other panel stays mounted, because unmounting
                  them threw away a search box, a sort, a half-built trade, and
                  every open grade card the moment a user changed tabs. */}
              {view === "drafted" && (
                <>
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
                  {/* Row 1 stays within the container; only the board (Row 2)
                      breaks out to the full viewport width. */}
                  {/* Row 1: room status (1/3) beside best remaining (2/3, two-column). */}
                  <div className="mb-5 grid gap-5 lg:grid-cols-3">
                    <div className="lg:col-span-1">
                      <DraftRoomStatus
                        instanceId="room-status-board"
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
                      {/* Its own id: below xl the Quick info sheet holds a
                          second copy of this panel, and two elements cannot
                          share one. */}
                      <BestRemainingByPosition
                        players={available}
                        columns={2}
                        instanceId="otc-best-remaining-board"
                      />
                    </div>
                  </div>

                  {/* Row 2: the board, broken out to the full viewport width. */}
                  <div className="relative left-1/2 w-screen -translate-x-1/2 px-6 sm:px-8 lg:px-10">
                    <Panel
                      eyebrow="Every seat"
                      title="Draft board"
                      helper="Seats across, rounds down. Each cell shows the pick and who was taken."
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
                  helper="Every pick in order."
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
                </>
              )}
            </div>

            {/* View: Rosters & Rankings (full width; right rail hidden) */}
            <div
              role="region"
              id="otc-view-rosters"
              aria-labelledby="otc-view-rosters-title"
              tabIndex={0}
              hidden={view !== "rosters"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-rosters-title" className="sr-only">
                {VIEW_LABELS.rosters}
              </h2>
              <RostersRankings
                teams={teamRollups}
                myRosterId={derived.myRosterId}
                boardReady={tradeReady}
                pulseTeams={pulseTeams}
                isDynasty={isDynasty}
                sortBy={rosterSort}
                onSortChange={setRosterSort}
              />
            </div>

            {/* View: Draft Pulse (points ranking beside the value ranking) */}
            <div
              role="region"
              id="otc-view-pulse"
              aria-labelledby="otc-view-pulse-title"
              tabIndex={0}
              hidden={view !== "pulse"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-pulse-title" className="sr-only">
                {VIEW_LABELS.pulse}
              </h2>
              <DraftPulseBoard
                teams={teamRollups}
                pulseTeams={pulseTeams}
                myRosterId={derived.myRosterId}
                boardReady={tradeReady}
                draftStarted={draftStarted}
                minReliabilityWeeks={settings.awards.minAccuracyWeeks}
                isDynasty={isDynasty}
                weeks={
                  snapshotMode
                    ? (snapshot.pulse?.weeks.length ?? 0)
                    : (pulse?.weeks.length ?? 0)
                }
                slotsEstimated={
                  snapshotMode
                    ? (snapshot.pulse?.slotsEstimated ?? false)
                    : (pulse?.slotsEstimated ?? false)
                }
                scoringEstimated={snapshotMode ? false : (pulse?.scoringEstimated ?? false)}
                pulseLoading={pulseLoading}
              />
            </div>

            {/* View: Trade History (mini Signal Check per trade; keeps the right rail) */}
            <div
              role="region"
              id="otc-view-history"
              aria-labelledby="otc-view-history-title"
              tabIndex={0}
              hidden={view !== "history"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-history-title" className="sr-only">
                {VIEW_LABELS.history}
              </h2>
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

            {/* View: Trade Builder (LIVE Phase 6C; pool-aware value check) */}
            <div
              role="region"
              id="otc-view-trade"
              aria-labelledby="otc-view-trade-title"
              tabIndex={0}
              hidden={view !== "trade"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-trade-title" className="sr-only">
                {VIEW_LABELS.trade}
              </h2>
              {/* Keyed on draft + pool so switching leagues OR Everyone <-> Rookies
                  remounts the builder and clears both sides (no carryover).
                  Deliberately NOT gated on the active tab: unmounting it would
                  throw away a half-built trade every time someone checked the
                  board for who is still available, which is the most natural
                  thing to do in the middle of building one. */}
              <TradeAnalyzer
                key={`${league?.draftId ?? "none"}-${pool}`}
                pool={pool}
                groups={tradeGroups}
                boardReady={tradeReady}
                resolveContext={tradeResolveContext}
                draftId={league?.draftId ?? ""}
                draftCache={draftCache}
                currentPicks={currentPicks}
                teamNameByRosterId={teamNameByRosterId}
                myRosterId={derived.myRosterId}
                connectedUserSlot={derived.mySlot}
                onTheClockPickNo={derived.onTheClockPickNo}
                lastPickNo={derived.lastPick?.pickNo ?? 0}
                adpBySleeperId={adpBySleeperId}
                adpThreshold={adpThreshold}
              />
            </div>

            {/* View: Rankings & Awards (live awards + condensed power rankings table) */}
            <div
              role="region"
              id="otc-view-rankings"
              aria-labelledby="otc-view-rankings-title"
              tabIndex={0}
              hidden={view !== "rankings"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-rankings-title" className="sr-only">
                {VIEW_LABELS.rankings}
              </h2>
              <RankingsAwards
                awards={awards}
                boardReady={tradeReady}
                draftStarted={draftStarted}
                tradesLoading={tradeHistoryLoading}
                tradesError={tradeHistoryError}
                onRetryTrades={() => {
                  if (league && !snapshotMode) void loadTradeHistory(league.leagueId);
                }}
              />
            </div>

            {/* View: Draft grades */}
            <div
              role="region"
              id="otc-view-grades"
              aria-labelledby="otc-view-grades-title"
              tabIndex={0}
              hidden={view !== "grades"}
              className="xl:scroll-mt-24 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <h2 id="otc-view-grades-title" className="sr-only">
                {VIEW_LABELS.grades}
              </h2>
              {snapshotMode && snapshot.snapshotVersion < 2 ? (
                <EmptyCard
                  title="This draft was locked before grades existed."
                  body="Its results are frozen as computed, so it will not be regraded. New drafts are graded automatically."
                />
              ) : (
                <div className="space-y-6">
                  <DraftGrades
                    grades={grades}
                    inProgress={draftInProgress}
                    boardReady={tradeReady}
                    draftStarted={draftStarted}
                    pulseAvailable={pulseTeams.length > 0}
                  />

                  {derived.myRosterId !== null && (
                    <section aria-labelledby="otc-passed-on-title">
                      {/* h2. These two sections are PEERS of the grade list, not
                          children of it; leaving them at h3 while DraftGrades
                          moved to h2 made the recap read as part of the grades. */}
                      <h2
                        id="otc-passed-on-title"
                        className="text-lg font-bold tracking-tight text-ink"
                      >
                        What your picks cost you
                      </h2>
                      <p className="mb-3 mt-1 max-w-2xl text-sm text-ink-muted">
                        Every pick of yours where a more valuable player was still sitting there,
                        measured at the values this draft is graded against. Most drafts have
                        several; the number worth arguing about is the size of the gap.
                      </p>
                      <PassedOnPanel entries={passedOn} />
                    </section>
                  )}

                  <section aria-labelledby="otc-recap-title">
                    <h2 id="otc-recap-title" className="text-lg font-bold tracking-tight text-ink">
                      Recap for the league chat
                    </h2>
                    <p className="mb-3 mt-1 max-w-2xl text-sm text-ink-muted">
                      Plain text, sized for a message box.
                    </p>
                    <RecapBox text={recapText} />
                  </section>
                </div>
              )}
            </div>
          </div>

          {/* ---- Persistent right rail (hidden on the full-width Rosters tab and on
              the full-width board view, where the panels move to a top bar).
              Below xl this does not render at all: the same panels are inside
              the Quick info sheet above, and rendering both would put two
              copies of every panel id in the document. ---- */}
          {!railInSheet && view !== "rosters" && !boardFull && (
            <aside aria-label="Draft room panels" className="space-y-5 xl:sticky xl:top-32 xl:self-start">
              {renderSidebarPanels(2)}
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
      "Limited history, so these are estimated from the nearest snapshots.",
    );
  } else if (
    s.valueSnapshotSource === "next_available" ||
    s.adpSnapshotSource === "next_available"
  ) {
    bits.push("Some inputs use the nearest snapshot after the draft (estimated).");
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

/**
 * How many survivors to send per position.
 *
 * The server only reads the BEST projected survivor at each position, and it
 * reads it to answer "what will still be here at my next pick". Sending the
 * whole survivor list meant roughly 600 ids (about 23 KB) on every request, and
 * the route's flat 800 cap then truncated in BOARD order, so a position that
 * ranks low as a group (kickers, defenses) could be cut out entirely and then
 * read as maximal scarcity.
 *
 * Per position, top by value, means every position is always represented and
 * the payload drops to about a quarter of its size. The best survivor by
 * projected points is not always the best by value, but across the top twenty
 * five at a position it is there.
 */
const SURVIVORS_PER_POSITION = 25;

/**
 * Everything the Draft Pulse request needs, from values the room has already
 * derived. It takes the ADP simulation rather than running its own: the radar,
 * the dropoff term in Team Need, and the trade builder all read one simulation,
 * so they cannot disagree, and the sort only happens once.
 *
 * Returns null until there is a synced draft, which is the state every caller
 * already handles.
 */
function derivePulseInputs(args: {
  cache: ShapedDraftCache | null;
  derivedState: ReturnType<typeof deriveDraftState> | null;
  /** The pool-filtered, undrafted board. Empty until values load. */
  available: RankedPlayer[];
  simulated: Map<number, SimulatedPick>;
  myNextPick: CurrentDraftPick | null;
  pool: PlayerPool;
  isDynastyFormat: boolean;
  settings: OnTheClockSettings;
}): {
  includePreDraftRoster: boolean;
  myRosterId: number | null;
  candidateIds: string[];
  survivorIds: string[] | null;
  nextPickNo: number | null;
  picksUntilNext: number | null;
} | null {
  const { cache, derivedState, available, simulated, myNextPick, pool, settings } = args;
  if (!cache || !derivedState) return null;

  const picksUntilNext =
    myNextPick && derivedState.onTheClockPickNo > 0
      ? Math.max(0, myNextPick.overall - derivedState.onTheClockPickNo)
      : null;

  let candidateIds: string[] = [];
  let survivorIds: string[] | null = null;
  if (available.length > 0) {
    // The candidate list is the top of the available board by value. Capped,
    // because each candidate costs a seat probe for every remaining week on the
    // server; the cap is admin-tunable and surfaced in the payload.
    candidateIds = available
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, settings.marginal.maxCandidates)
      .map((p) => p.playerId);

    if (myNextPick) {
      const perPosition = new Map<string, number>();
      survivorIds = [];
      for (const p of survivorsAt(available, simulated, myNextPick.overall)) {
        const taken = perPosition.get(p.position) ?? 0;
        if (taken >= SURVIVORS_PER_POSITION) continue;
        perPosition.set(p.position, taken + 1);
        survivorIds.push(p.playerId);
      }
    }
  }

  return {
    includePreDraftRoster: args.isDynastyFormat && pool === "rookies",
    myRosterId: derivedState.myRosterId,
    candidateIds,
    survivorIds,
    nextPickNo: myNextPick?.overall ?? null,
    picksUntilNext,
  };
}
