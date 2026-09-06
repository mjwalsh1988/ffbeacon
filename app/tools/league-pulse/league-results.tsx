"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  ArrowDownWideNarrow,
  ArrowRight,
  Users,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { LeagueOpenLink } from "@/components/league-open-link";
import { LeagueLogo } from "@/components/league-logo";
import type { SleeperLeague } from "@/lib/sleeper";
import {
  groupLeaguesByCategory,
  type LeagueCategoryGroup,
  type StandingLookup,
} from "@/lib/league-category";
import {
  setFeaturedLeague,
  setLeagueShownOnProfile,
} from "@/app/my-beacon/actions";
import { humanizeLeagueStatus } from "@/lib/league-status";
import type { LeagueTeamStatusSummary } from "@/lib/league-team-status-data";
import type { TeamStatusKey } from "@/lib/league-team-status";
import {
  TeamStatusBadge,
  TeamStatusPending,
} from "@/components/team-status-badge";
import { LeagueKey } from "@/components/league-key";
import { TeamStandingFigure } from "@/components/team-standing-figure";
import { describeStandingFigure } from "@/lib/team-standing-figure";
import {
  LeagueQueuedBadge,
  LeagueSyncButton,
} from "@/components/league-sync-button";
import { LeagueSyncAll } from "@/components/league-sync-all";
import { LeagueCategoryTabs } from "@/components/league-category-tabs";
import { LeagueProfileToggles } from "@/components/league-profile-toggles";
import { LeagueSyncProvider, useLeagueSync } from "@/lib/league-sync-queue";
import {
  IDLE_BULK_SYNC_STATE,
  mergeBulkSyncState,
  type BulkSyncState,
  type LeagueSyncJobStatus,
} from "@/lib/league-bulk-sync-types";
import { LeagueDetailSheet } from "./league-detail-sheet";

/**
 * Per-league status inside the newest Sync all batch, keyed by Sleeper league id.
 * Empty on the public variant, which has no Sync all.
 */
type BulkStatusMap = Record<string, LeagueSyncJobStatus>;

/** Keyed by Sleeper league id. Absent means we have never pulsed that league. */
export type TeamStatusMap = Record<string, LeagueTeamStatusSummary>;

/**
 * The one field the category sort reads.
 *
 * A cached row without a status is the same thing as no cached row for ordering
 * purposes. Both mean we cannot say how this team is doing, and both belong
 * under the rebuilders rather than mixed in among teams we have measured.
 */
function statusKeyOf(
  summary: LeagueTeamStatusSummary | null | undefined,
): TeamStatusKey | null {
  return summary?.status?.key ?? null;
}

/**
 * How the rows inside a category are ordered, said once.
 *
 * The order is the first thing a reader has to know about a list they are
 * scanning, and on this list it is not the obvious one (a league list defaults
 * to alphabetical everywhere else on the site). It renders visibly above the
 * groups on both variants, so it is in the reading order before any row is,
 * and it is repeated in the dashboard table's caption because a table can be
 * jumped to directly.
 */
const STANDING_ORDER_NOTE =
  "Within each type, your Contenders come first, then Bubble teams, then Rebuilders and Longshots. Leagues we have not synced yet come last.";

/**
 * Where a row should land: always the league's Overview.
 *
 * Rows for leagues we had never pulsed used to open on the Power Pulse tab
 * instead, on the theory that the missing Pulse number was what the reader had
 * just tried to read. In practice it dropped people into a sub-page of a league
 * they had not seen yet. Overview is the front door for every row, synced or
 * not, and the Power Pulse tab is one click from there.
 *
 * Forwards ?username= so the deep view knows whose roster to default the Teams
 * chips to, and ?name= so the <title> is right on a league's first open, before
 * the row exists for generateMetadata to read.
 */
function leagueHref(
  leagueId: string,
  sleeperUsername: string | null,
  leagueName: string | null,
): string {
  const params = new URLSearchParams();
  if (sleeperUsername) {
    params.set("username", sleeperUsername);
  }
  if (leagueName) params.set("name", leagueName);
  const qs = params.toString();
  const base = `/leagues/${leagueId}`;
  return qs ? `${base}?${qs}` : base;
}

/**
 * Grid track template shared by the desktop header row and every desktop body
 * row. Both must use the SAME template, and every track has to be
 * content-independent, or the two grids resolve to different widths and the
 * column headings drift off the values under them. That is why the flexible
 * tracks are `minmax(0, Nfr)` rather than a bare `Nfr`: a bare `1fr` carries an
 * implicit `auto` minimum, so one long league name silently widens the first
 * column in the body only.
 *
 * The "Your team" track is the widest fixed one, and sized so the longest pair
 * it has to hold sits on ONE line: a Rebuilder tag next to a six-figure value
 * with its rank, roughly 232px of pills plus the gap between them. The cell
 * still wraps, so nothing breaks if a value runs long; 16rem is what keeps it
 * from having to. The league-name track is `minmax(0,1fr)` and absorbs the
 * difference, leaving it around 700px at the container's full width.
 *
 * Mobile drops the league-status column entirely. On a phone the row is a quick
 * "how am I doing" scan, and how the LEAGUE is doing is not that; it moves to
 * the detail sheet, which already leads with it, and stays in the row button's
 * accessible name so nothing is lost to a screen reader.
 *
 * The first track is the league's own logo, 3rem for a 48px image. It is a
 * fixed track rather than an auto one so a league with no logo (Sleeper leagues
 * mostly have none) still reserves the same width and the names below it stay
 * on one left edge.
 */
