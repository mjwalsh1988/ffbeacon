"use client";

import { useMemo, useState, useTransition } from "react";
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
import type { SleeperLeague } from "@/lib/sleeper";
import { ensureLeagueAndOpen } from "@/app/leagues/actions";
import {
  setFeaturedLeague,
  setLeagueShownOnProfile,
} from "@/app/my-beacon/actions";
import { LeagueDetailSheet } from "./league-detail-sheet";

/**
 * League results render in two variants:
 *
 * - `"public"` (default): the public /tools/league-sync tool. Desktop
 *   shows a full table with every column inline; clicking a row syncs
 *   and navigates straight to the deep view. Mobile shows a compact
 *   3-column table that opens a slide-up modal on tap.
 * - `"dashboard"`: rendered inside /my-beacon/sleeper-leagues. The only
 *   thing that navigates to the deep view is the league name itself —
 *   everything else is non-navigational. The last column carries two
 *   profile toggles (Featured + Show on profile) that persist into
 *   user_preferences.sleeper_league_settings.
 *
 * Two parallel tables (not one with `hidden md:table-cell`) because the
 * desktop rows wrap form elements that would be awkward to thread
 * through a single shared markup tree.
 */
export type LeagueResultsVariant = "public" | "dashboard";

export function LeagueResults({
  variant = "public",
  leagues,
  sleeperUsername,
  featuredLeagueId = null,
  shownLeagueIds = [],
}: {
  variant?: LeagueResultsVariant;
  leagues: SleeperLeague[];
  /** Season is part of each league row already, but kept here so the
   * server caller can keep its existing prop shape. */
  season: string;
  /** The Sleeper handle the user searched for. Forwarded into the deep
   * view's team-filter chip bar on "Open league". */
  sleeperUsername: string | null;
  /** Dashboard variant only — currently pinned league id (Sleeper id). */
  featuredLeagueId?: string | null;
  /** Dashboard variant only — leagues currently visible on the user's
   * profile. */
  shownLeagueIds?: string[];
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
  // every synced league — turning the toggle OFF narrows the table to
  // just the leagues marked Featured or Shown on profile, for users
  // who want their dashboard to mirror exactly what their profile
  // surfaces.
  const [showAll, setShowAll] = useState(true);
  const [, startTransition] = useTransition();

  // Filter the leagues array passed down to the dashboard renderers.
  // When `showAll` is true we pass everything through. When false, we
  // keep only the ones that are explicitly Featured or in the Shown
  // set — leagues the user has signaled they care about for their
  // public profile.
  const visibleLeagues = useMemo(() => {
    if (variant !== "dashboard" || showAll) return leagues;
    return leagues.filter(
      (l) => featuredId === l.league_id || shownIds.has(l.league_id),
    );
  }, [variant, showAll, leagues, featuredId, shownIds]);

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
            <>
              <DesktopDashboardTable
                leagues={visibleLeagues}
                sleeperUsername={sleeperUsername}
                featuredId={featuredId}
                shownIds={shownIds}
                onSetFeatured={handleSetFeatured}
                onToggleShown={handleToggleShown}
              />
              <MobileDashboardCards
                leagues={visibleLeagues}
                sleeperUsername={sleeperUsername}
                featuredId={featuredId}
                shownIds={shownIds}
                onSetFeatured={handleSetFeatured}
                onToggleShown={handleToggleShown}
              />
            </>
          )}
        </>
      ) : (
        <>
          <DesktopPublicTable
            leagues={leagues}
            sleeperUsername={sleeperUsername}
          />
          <MobilePublicTable
            leagues={leagues}
            onOpen={(id) => setOpenLeagueId(id)}
          />
          {openLeague && (
            <LeagueDetailSheet
              league={openLeague}
              open={!!openLeague}
              onClose={() => setOpenLeagueId(null)}
              sleeperUsername={sleeperUsername}
              statusDisplay={describeStatus(openLeague.status).label}
              statusTone={describeStatus(openLeague.status).tone}
            />
          )}
        </>
      )}
    </section>
  );
}

