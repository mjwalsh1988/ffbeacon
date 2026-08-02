"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  ChevronRight,
  ArrowRight,
  Users,
  Star,
  Eye,
  EyeOff,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import type { SleeperLeague } from "@/lib/sleeper";
import {
  groupLeaguesByCategory,
  type LeagueCategoryGroup,
} from "@/lib/league-category";
import {
  setFeaturedLeague,
  setLeagueShownOnProfile,
} from "@/app/my-beacon/actions";
import { humanizeLeagueStatus } from "@/lib/league-status";
import type { LeagueTeamStatusSummary } from "@/lib/league-team-status-data";
import type { TeamStatusKey } from "@/lib/league-team-status";
import { TeamStatusBadge, TeamStatusPending } from "@/components/team-status-badge";
import { LeagueDetailSheet } from "./league-detail-sheet";

/** Keyed by Sleeper league id. Absent means we have never pulsed that league. */
export type TeamStatusMap = Record<string, LeagueTeamStatusSummary>;

/**
 * Where a row should land.
 *
 * A league we already know about opens on its Overview, which is what a reader
 * wants when they can already see how their team is doing. A league with no
 * Power Pulse row opens straight on the Power Pulse tab instead, because the
 * only reason that row says "Not yet synced" is that nobody has ever opened it,
 * and Power Pulse is the number they just tried to read.
 *
 * Also forwards ?username= so the deep view knows whose roster to default the
 * Teams chips to, and ?name= so the <title> is right on a league's first open,
 * before the row exists for generateMetadata to read.
 */