const PUBLIC_GRID = "grid-cols-[3rem_minmax(0,1fr)_7rem_4.5rem_16rem]";
const MOBILE_GRID = "grid-cols-[minmax(0,1fr)_1.5rem]";

/**
 * Phone rows: the logo column and everything else.
 *
 * The logo spans BOTH rows of the row (the name line and the standing line
 * beneath it) and centres itself across them, which is why it lives on the `li`
 * rather than inside the button. 2.5rem holds the 40px phone logo.
 */
const MOBILE_LOGO_GRID = "grid-cols-[2.5rem_minmax(0,1fr)]";

/**
 * League results render in two variants:
 *
 * - `"public"` (default): the public /tools/league-pulse tool. Every row is a
 *   single link, so it renders as a list of links under a column strip rather
 *   than as a table. Clicking a row opens the league. Mobile shows a narrower
 *   list that opens a slide-up modal on tap.
 * - `"dashboard"`: rendered inside /my-beacon/sleeper-leagues. This one IS a
 *   table, because its rows carry independently operable controls per cell:
 *   the league name navigates, and the last two columns hold the Featured and
 *   Show on profile toggles that persist into
 *   user_preferences.sleeper_league_settings.
 *
 * Two parallel renderers per variant (not one with `hidden md:table-cell`)
 * because the desktop rows wrap form elements that would be awkward to thread
 * through a single shared markup tree.
 */
export type LeagueResultsVariant = "public" | "dashboard";