/* ---------- PUBLIC variant — desktop ---------- */

function DesktopPublicTable({
  leagues,
  sleeperUsername,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Your Sleeper leagues. Click any row to sync the league into FF Beacon
          and open its deep view.
        </caption>
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
              Roster
            </th>
            <th scope="col" className="w-10 px-2 py-3 text-right">
              <span className="sr-only">Open league</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leagues.map((league) => {
            const { label, tone } = describeStatus(league.status);
            const positions = aggregatePositions(league.roster_positions ?? []);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/60 focus-within:bg-surface/60"
              >
                <td colSpan={5} className="p-0">
                  <form action={ensureLeagueAndOpen} className="contents">
                    <input
                      type="hidden"
                      name="sleeper_league_id"
                      value={league.league_id}
                    />
                    {sleeperUsername && (
                      <input
                        type="hidden"
                        name="sleeper_username"
                        value={sleeperUsername}
                      />
                    )}
                    <button
                      type="submit"
                      aria-label={`Open ${league.name}, ${label}, ${league.total_rosters} teams`}
                      className="group grid w-full grid-cols-[1fr_8rem_5rem_minmax(12rem,1.5fr)_2rem] items-center gap-3 px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan"
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
                        <Users
                          aria-hidden="true"
                          className="h-3.5 w-3.5 text-brand-cyan"
                        />
                        {league.total_rosters}
                      </span>
                      <span className="min-w-0">
                        <PositionPillRow positions={positions} />
                      </span>
                      <span className="flex justify-end text-ink-subtle group-hover:text-brand-cyan">
                        <ArrowRight
                          aria-hidden="true"
                          className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- PUBLIC variant — mobile ---------- */

function MobilePublicTable({
  leagues,
  onOpen,
}: {
  leagues: SleeperLeague[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line md:hidden">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Your Sleeper leagues. Tap any row to open league details.
        </caption>
        <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">
              League
            </th>
            <th scope="col" className="px-3 py-3 text-center">
              Status
            </th>
            <th scope="col" className="w-10 px-2 py-3 text-right">
              <span className="sr-only">Open details</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {leagues.map((league) => {
            const { label, tone } = describeStatus(league.status);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/60"
              >
                <td colSpan={3} className="p-0">
                  <button
                    type="button"
                    onClick={() => onOpen(league.league_id)}
                    aria-haspopup="dialog"
                    aria-label={`Open details for ${league.name}, ${label}, ${league.total_rosters} teams`}
                    className="group grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan"
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
                        {league.total_rosters} teams · {league.season}
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- DASHBOARD variant — desktop ---------- */

function DesktopDashboardTable({
  leagues,
  sleeperUsername,
  featuredId,
  shownIds,
  onSetFeatured,
  onToggleShown,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
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
              Roster
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
            const positions = aggregatePositions(league.roster_positions ?? []);
            const isFeatured = featuredId === league.league_id;
            const isShown = shownIds.has(league.league_id);
            return (
              <tr
                key={league.league_id}
                className="transition-colors hover:bg-surface/40"
              >
                <td className="px-4 py-4">
                  {/* Form submit is the ONLY navigational action on the
                      row. Status / teams / roster cells beside it are
                      non-interactive. */}
                  <form action={ensureLeagueAndOpen} className="contents">
                    <input
                      type="hidden"
                      name="sleeper_league_id"
                      value={league.league_id}
                    />
                    {sleeperUsername && (
                      <input
                        type="hidden"
                        name="sleeper_username"
                        value={sleeperUsername}
                      />
                    )}
                    <button
                      type="submit"
                      aria-label={`Open ${league.name} deep view`}
                      className="group inline-flex max-w-full flex-col items-start gap-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      <span className="inline-flex items-center gap-2 text-base font-semibold text-ink group-hover:text-brand-purple">
                        <span className="truncate">{league.name}</span>
                        <ArrowRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                        />
                      </span>
                      <span className="text-xs text-ink-subtle">
                        {league.season} season
                      </span>
                    </button>
                  </form>
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
                <td className="min-w-0 px-3 py-4">
                  <PositionPillRow positions={positions} />
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

/* ---------- DASHBOARD variant — mobile ---------- */

function MobileDashboardCards({
  leagues,
  sleeperUsername,
  featuredId,
  shownIds,
  onSetFeatured,
  onToggleShown,
}: {
  leagues: SleeperLeague[];
  sleeperUsername: string | null;
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
        const positions = aggregatePositions(league.roster_positions ?? []);
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
            <form action={ensureLeagueAndOpen} className="contents">
              <input
                type="hidden"
                name="sleeper_league_id"
                value={league.league_id}
              />
              {sleeperUsername && (
                <input
                  type="hidden"
                  name="sleeper_username"
                  value={sleeperUsername}
                />
              )}
              <button
                type="submit"
                aria-label={`Open ${league.name} deep view, ${label}, ${league.total_rosters} teams`}
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
                  {league.total_rosters} teams · {league.season}
                </p>
                {positions.length > 0 && (
                  <div className="mt-3">
                    <PositionPillRow positions={positions} />
                  </div>
                )}
              </button>
            </form>
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
                ? "No featured or shown leagues yet — toggle one below."
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
            : "Show all leagues is off. Turn on to see every synced league."
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

function PositionPillRow({ positions }: { positions: PositionEntry[] }) {
  if (positions.length === 0) {
    return <span className="text-xs text-ink-subtle">No roster data</span>;
  }
  return (
    <ul
      role="list"
      aria-label="Starting roster positions and counts"
      className="flex flex-wrap gap-1.5"
    >
      {positions.map((entry) => {
        const label = POSITION_LABEL[entry.position] ?? entry.position;
        return (
          <li key={entry.position}>
            <span
              aria-label={`${entry.count} ${label} slot${entry.count === 1 ? "" : "s"}`}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-base px-2 py-0.5 text-[11px]"
            >
              <span className="font-mono font-semibold text-brand-cyan">
                {label}
              </span>
              <span aria-hidden="true" className="text-ink-subtle">
                ×
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {entry.count}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Roster aggregation ---------- */

type PositionEntry = { position: string; count: number };

function aggregatePositions(raw: string[]): PositionEntry[] {
  const counts = new Map<string, number>();
  for (const slot of raw) {
    if (slot === "BN") continue;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  const order = [
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "REC_FLEX",
    "SUPER_FLEX",
    "K",
    "DEF",
    "IDP_FLEX",
    "DL",
    "LB",
    "DB",
  ];
  return Array.from(counts.entries())
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([position, count]) => ({ position, count }));
}

const POSITION_LABEL: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  REC_FLEX: "WR/TE",
  SUPER_FLEX: "SF",
  K: "K",
  DEF: "DEF",
  IDP_FLEX: "IDP FLEX",
  DL: "DL",
  LB: "LB",
  DB: "DB",
};

/* ---------- Status helpers ---------- */

function describeStatus(raw: string): { label: string; tone: string } {
  switch (raw) {
    case "in_season":
      return {
        label: "In season",
        tone: "bg-signal-success/15 text-signal-success",
      };
    case "drafting":
      return {
        label: "Drafting",
        tone: "bg-brand-cyan/15 text-brand-cyan",
      };
    case "pre_draft":
      return {
        label: "Pre-draft",
        tone: "bg-signal-warning/15 text-signal-warning",
      };
    case "complete":
      return {
        label: "Complete",
        tone: "bg-ink-subtle/15 text-ink-muted",
      };
    case "post_season":
      return {
        label: "Playoffs",
        tone: "bg-brand-purple/15 text-brand-purple",
      };
    default:
      return {
        label: raw
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        tone: "bg-surface text-ink-muted",
      };
  }
}