function leagueHref(
  leagueId: string,
  sleeperUsername: string | null,
  leagueName: string | null,
  destination: "overview" | "power-pulse" = "overview",
): string {
  const params = new URLSearchParams();
  if (sleeperUsername) {
    params.set("username", sleeperUsername);
  }
  if (leagueName) params.set("name", leagueName);
  const qs = params.toString();
  const base =
    destination === "power-pulse"
      ? `/leagues/${leagueId}/power-pulse`
      : `/leagues/${leagueId}`;
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
 */
const PUBLIC_GRID = "grid-cols-[minmax(0,1fr)_7rem_4.5rem_11rem_2rem]";
const MOBILE_GRID = "grid-cols-[minmax(0,1fr)_6.5rem_1.5rem]";

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
  /** Competitor / Rebuilder standing for this user's own team, for the
   * leagues we have already pulsed. Missing entries render as pending. */
  teamStatuses?: TeamStatusMap;
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

  // Group leagues into type buckets (Dynasty, Redraft, Best Ball Dynasty,
  // Best Ball Redraft), alphabetized within each, so a long list is scannable
  // by format. Public groups the full list; dashboard groups whatever the
  // Show-all filter left visible.
  const publicGroups = useMemo(() => groupLeaguesByCategory(leagues), [leagues]);
  const dashboardGroups = useMemo(
    () => groupLeaguesByCategory(visibleLeagues),
    [visibleLeagues],
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

  return (
    <section aria-labelledby="leagues-heading" className="mt-8">
      <h2 id="leagues-heading" className="sr-only">
        Your Sleeper leagues
      </h2>

      {variant === "dashboard" ? (
        <>
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
            <div className="space-y-8">
              {dashboardGroups.map((group) => (
                <LeagueCategorySection key={group.key} group={group}>
                  <DesktopDashboardTable
                    leagues={group.leagues}
                    sleeperUsername={sleeperUsername}
                    teamStatuses={teamStatuses}
                    featuredId={featuredId}
                    shownIds={shownIds}
                    onSetFeatured={handleSetFeatured}
                    onToggleShown={handleToggleShown}
                  />
                  <MobileDashboardCards
                    leagues={group.leagues}
                    sleeperUsername={sleeperUsername}
                    teamStatuses={teamStatuses}
                    featuredId={featuredId}
                    shownIds={shownIds}
                    onSetFeatured={handleSetFeatured}
                    onToggleShown={handleToggleShown}
                  />
                </LeagueCategorySection>
              ))}
              <StatusLegend />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="space-y-8">
            {publicGroups.map((group) => (
              <LeagueCategorySection key={group.key} group={group}>
                <DesktopPublicList
                  leagues={group.leagues}
                  sleeperUsername={sleeperUsername}
                  teamStatuses={teamStatuses}
                />
                <MobilePublicList
                  leagues={group.leagues}
                  teamStatuses={teamStatuses}
                  onOpen={(id) => setOpenLeagueId(id)}
                />
              </LeagueCategorySection>
            ))}
          </div>
          <StatusLegend />
          {openLeague && (
            <LeagueDetailSheet
              league={openLeague}
              open={!!openLeague}
              onClose={() => setOpenLeagueId(null)}
              sleeperUsername={sleeperUsername}
              statusDisplay={describeStatus(openLeague.status).label}
              statusTone={describeStatus(openLeague.status).tone}
              teamStatus={teamStatuses[openLeague.league_id]?.status ?? null}
            />
          )}
        </>
      )}
    </section>
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
          {group.leagues.length} {group.leagues.length === 1 ? "league" : "leagues"}
        </span>
      </h3>
      {children}
    </div>
  );
}

/* ---------- PUBLIC variant, desktop ---------- */

/**
 * Deliberately a list of links rather than a table.
 *
 * Every row here is one link and nothing else: there is no per-cell content a
 * reader can act on independently, so the table markup it used to carry bought
 * no navigation and cost the alignment. A real table sizes its columns from its
 * cells, and this list has exactly one cell per row (the row-spanning link), so
 * the headings were sized by their own text while the values inside the link
 * were sized by a grid. The two never agreed, which is why the Teams heading
 * sat off its numbers.
 *
 * As a list, the header strip and every row share one grid template and the
 * browser cannot disagree with itself. The strip is aria-hidden because each
 * link already announces its league, status, team count, and standing in full.
 */
function DesktopPublicList({
  leagues,
  sleeperUsername,
  teamStatuses,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
  teamStatuses: TeamStatusMap;
}) {
  return (
    <div className="hidden overflow-hidden rounded-card border border-line md:block">
      <div
        aria-hidden="true"
        className={`grid items-center gap-3 border-b border-line bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle ${PUBLIC_GRID}`}
      >
        <span>League</span>
        <span className="text-center">Status</span>
        <span className="text-center">Teams</span>
        <span>Your team</span>
        <span />
      </div>
      <ul
        role="list"
        aria-label="Your Sleeper leagues. Each row gives the league name, its Sleeper status, team count, and how your own roster is doing."
        className="divide-y divide-line"
      >
        {leagues.map((league) => {
          const { label, tone } = describeStatus(league.status);
          const teamStatus = teamStatuses[league.league_id]?.status ?? null;
          return (
            <li
              key={league.league_id}
              className="transition-colors hover:bg-surface/60 focus-within:bg-surface/60"
            >
              <Link
                href={leagueHref(
                  league.league_id,
                  sleeperUsername,
                  league.name,
                  teamStatus ? "overview" : "power-pulse",
                )}
                aria-label={
                  teamStatus
                    ? `Open ${league.name}, ${label}, ${league.total_rosters} teams. Your team: ${teamStatus.label}. ${teamStatus.reason}`
                    : `Open ${league.name}, ${label}, ${league.total_rosters} teams. Your team has no Power Pulse yet; this opens the Power Pulse tab, which calculates it.`
                }
                className={`group grid w-full items-center gap-3 px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan ${PUBLIC_GRID}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-ink">
                    {league.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-subtle">
                    {league.season} season
                  </span>
                </span>
                <span className="flex justify-center">
                  <StatusBadge label={label} tone={tone} />
                </span>
                <span className="flex items-center justify-center gap-1.5 font-mono tabular-nums text-ink-muted">
                  <Users aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
                  {league.total_rosters}
                </span>
                <span className="flex min-w-0 justify-start">
                  {teamStatus ? (
                    <TeamStatusBadge status={teamStatus} />
                  ) : (
                    <TeamStatusPending />
                  )}
                </span>
                <span className="flex justify-end text-ink-subtle group-hover:text-brand-cyan">
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- PUBLIC variant, mobile ---------- */

/** Same reasoning as the desktop list, one breakpoint down. Tapping a row
 *  opens the detail sheet instead of navigating, so the row is a button. */
function MobilePublicList({
  leagues,
  teamStatuses,
  onOpen,
}: {
  leagues: SleeperLeague[];
  teamStatuses: TeamStatusMap;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line md:hidden">
      <div
        aria-hidden="true"
        className={`grid items-center gap-3 border-b border-line bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle ${MOBILE_GRID}`}
      >
        <span>League</span>
        <span className="text-center">Status</span>
        <span />
      </div>
      <ul
        role="list"
        aria-label="Your Sleeper leagues. Tap any row for that league's details."
        className="divide-y divide-line"
      >
        {leagues.map((league) => {
          const { label, tone } = describeStatus(league.status);
          const teamStatus = teamStatuses[league.league_id]?.status ?? null;
          return (
            <li
              key={league.league_id}
              className="transition-colors hover:bg-surface/60"
            >
              <button
                type="button"
                onClick={() => onOpen(league.league_id)}
                aria-haspopup="dialog"
                aria-label={`Open details for ${league.name}, ${label}, ${league.total_rosters} teams. Your team: ${
                  teamStatus ? teamStatus.label : "not synced yet"
                }`}
                className={`group grid w-full items-center gap-3 px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan ${MOBILE_GRID}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-ink">
                    {league.name}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                    <Users aria-hidden="true" className="h-3 w-3 text-brand-cyan" />
                    {league.total_rosters} teams, {league.season}
                  </span>
                  {/* Desktop gives this its own column. Mobile keeps it inline
                      rather than dropping it, so no breakpoint hides a value
                      the other one shows. */}
                  <span className="mt-1.5 block">
                    {teamStatus ? (
                      <TeamStatusBadge status={teamStatus} size="sm" />
                    ) : (
                      <TeamStatusPending size="sm" />
                    )}
                  </span>
                </span>
                <span className="flex justify-center">
                  <StatusBadge label={label} tone={tone} />
                </span>
                <span className="flex justify-end text-ink-subtle">
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </button>
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
  featuredId,
  shownIds,
  onSetFeatured,
  onToggleShown,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
  teamStatuses: TeamStatusMap;
  featuredId: string | null;
  shownIds: Set<string>;
  onSetFeatured: (id: string | null) => void;
  onToggleShown: (id: string, next: boolean) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Your saved Sleeper leagues. Click a league name to open its deep
          view. Use the Featured and Show on profile toggles in the last
          columns to control what appears on your public profile.
        </caption>
        {/* Real table cells throughout, so this one keeps normal table layout
            (columns line up by construction) and its full table semantics. */}
        <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">
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
            <th scope="col" className="px-3 py-3 text-center">
              Featured
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Show on profile
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leagues.map((league) => {
            const { label, tone } = describeStatus(league.status);
            const teamStatus = teamStatuses[league.league_id]?.status ?? null;
            const isFeatured = featuredId === league.league_id;
            const isShown = shownIds.has(league.league_id);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/40"
              >
                <td className="px-4 py-4">
                  {/* The league-name link is the ONLY navigational action on
                      the row. Status / teams / standing cells beside it are
                      non-interactive. */}
                  <Link
                    href={leagueHref(
                      league.league_id,
                      sleeperUsername,
                      league.name,
                      teamStatus ? "overview" : "power-pulse",
                    )}
                    aria-label={`Open ${league.name} deep view`}
                    className="group inline-flex max-w-full flex-col items-start gap-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
                  </Link>
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
                  {teamStatus ? (
                    <TeamStatusBadge status={teamStatus} />
                  ) : (
                    <TeamStatusPending />
                  )}
                </td>
                <td className="px-3 py-4 text-center">
                  <FeaturedToggle
                    leagueName={league.name}
                    isFeatured={isFeatured}
                    onChange={(next) =>
                      onSetFeatured(next ? league.league_id : null)
                    }
                  />
                </td>
                <td className="px-3 py-4 text-center">
                  <ShownToggle
                    leagueName={league.name}
                    isShown={isShown}
                    onChange={(next) => onToggleShown(league.league_id, next)}
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

function MobileDashboardCards({
  leagues,
  sleeperUsername,
  teamStatuses,
  featuredId,
  shownIds,
  onSetFeatured,
  onToggleShown,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
  teamStatuses: TeamStatusMap;
  featuredId: string | null;
  shownIds: Set<string>;
  onSetFeatured: (id: string | null) => void;
  onToggleShown: (id: string, next: boolean) => void;
}) {
  return (
    <ul
      role="list"
      aria-label="Your saved Sleeper leagues"
      className="space-y-3 md:hidden"
    >
      {leagues.map((league) => {
        const { label, tone } = describeStatus(league.status);
        const teamStatus = teamStatuses[league.league_id]?.status ?? null;
        const isFeatured = featuredId === league.league_id;
        const isShown = shownIds.has(league.league_id);
        return (
          <li
            key={league.league_id}
            className="rounded-card border border-line bg-surface"
          >
            {/* League-name link is the only navigational action.
                Toggle row sits beneath it, separated by a visible
                divider so the tap zones don't compete. */}
            <Link
              href={leagueHref(
                league.league_id,
                sleeperUsername,
                league.name,
                teamStatus ? "overview" : "power-pulse",
              )}
              aria-label={`Open ${league.name} deep view, ${label}, ${league.total_rosters} teams. Your team: ${
                teamStatus ? teamStatus.label : "not synced yet"
              }`}
              className="group block w-full p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-base font-semibold text-ink group-hover:text-brand-purple">
                  {league.name}
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 opacity-60 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </span>
                <StatusBadge label={label} tone={tone} />
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
                <Users
                  aria-hidden="true"
                  className="h-3 w-3 text-brand-cyan"
                />
                {league.total_rosters} teams, {league.season}
              </p>
              <div className="mt-3">
                {teamStatus ? (
                  <TeamStatusBadge status={teamStatus} />
                ) : (
                  <TeamStatusPending />
                )}
              </div>
            </Link>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <FeaturedToggle
                leagueName={league.name}
                isFeatured={isFeatured}
                onChange={(next) =>
                  onSetFeatured(next ? league.league_id : null)
                }
              />
              <ShownToggle
                leagueName={league.name}
                isShown={isShown}
                onChange={(next) => onToggleShown(league.league_id, next)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Legend ---------- */

/**
 * What the tags mean, once, under the list.
 *
 * Each entry leads with the real badge rather than a coloured word, so the
 * reader learns the icon here and recognizes it everywhere else in League
 * Pulse without having to read the label again.
 */
function StatusLegend() {
  return (
    <div className="mt-6 rounded-card border border-line bg-surface/40 px-4 py-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        Reading the Your team column
      </h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-xs leading-relaxed text-ink-muted sm:grid-cols-2">
        {LEGEND_ENTRIES.map((entry) => (
          <div key={entry.key} className="flex items-start gap-2.5">
            <dt className="shrink-0">
              <TeamStatusBadge
                status={{
                  key: entry.key,
                  label: entry.label,
                  short: entry.label,
                  // The definition sits in the dd beside it, so the badge does
                  // not repeat it into the accessibility tree.
                  reason: "",
                }}
                size="sm"
              />
            </dt>
            <dd className="min-w-0">{entry.blurb}</dd>
          </div>
        ))}
        <div className="flex items-start gap-2.5">
          <dt className="shrink-0">
            <TeamStatusPending size="sm" />
          </dt>
          <dd className="min-w-0">
            We have never loaded this league. Open it and Power Pulse
            calculates on arrival.
          </dd>
        </div>
      </dl>
    </div>
  );
}

const LEGEND_ENTRIES: {
  key: TeamStatusKey;
  label: string;
  blurb: string;
}[] = [
  {
    key: "competitor",
    label: "Competitor",
    blurb:
      "Near the top of the league by Power Pulse, which projects how many games a roster should win from here.",
  },
  {
    key: "middle",
    label: "Middle of the pack",
    blurb: "Mid-table on expected wins and on what the roster is worth.",
  },
  {
    key: "rebuilder",
    label: "Rebuilder",
    blurb:
      "Low on expected wins, usually while holding more trade value than the lineup can convert.",
  },
];

/* ---------- Toggles ---------- */

function FeaturedToggle({
  leagueName,
  isFeatured,
  onChange,
}: {
  leagueName: string;
  isFeatured: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isFeatured}
      aria-label={
        isFeatured
          ? `Featured league. Tap to unfeature ${leagueName}.`
          : `Feature ${leagueName} on your profile. Only one league can be featured at a time.`
      }
      onClick={() => onChange(!isFeatured)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
        isFeatured
          ? "border-brand-purple bg-brand-purple/15 text-brand-purple"
          : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
      }`}
    >
      <Star
        aria-hidden="true"
        className={`h-3.5 w-3.5 ${isFeatured ? "fill-current" : ""}`}
      />
      <span>{isFeatured ? "Featured" : "Feature"}</span>
    </button>
  );
}

function ShownToggle({
  leagueName,
  isShown,
  onChange,
}: {
  leagueName: string;
  isShown: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isShown}
      aria-label={
        isShown
          ? `Visible on profile. Tap to hide ${leagueName}.`
          : `Hidden from profile. Tap to show ${leagueName}.`
      }
      onClick={() => onChange(!isShown)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
        isShown
          ? "border-brand-cyan bg-brand-cyan/15 text-brand-cyan"
          : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
      }`}
    >
      {isShown ? (
        <Eye aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      <span>{isShown ? "Shown" : "Hidden"}</span>
    </button>
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
          Flip Show all leagues back on, or mark a league Featured or Shown
          on profile below.
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