export function LeagueResults({
  variant = "public",
  leagues,
  sleeperUsername,
  featuredLeagueId = null,
  shownLeagueIds = [],
  teamStatuses = {},
  sourceSlug = null,
  bulkSync,
}: {
  variant?: LeagueResultsVariant;
  leagues: SleeperLeague[];
  /** Season is part of each league row already, but kept here so the
   * server caller can keep its existing prop shape. */
  season: string;
  /** The Sleeper handle the user searched for. Forwarded into the deep
   * view's team-filter chip bar on "Open league". */
  sleeperUsername: string | null;
  /** Dashboard variant only, currently pinned league id (Sleeper id). */
  featuredLeagueId?: string | null;
  /** Dashboard variant only, leagues currently visible on the user's
   * profile. */
  shownLeagueIds?: string[];
  /** Contender / Rebuilder standing for this user's own team, for the
   * leagues we have already pulsed. Missing entries render as pending. */
  teamStatuses?: TeamStatusMap;
  /** Active value source, so the FF Beacon mark on a rebuilder's roster value
   * appears only when the value really is FF Beacon's. */
  sourceSlug?: string | null;
  /**
   * The signed-in reader's newest Sync all batch, read on the server.
   *
   * DASHBOARD ONLY, and the absence of it is what keeps Sync all off the public
   * tool. /tools/league-pulse never passes this, so the button never renders
   * there and the rows keep the one-at-a-time Sync they already had. Anyone can
   * reach the public tool, and a button that queues every league a visitor owns
   * is not a thing to hand out anonymously.
   */
  bulkSync?: BulkSyncState;
}) {
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(null);
  const openLeague = leagues.find((l) => l.league_id === openLeagueId) ?? null;

  // Lift the dashboard toggle state to this component so the Featured
  // radio (mutually exclusive) and the Show toggle (independent per row)
  // can update optimistically while a server action persists.
  const [featuredId, setFeaturedId] = useState<string | null>(featuredLeagueId);
  const [shownIds, setShownIds] = useState<Set<string>>(
    () => new Set(shownLeagueIds),
  );
  // Dashboard view filter. Defaults to true so first-time users see
  // every synced league, turning the toggle OFF narrows the table to
  // just the leagues marked Featured or Shown on profile, for users
  // who want their dashboard to mirror exactly what their profile
  // surfaces.
  const [showAll, setShowAll] = useState(true);
  const [, startTransition] = useTransition();

  // Sync all progress, held here rather than inside the button, because the rows
  // need it too: a queued league shows "Queued" where its Sync button was, from
  // the moment the press returns rather than whenever the next server render
  // lands.
  const [bulkState, setBulkState] = useState<BulkSyncState>(
    bulkSync ?? IDLE_BULK_SYNC_STATE,
  );
  const bulkSyncRef = useRef(bulkSync);
  bulkSyncRef.current = bulkSync;
  const serverRequestId = bulkSync?.requestId ?? null;
  const serverProgress = bulkSync ? bulkSync.done + bulkSync.failed : -1;
  const serverActive = bulkSync?.active ?? false;

  // Two sources describe the same batch: this render's server copy and the
  // button's own polling. mergeBulkSyncState decides which one wins; see there
  // for why a server copy that is behind is dropped rather than applied.
  useEffect(() => {
    const incoming = bulkSyncRef.current;
    if (!incoming) return;
    setBulkState((prev) => mergeBulkSyncState(prev, incoming));
  }, [serverRequestId, serverProgress, serverActive]);

  const bulkStatuses: BulkStatusMap =
    variant === "dashboard" ? bulkState.jobStatuses : {};

  // Filter the leagues array passed down to the dashboard renderers.
  // When `showAll` is true we pass everything through. When false, we
  // keep only the ones that are explicitly Featured or in the Shown
  // set, leagues the user has signaled they care about for their
  // public profile.
  const visibleLeagues = useMemo(() => {
    if (variant !== "dashboard" || showAll) return leagues;
    return leagues.filter(
      (l) => featuredId === l.league_id || shownIds.has(l.league_id),
    );
  }, [variant, showAll, leagues, featuredId, shownIds]);

  // The standing of the reader's own team per league, reduced to the one field
  // the sort needs. Built from the cached statuses this component was already
  // handed, so ordering the list costs nothing and starts nothing: a league
  // with no cached row has no standing and sorts last, exactly as it renders.
  const standings: StandingLookup = useMemo(() => {
    const out: Record<string, ReturnType<typeof statusKeyOf>> = {};
    for (const [leagueId, summary] of Object.entries(teamStatuses)) {
      out[leagueId] = statusKeyOf(summary);
    }
    return out;
  }, [teamStatuses]);

  // Group leagues into type buckets (Dynasty, Redraft, Best Ball Dynasty,
  // Best Ball Redraft), then order each bucket by how the reader's own team is
  // doing so the leagues worth acting on are at the top of the section. Public
  // groups the full list; dashboard groups whatever the Show-all filter left
  // visible.
  const publicGroups = useMemo(
    () => groupLeaguesByCategory(leagues, standings),
    [leagues, standings],
  );
  const dashboardGroups = useMemo(
    () => groupLeaguesByCategory(visibleLeagues, standings),
    [visibleLeagues, standings],
  );

  // Public variant skips the filter UI and bypasses the count.
  const profileLeagueCount = useMemo(() => {
    const set = new Set(shownIds);
    if (featuredId) set.add(featuredId);
    return set.size;
  }, [featuredId, shownIds]);

  const handleSetFeatured = (leagueId: string | null) => {
    setFeaturedId(leagueId);
    startTransition(async () => {
      await setFeaturedLeague(leagueId);
    });
  };

  const handleToggleShown = (leagueId: string, next: boolean) => {
    setShownIds((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(leagueId);
      else copy.delete(leagueId);
      return copy;
    });
    startTransition(async () => {
      await setLeagueShownOnProfile(leagueId, next);
    });
  };

  // One category's worth of rows, at both breakpoints. Shared by the tabbed
  // layout and the single-category fallback so the two cannot drift: whichever
  // one a reader gets, the rows and the props behind them are the same.
  const renderDashboardGroup = (group: LeagueCategoryGroup): ReactNode => (
    <>
      <DesktopDashboardTable
        leagues={group.leagues}
        sleeperUsername={sleeperUsername}
        teamStatuses={teamStatuses}
        bulkStatuses={bulkStatuses}
        sourceSlug={sourceSlug}
        featuredId={featuredId}
        shownIds={shownIds}
        onSetFeatured={handleSetFeatured}
        onToggleShown={handleToggleShown}
      />
      <MobileDashboardCards
        leagues={group.leagues}
        teamStatuses={teamStatuses}
        bulkStatuses={bulkStatuses}
        sourceSlug={sourceSlug}
        featuredId={featuredId}
        shownIds={shownIds}
        onOpen={(id) => setOpenLeagueId(id)}
      />
    </>
  );

  return (
    // The provider spans every group and both breakpoint renderers, because the
    // "one at a time" rule is about the reader, not about one table. Two rows in
    // two different category sections must still queue behind each other.
    <LeagueSyncProvider>
      <section aria-labelledby="leagues-heading" className="mt-8">
        <h2 id="leagues-heading" className="sr-only">
          Your Sleeper leagues
        </h2>

        {variant === "dashboard" ? (
          <>
            {bulkSync && (
              <LeagueSyncAll
                initialState={bulkSync}
                leagueCount={leagues.length}
                onStateChange={setBulkState}
              />
            )}
            <DashboardFilter
              showAll={showAll}
              onChange={setShowAll}
              totalCount={leagues.length}
              visibleCount={visibleLeagues.length}
              profileLeagueCount={profileLeagueCount}
            />
            {visibleLeagues.length === 0 ? (
              <FilterEmptyState onReset={() => setShowAll(true)} />
            ) : (
              // Two columns from xl up, one below it. Not lg: at 1024px the
              // sidebar would leave the six-column table under 700px, and the
              // table is the thing people came for. Source order is list then
              // key, which is both the reading order and, with the key as the
              // second grid track, the visual order.
              <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-8">
                <div className="min-w-0">
                  <StandingOrderNote leagueCount={visibleLeagues.length} />
                  {/* One category is not a choice, so it does not get a
                      tablist. It keeps the plain headed section, which is the
                      only thing that still names the category once the tabs
                      are gone. */}
                  {dashboardGroups.length > 1 ? (
                    <LeagueCategoryTabs
                      groups={dashboardGroups}
                      label="League types"
                      renderGroup={renderDashboardGroup}
                    />
                  ) : (
                    dashboardGroups.map((group) => (
                      <LeagueCategorySection key={group.key} group={group}>
                        {renderDashboardGroup(group)}
                      </LeagueCategorySection>
                    ))
                  )}
                </div>
                {/* Sticky so the key is still there thirty rows down, which is
                    the point of moving it out of the flow. It only sticks where
                    it has a column of its own; stacked below the list it is
                    just the last thing on the page. */}
                <aside
                  aria-labelledby="league-key-heading"
                  className="mt-8 xl:sticky xl:top-6 xl:mt-0"
                >
                  <LeagueKey layout="panel" />
                </aside>
              </div>
            )}
          </>
        ) : (
          <>
            <StandingOrderNote leagueCount={leagues.length} />
            <div className="space-y-8">
              {publicGroups.map((group) => (
                <LeagueCategorySection key={group.key} group={group}>
                  <DesktopPublicList
                    leagues={group.leagues}
                    sleeperUsername={sleeperUsername}
                    teamStatuses={teamStatuses}
                    sourceSlug={sourceSlug}
                  />
                  <MobilePublicList
                    leagues={group.leagues}
                    teamStatuses={teamStatuses}
                    sourceSlug={sourceSlug}
                    onOpen={(id) => setOpenLeagueId(id)}
                  />
                </LeagueCategorySection>
              ))}
            </div>
            {/* Public tool keeps the key in the flow under the table: there is
                no second column here to put it in. Same component, same
                entries, spread onto a grid instead of stacked. */}
            <LeagueKey layout="inline" className="mt-6" />
          </>
        )}

        {/* One sheet for both variants. It is the mobile disclosure on the
            public tool and, now, on the dashboard too. The profile switches are
            passed ONLY on the dashboard: the public tool has no profile to put
            a league on, so the section does not render there. */}
        {openLeague && (
          <LeagueDetailSheet
            league={openLeague}
            open={!!openLeague}
            onClose={() => setOpenLeagueId(null)}
            sleeperUsername={sleeperUsername}
            statusDisplay={describeStatus(openLeague.status).label}
            statusTone={describeStatus(openLeague.status).tone}
            summary={teamStatuses[openLeague.league_id] ?? null}
            sourceSlug={sourceSlug}
            profile={
              variant === "dashboard"
                ? {
                    isFeatured: featuredId === openLeague.league_id,
                    isShown: shownIds.has(openLeague.league_id),
                    onSetFeatured: (next) =>
                      handleSetFeatured(next ? openLeague.league_id : null),
                    onToggleShown: (next) =>
                      handleToggleShown(openLeague.league_id, next),
                  }
                : undefined
            }
          />
        )}
      </section>
    </LeagueSyncProvider>
  );
}

/* ---------- Ordering note ---------- */

/**
 * One line, above the groups, saying how they are ordered.
 *
 * Ordinary page text rather than a live region or an aria-description: it never
 * changes, and it sits ahead of the lists in the reading order, which is where
 * a reader needs it. The arrow is decorative; the sentence carries the meaning.
 *
 * A single league has no order to explain, so the line does not render there.
 */
function StandingOrderNote({ leagueCount }: { leagueCount: number }) {
  if (leagueCount < 2) return null;
  return (
    <p className="mb-4 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
      <ArrowDownWideNarrow
        aria-hidden="true"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan"
      />
      <span>{STANDING_ORDER_NOTE}</span>
    </p>
  );
}

/* ---------- Category section wrapper ---------- */

/**
 * One labeled bucket of leagues (e.g. "Dynasty", "Best Ball Redraft") with a
 * visible heading and count above the variant's table(s). The heading is an
 * h3 under the section's sr-only "Your Sleeper leagues" h2, keeping the
 * document outline correct on both the public tool and the dashboard.
 */
function LeagueCategorySection({
  group,
  children,
}: {
  group: LeagueCategoryGroup;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 flex items-baseline gap-2 text-base font-semibold tracking-tight text-ink">
        {group.label}
        <span className="text-xs font-normal text-ink-subtle">
          {group.leagues.length}{" "}
          {group.leagues.length === 1 ? "league" : "leagues"}
        </span>
      </h3>
      {children}
    </div>
  );
}

/* ---------- Shared "Your team" cell ---------- */

/**
 * The tag, the figure beside it, and on an unsynced league the Sync button.
 *
 * One component for all four renderers. The tag and the number belong together
 * (the number is what makes the tag actionable), and the four surfaces drifting
 * apart is the failure mode a shared cell exists to prevent.
 *
 * Both pieces are ordinary pills, and both stay in the accessibility tree. An
 * earlier pass hid them, on the theory that the row's own accessible name
 * already read them out. That broke reading by hover: a screen reader following
 * the pointer has to find something under it, and hidden text is nothing. Never
 * hide row content that a reader might point at.
 *
 * Pills wrap rather than stack, so they sit side by side wherever the column is
 * wide enough and fall onto two lines where it is not.
 */
function TeamStandingCell({
  summary,
  leagueName,
  sleeperLeagueId,
  leagueTeamCount,
  sourceSlug,
  bulkStatus = null,
  size = "md",
}: {
  summary: LeagueTeamStatusSummary | null;
  leagueName: string;
  sleeperLeagueId: string;
  /** Teams in the league, per Sleeper. The denominator for a value rank, which
   *  covers every roster, not only the ones Power Pulse scored. */
  leagueTeamCount: number;
  sourceSlug: string | null;
  /** Where this league sits in the reader's Sync all batch, if it is in one. */
  bulkStatus?: LeagueSyncJobStatus | null;
  size?: "sm" | "md";
}) {
  const sync = useLeagueSync(sleeperLeagueId);
  const queued = bulkStatus === "pending" || bulkStatus === "processing";

  if (!summary?.status) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <TeamStatusPending size={size} />
        {queued ? (
          // Sync all already asked for this one. Offering the button as well
          // would let the reader spend their single-league slot on work that is
          // already queued.
          <LeagueQueuedBadge
            leagueName={leagueName}
            phase={bulkStatus === "processing" ? "processing" : "pending"}
            size={size}
          />
        ) : sync.didSucceed ? (
          // The sync worked and the league still has no Pulse row. That is a
          // real answer, not a failure: Power Pulse refuses to score a season
          // with no unplayed games left, and offering the button again would
          // just spend another slot reaching the same conclusion.
          <span className="block max-w-[14rem] text-[10px] leading-snug text-ink-subtle">
            Synced. Nothing to project here yet, usually because the season is
            over or the schedule is not out.
          </span>
        ) : (
          <LeagueSyncButton
            sleeperLeagueId={sleeperLeagueId}
            leagueName={leagueName}
            size={size}
          />
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <TeamStatusBadge status={summary.status} size={size} />
      <TeamStandingFigure
        statusKey={summary.status.key}
        projectedSeed={summary.projectedSeed}
        rankedTeamCount={summary.rankedTeamCount}
        valueRank={summary.valueRank}
        totalValue={summary.totalValue}
        valueIsExact={summary.valueIsExact}
        leagueTeamCount={leagueTeamCount}
        sourceSlug={sourceSlug}
        size={size}
      />
      {/* An already-tagged league is in the batch too, and a reader who pressed
          Sync all should be able to see that this row is one of the ones being
          worked on. The tag and figure stay put; the badge joins them until the
          job finishes, at which point the numbers beside it are the fresh ones. */}
      {queued && (
        <LeagueQueuedBadge
          leagueName={leagueName}
          phase={bulkStatus === "processing" ? "processing" : "pending"}
          size={size}
        />
      )}
    </span>
  );
}

/** The whole "Your team" story as one sentence, for a row whose accessible name
 *  covers everything at once.
 *
 *  The figure leads and the tag's own reasoning follows, and both name the
 *  measure they are quoting. They are different numbers on purpose: the finish
 *  is ordered by expected wins, the tag is derived from Power Pulse, and a hard
 *  schedule separates them. Unlabelled, the pair reads as a contradiction. */
function describeTeamStanding(
  summary: LeagueTeamStatusSummary | null,
  leagueTeamCount: number,
  bulkStatus: LeagueSyncJobStatus | null = null,
): string {
  // The batch state leads, because it answers the question a reader who just
  // pressed Sync all is actually asking about this row.
  const queueNote =
    bulkStatus === "processing"
      ? "Syncing now."
      : bulkStatus === "pending"
        ? "Queued for syncing."
        : null;

  if (!summary?.status) {
    return queueNote
      ? `${queueNote} Your team has no standing yet; it will appear once this league finishes.`
      : "Your team has no standing yet. Use the Sync button on this row, or open the league, to calculate it.";
  }
  const figure = describeStandingFigure({
    statusKey: summary.status.key,
    projectedSeed: summary.projectedSeed,
    rankedTeamCount: summary.rankedTeamCount,
    valueRank: summary.valueRank,
    totalValue: summary.totalValue,
    valueIsExact: summary.valueIsExact,
    leagueTeamCount,
  });
  return `${queueNote ? `${queueNote} ` : ""}Your team: ${summary.status.label}. ${figure} ${summary.status.reason}`.trim();
}

/* ---------- PUBLIC variant, desktop ---------- */

/**
 * Deliberately a list rather than a table.
 *
 * A real table sizes its columns from its cells, and this list has one
 * row-spanning link per row, so the headings were sized by their own text while
 * the values inside the link were sized by a grid. The two never agreed, which
 * is why the Teams heading used to sit off its numbers. As a list where the
 * header strip and every row share one grid template, the browser cannot
 * disagree with itself.
 *
 * The link covers the first three columns and holds its own text. It is NOT an
 * empty overlay stretched across the row, which is what a previous pass tried in
 * order to keep the whole row clickable while the "Your team" cell gained a Sync
 * button. That version broke reading by hover: every cell was pointer-events-none
 * so the pointer always hit-tested to the link, and the link had no text in it,
 * so a screen reader following the mouse found an empty box and said nothing.
 *
 * Whatever is under the pointer has to BE the thing it looks like. So the link
 * wraps real content, `grid-cols-subgrid` keeps its three columns locked to the
 * outer template (alignment by construction, which was the point of the shared
 * grid), and the "Your team" column sits outside the link as its own cell,
 * because it holds a button and a button inside a link is invalid markup.
 *
 * The cost is that clicking the "Your team" column no longer navigates. That
 * column is the one you press things in now, so that is the right trade.
 */
function DesktopPublicList({
  leagues,
  sleeperUsername,
  teamStatuses,
  sourceSlug,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
  teamStatuses: TeamStatusMap;
  sourceSlug: string | null;
}) {
  return (
    <div className="hidden overflow-hidden rounded-card border border-line md:block">
      <div
        aria-hidden="true"
        className={`grid items-center gap-3 border-b border-line bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle ${PUBLIC_GRID}`}
      >
        {/* An in-flow placeholder holding the logo track open. NOT sr-only:
            that compiles to position:absolute, which takes the element out
            of the grid flow entirely, so every heading below shifted one
            track left and sat over the wrong column. It says nothing either
            way, because this whole strip is aria-hidden. */}
        <span />
        <span>League</span>
        <span className="text-center">Status</span>
        <span className="text-center">Teams</span>
        <span>Your team</span>
      </div>
      <ul
        role="list"
        aria-label="Your Sleeper leagues. Each row gives the league name, its Sleeper status, team count, and how your own roster is doing."
        className="divide-y divide-line"
      >
        {leagues.map((league) => {
          const { label, tone } = describeStatus(league.status);
          const summary = teamStatuses[league.league_id] ?? null;
          return (
            <li
              key={league.league_id}
              className={`group grid items-center gap-3 px-4 transition-colors hover:bg-surface/60 focus-within:bg-surface/60 ${PUBLIC_GRID}`}
            >
              {/* col-span-4 + subgrid: the link is one grid item that borrows the
                  parent's first four tracks (logo, league, status, teams), so
                  its cells cannot drift off the headings above them. Horizontal
                  padding lives on the li, not here, because padding on a subgrid
                  item would shift its tracks out of step with the parent's. */}
              <LeagueOpenLink
                sleeperLeagueId={league.league_id}
                href={leagueHref(
                  league.league_id,
                  sleeperUsername,
                  league.name,
                )}
                ariaLabel={`Open ${league.name}, ${label}, ${league.total_rosters} teams. ${describeTeamStanding(summary, league.total_rosters)}`}
                className="col-span-4 grid grid-cols-subgrid items-center py-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan"
              >
                {/* Decorative, and the name is right beside it, so it adds
                    nothing to the link's accessible name. */}
                <LeagueLogo
                  avatarId={league.avatar}
                  name={league.name}
                  size={48}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-base font-semibold text-ink">
                    <span className="truncate">{league.name}</span>
                    <ArrowRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                    />
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-subtle">
                    {league.season} season
                  </span>
                </span>
                <span className="flex justify-center">
                  <StatusBadge label={label} tone={tone} />
                </span>
                <span className="flex items-center justify-center gap-1.5 font-mono tabular-nums text-ink-muted">
                  <Users
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-brand-cyan"
                  />
                  {league.total_rosters}
                </span>
              </LeagueOpenLink>
              <span className="flex min-w-0 justify-start py-4">
                <TeamStandingCell
                  summary={summary}
                  leagueName={league.name}
                  sleeperLeagueId={league.league_id}
                  leagueTeamCount={league.total_rosters}
                  sourceSlug={sourceSlug}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- PUBLIC variant, mobile ---------- */

/**
 * Same reasoning as the desktop list, one breakpoint down. Tapping a row opens
 * the detail sheet instead of navigating, so the row control is a button.
 *
 * No overlay here either, for the same reason: the button holds its own text, so
 * whatever is under the pointer is the thing it looks like. The standing sits in
 * a block below the button rather than inside it, because it holds a Sync button
 * and a button inside a button is invalid markup.
 *
 * WHAT MOBILE SHOWS INSTEAD OF THE LEAGUE STATUS
 *   Desktop has room for both, so it shows both. A phone does not, and between
 *   "this league is In Season" and "your team is a Rebuilder holding the 3rd
 *   most value", only one of those is worth the width on a list you are scanning
 *   to see how you are doing. So the status column is gone here and the standing
 *   pills take the row.
 *
 *   The league status is not lost. It stays in this button's accessible name, so
 *   a screen reader still hears it on every row, and the detail sheet this
 *   button opens leads with it as a badge and repeats it as a fact card. Nothing
 *   is visible at one breakpoint and unreachable at the other, which is the rule
 *   this would otherwise break.
 */
function MobilePublicList({
  leagues,
  teamStatuses,
  sourceSlug,
  onOpen,
}: {
  leagues: SleeperLeague[];
  teamStatuses: TeamStatusMap;
  sourceSlug: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line md:hidden">
      <div
        aria-hidden="true"
        className={`grid items-center gap-3 border-b border-line bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle ${MOBILE_LOGO_GRID}`}
      >
        {/* An in-flow placeholder holding the logo track open. NOT sr-only:
            that compiles to position:absolute, which takes the element out
            of the grid flow entirely, so every heading below shifted one
            track left and sat over the wrong column. It says nothing either
            way, because this whole strip is aria-hidden. */}
        <span />
        <span>League and your team</span>
      </div>
      <ul
        role="list"
        aria-label="Your Sleeper leagues. Each row gives the league and how your own roster is doing. Tap any row for that league's status and full details."
        className="divide-y divide-line"
      >
        {leagues.map((league) => {
          // Only the label is used here now: the mobile row dropped the status badge,
          // but the button's accessible name still names the league status.
          const { label } = describeStatus(league.status);
          const summary = teamStatuses[league.league_id] ?? null;
          return (
            <li
              key={league.league_id}
              className={`group grid gap-x-3 px-4 transition-colors hover:bg-surface/60 focus-within:bg-surface/60 ${MOBILE_LOGO_GRID}`}
            >
              {/* Column one of the row, spanning the name line and the standing
                  line under it, so it is centred against the pair rather than
                  hanging off the top of the row. */}
              <span className="row-span-2 self-center">
                <LeagueLogo
                  avatarId={league.avatar}
                  name={league.name}
                  size={40}
                />
              </span>
              <button
                type="button"
                onClick={() => onOpen(league.league_id)}
                aria-haspopup="dialog"
                aria-label={`Open details for ${league.name}, ${label}, ${league.total_rosters} teams. ${describeTeamStanding(summary, league.total_rosters)}`}
                className={`grid w-full items-center gap-3 pt-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan ${MOBILE_GRID}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-ink">
                    {league.name}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                    <Users
                      aria-hidden="true"
                      className="h-3 w-3 text-brand-cyan"
                    />
                    {league.total_rosters} teams, {league.season}
                  </span>
                </span>
                <span className="flex justify-end text-ink-subtle">
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </button>
              {/* The row's headline on mobile, not a footnote to it: the width
                  the league-status badge used to take now belongs to this. */}
              <div className="pb-3 pt-2">
                <TeamStandingCell
                  summary={summary}
                  leagueName={league.name}
                  sleeperLeagueId={league.league_id}
                  leagueTeamCount={league.total_rosters}
                  sourceSlug={sourceSlug}
                  size="sm"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- DASHBOARD variant, desktop ---------- */

function DesktopDashboardTable({
  leagues,
  sleeperUsername,
  teamStatuses,
  bulkStatuses,
  sourceSlug,
  featuredId,
  shownIds,
  onSetFeatured,
  onToggleShown,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
  teamStatuses: TeamStatusMap;
  bulkStatuses: BulkStatusMap;
  sourceSlug: string | null;
  featuredId: string | null;
  shownIds: Set<string>;
  onSetFeatured: (id: string | null) => void;
  onToggleShown: (id: string, next: boolean) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Your saved Sleeper leagues. {STANDING_ORDER_NOTE} Click a league name
          to open its deep view. Each row starts with two switches, Featured and
          Shown on profile, which control what appears on your public profile.
        </caption>
        {/* Real table cells throughout, so this one keeps normal table layout
            (columns line up by construction) and its full table semantics.
            Featured and Shown used to be columns five and six. They are switches
            now, stacked inside the League cell, which gave the league names back
            the width two labelled pill buttons were spending. */}
        <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            {/* The logo cell holds a decorative image and nothing to announce,
                so the heading names the column for anyone navigating the table
                by cell without adding a word to any row. */}
            <th scope="col" className="px-4 py-3 text-left">
              <span className="sr-only">League logo</span>
            </th>
            <th scope="col" className="py-3 pr-4 text-left">
              League
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Status
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Teams
            </th>
            <th scope="col" className="px-3 py-3 text-left">
              Your team
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leagues.map((league) => {
            const { label, tone } = describeStatus(league.status);
            const summary = teamStatuses[league.league_id] ?? null;
            const bulkStatus = bulkStatuses[league.league_id] ?? null;
            const isFeatured = featuredId === league.league_id;
            const isShown = shownIds.has(league.league_id);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/40"
              >
                <td className="px-4 py-4 align-middle">
                  <LeagueLogo
                    avatarId={league.avatar}
                    name={league.name}
                    size={48}
                  />
                </td>
                <td className="py-4 pr-4">
                  {/* The switches sit OUTSIDE the link, not merely beside it: a
                      button inside a link is invalid markup and a browser will
                      not let you press it reliably. The link is still the only
                      navigational action on the row; the switches act on it
                      without leaving it. */}
                  <div className="flex items-center gap-3">
                    <LeagueProfileToggles
                      leagueName={league.name}
                      isFeatured={isFeatured}
                      isShown={isShown}
                      onSetFeatured={(next) =>
                        onSetFeatured(next ? league.league_id : null)
                      }
                      onToggleShown={(next) =>
                        onToggleShown(league.league_id, next)
                      }
                    />
                    <LeagueOpenLink
                      sleeperLeagueId={league.league_id}
                      href={leagueHref(
                        league.league_id,
                        sleeperUsername,
                        league.name,
                      )}
                      ariaLabel={`Open ${league.name} deep view`}
                      className="group inline-flex min-w-0 max-w-full flex-col items-start gap-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      <span className="inline-flex max-w-full items-center gap-2 text-base font-semibold text-ink group-hover:text-brand-purple">
                        <span className="truncate">{league.name}</span>
                        <ArrowRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                        />
                      </span>
                      <span className="text-xs text-ink-subtle">
                        {league.season} season
                      </span>
                    </LeagueOpenLink>
                  </div>
                </td>
                <td className="px-3 py-4 text-center">
                  <StatusBadge label={label} tone={tone} />
                </td>
                <td className="px-3 py-4 text-center">
                  <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-ink-muted">
                    <Users
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-brand-cyan"
                    />
                    {league.total_rosters}
                  </span>
                </td>
                <td className="px-3 py-4">
                  <TeamStandingCell
                    summary={summary}
                    leagueName={league.name}
                    sleeperLeagueId={league.league_id}
                    leagueTeamCount={league.total_rosters}
                    sourceSlug={sourceSlug}
                    bulkStatus={bulkStatus}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- DASHBOARD variant, mobile ---------- */

/**
 * Tapping a card opens the detail sheet, the same way the public mobile list
 * works, rather than navigating straight to the league.
 *
 * WHY THE SHEET
 *   Featured and Shown are two 44px circles. On a card that is already carrying
 *   a league name, a status badge, a team count, and two standing pills, they
 *   were a fourth row with a divider above it, which is most of a card spent on
 *   two settings nobody changes twice. They live in the sheet now, so the card
 *   is the scan and the sheet is where you act.
 *
 *   The cost is one extra tap to reach the league. The sheet's own "Open league"
 *   button is that tap, and it is the same button the public tool has had all
 *   along.
 *
 * NOTHING IS LOST AT THIS BREAKPOINT. Featured and Shown are not visible on the
 * card, so they stay in this button's accessible name, and the sheet the button
 * opens leads with them as operable switches. Same arrangement, and the same
 * reasoning, as the league status on the public mobile list.
 */
function MobileDashboardCards({
  leagues,
  teamStatuses,
  bulkStatuses,
  sourceSlug,
  featuredId,
  shownIds,
  onOpen,
}: {
  leagues: SleeperLeague[];
  teamStatuses: TeamStatusMap;
  bulkStatuses: BulkStatusMap;
  sourceSlug: string | null;
  featuredId: string | null;
  shownIds: Set<string>;
  onOpen: (id: string) => void;
}) {
  return (
    <ul
      role="list"
      aria-label="Your saved Sleeper leagues. Tap any card for that league's details, and to feature it or show it on your profile."
      className="space-y-3 md:hidden"
    >
      {leagues.map((league) => {
        const { label, tone } = describeStatus(league.status);
        const summary = teamStatuses[league.league_id] ?? null;
        const bulkStatus = bulkStatuses[league.league_id] ?? null;
        const isFeatured = featuredId === league.league_id;
        const isShown = shownIds.has(league.league_id);
        return (
          <li
            key={league.league_id}
            className={`group grid gap-x-3 rounded-card border border-line bg-surface px-4 transition-colors hover:bg-surface-elevated focus-within:bg-surface-elevated ${MOBILE_LOGO_GRID}`}
          >
            {/* Column one of the card, spanning the name line and the standing
                line under it, so it is centred against the pair. */}
            <span className="row-span-2 self-center">
              <LeagueLogo
                avatarId={league.avatar}
                name={league.name}
                size={40}
              />
            </span>
            {/* The standing block sits below the button rather than inside it:
                it can hold a Sync button, and a button inside a button is
                invalid markup. */}
            <button
              type="button"
              onClick={() => onOpen(league.league_id)}
              aria-haspopup="dialog"
              aria-label={`Open details for ${league.name}, ${label}, ${league.total_rosters} teams. ${isFeatured ? "Featured." : "Not featured."} ${isShown ? "Shown on profile." : "Hidden from profile."} ${describeTeamStanding(summary, league.total_rosters, bulkStatus)}`}
              className="block w-full pt-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan"
            >
              <span className="flex flex-wrap items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-base font-semibold text-ink">
                  {league.name}
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 opacity-60 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
                <StatusBadge label={label} tone={tone} />
              </span>
              <span className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
                <Users aria-hidden="true" className="h-3 w-3 text-brand-cyan" />
                {league.total_rosters} teams, {league.season}
              </span>
            </button>
            <div className="pb-4 pt-3">
              <TeamStandingCell
                summary={summary}
                leagueName={league.name}
                sleeperLeagueId={league.league_id}
                leagueTeamCount={league.total_rosters}
                sourceSlug={sourceSlug}
                bulkStatus={bulkStatus}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Dashboard filter ---------- */

/**
 * Filter panel rendered above the dashboard variant. The toggle starts
 * ON (every synced league visible) so first-time users aren't confused
 * by a partial table. Flipping it OFF narrows the table to leagues the
 * user has explicitly Featured or Shown on their profile.
 */
function DashboardFilter({
  showAll,
  onChange,
  totalCount,
  visibleCount,
  profileLeagueCount,
}: {
  showAll: boolean;
  onChange: (next: boolean) => void;
  totalCount: number;
  visibleCount: number;
  profileLeagueCount: number;
}) {
  return (
    <div
      role="region"
      aria-label="League filters"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/40 px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Filter leagues</p>
          <p className="text-xs text-ink-muted">
            {showAll
              ? `Showing all ${totalCount} ${totalCount === 1 ? "league" : "leagues"}.`
              : profileLeagueCount === 0
                ? "No featured or shown leagues yet. Toggle one below."
                : `Showing ${visibleCount} of ${totalCount} (featured + shown).`}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={showAll}
        aria-label={
          showAll
            ? "Show all leagues is on. Turn off to hide leagues not featured or shown on profile."
            : "Show all leagues is off. Turn on to see every saved league."
        }
        onClick={() => onChange(!showAll)}
        className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          showAll
            ? "border-brand-cyan bg-brand-cyan/15 text-brand-cyan"
            : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
        }`}
      >
        {showAll ? (
          <Eye aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        <span>Show all leagues</span>
      </button>
    </div>
  );
}

function FilterEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6 sm:flex-row sm:items-center">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Trophy className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <p className="text-base font-semibold text-ink">
          No leagues match this filter.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Flip Show all leagues back on, or mark a league Featured or Shown on
          profile below.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex h-10 items-center rounded-card border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Show all leagues
      </button>
    </div>
  );
}

/* ---------- Shared visual pieces ---------- */

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

/* ---------- Status helpers ---------- */

/**
 * Pair the shared humanized label with a Tailwind tone for the badge
 * background. The label comes from {@link humanizeLeagueStatus} so the
 * /tools/league-pulse table, the My Sleeper Leagues dashboard, and the
 * league deep view all render the same string for the same status.
 *
 * Tone mapping is intentionally local, it's a visual concern tied to
 * the badge component, not to the status string itself.
 */
function describeStatus(raw: string): { label: string; tone: string } {
  const label = humanizeLeagueStatus(raw);
  const tone =
    raw === "in_season"
      ? "bg-signal-success/15 text-signal-success"
      : raw === "drafting"
        ? "bg-brand-cyan/15 text-brand-cyan"
        : raw === "pre_draft"
          ? "bg-signal-warning/15 text-signal-warning"
          : raw === "complete"
            ? "bg-ink-subtle/15 text-ink-muted"
            : raw === "post_season"
              ? "bg-brand-purple/15 text-brand-purple"
              : "bg-surface text-ink-muted";
  return { label, tone };
}
