"use client";

import { X, Users, CalendarDays, Trophy, ArrowRight } from "lucide-react";
import { LeagueOpenLink } from "@/components/league-open-link";
import { LeagueLogo } from "@/components/league-logo";
import type { SleeperLeague } from "@/lib/sleeper";
import type { LeagueTeamStatusSummary } from "@/lib/league-team-status-data";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import {
  TeamStatusBadge,
  TeamStatusPending,
} from "@/components/team-status-badge";
import { TeamStandingFigure } from "@/components/team-standing-figure";
import { LeagueSyncButton } from "@/components/league-sync-button";
import { LeagueProfileToggles } from "@/components/league-profile-toggles";

/**
 * The Featured / Shown pair, when the surface that opened this sheet has them.
 *
 * Dashboard only. The public tool has no profile to put a league on, so it
 * passes nothing and the section does not render.
 */
export type LeagueProfileControls = {
  isFeatured: boolean;
  isShown: boolean;
  onSetFeatured: (next: boolean) => void;
  onToggleShown: (next: boolean) => void;
};

/**
 * Slide-up modal showing the deep details for a single Sleeper league,
 * teams, season, status, where this user's own team stands, and the action
 * button that syncs the league into our DB and opens its deep view.
 */
export function LeagueDetailSheet({
  league,
  open,
  onClose,
  sleeperUsername,
  statusDisplay,
  statusTone,
  summary,
  sourceSlug,
  profile,
}: {
  league: SleeperLeague;
  open: boolean;
  onClose: () => void;
  /** Forwarded to the Open League server action so the deep view can
   * default its team-filter chip bar to the user's roster. */
  sleeperUsername: string | null;
  /** Human-readable status string (e.g. "In season"). */
  statusDisplay: string;
  /** Tailwind classes for the status badge background + text. */
  statusTone: string;
  /** This user's own standing in the league, tag plus the numbers behind it.
   * Null when the league has never been pulsed. */
  summary: LeagueTeamStatusSummary | null;
  /** Active value source, so the FF Beacon mark only appears next to FF
   * Beacon's own values. */
  sourceSlug: string | null;
  /** Dashboard only. Omitted on the public tool, where there is no profile. */
  profile?: LeagueProfileControls;
}) {
  const teamStatus = summary?.status ?? null;
  // Plain link to the deep view so the branded loading boundary shows
  // instantly on click; the deep-view page runs the sync under the loader.
  // ?name= gives the deep view a correct <title> on first open, before the
  // league row is synced (the DB name takes precedence once it exists).
  // Always the Overview, whether or not the league has been pulsed before:
  // the front door, not a sub-page of a league nobody has opened yet.
  const hrefParams = new URLSearchParams();
  if (sleeperUsername) {
    hrefParams.set("username", sleeperUsername);
  }
  hrefParams.set("name", league.name);
  const href = `/leagues/${league.league_id}?${hrefParams.toString()}`;

  return (
    <SlideUpDialog
      open={open}
      onClose={onClose}
      label={`${league.name} details`}
      showClose={false}
    >
      <div className="flex h-full flex-col">
        {/* Header, name + close. The close button is the first focusable
            element so screen reader users can dismiss without tab-trawling. */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          {/* The same logo the reader tapped on the list, so the sheet is
              visibly the thing they opened. Decorative: the name is right
              beside it as the heading. */}
          <span className="mt-1 shrink-0">
            <LeagueLogo avatarId={league.avatar} name={league.name} size={48} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              League details
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-ink sm:text-xl">
              {league.name}
            </h2>
            <div className="mt-2 inline-flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}
              >
                {statusDisplay}
              </span>
              <span className="text-xs text-ink-subtle">
                {league.season}, {league.total_rosters} teams
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close league details"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body, stays inside the sheet so the header and
            footer remain visible on small viewports. */}
        <div className="beacon-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {/* First in the body, above the facts, because it is the only thing
              here you can change. The facts below are read-only. This is also
              the ONLY place these two controls exist on a phone: the desktop
              table stacks them in the League cell, and a card small enough to
              scan one-handed has no room for them. */}
          {profile && (
            <section aria-labelledby="profile-heading" className="mb-6">
              <h3
                id="profile-heading"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
              >
                On your profile
              </h3>
              <div className="mt-3 rounded-card border border-line bg-base/60 p-3">
                <LeagueProfileToggles
                  variant="list"
                  leagueName={league.name}
                  isFeatured={profile.isFeatured}
                  isShown={profile.isShown}
                  onSetFeatured={profile.onSetFeatured}
                  onToggleShown={profile.onToggleShown}
                />
              </div>
            </section>
          )}

          <dl className="grid grid-cols-3 gap-3">
            <FactCard
              icon={Users}
              label="Teams"
              value={String(league.total_rosters)}
            />
            <FactCard
              icon={CalendarDays}
              label="Season"
              value={league.season}
            />
            <FactCard icon={Trophy} label="Status" value={statusDisplay} />
          </dl>

          <section aria-labelledby="standing-heading" className="mt-6">
            <h3
              id="standing-heading"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
            >
              Your team
            </h3>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {teamStatus && summary ? (
                <>
                  <TeamStatusBadge status={teamStatus} />
                  <TeamStandingFigure
                    statusKey={teamStatus.key}
                    projectedSeed={summary.projectedSeed}
                    rankedTeamCount={summary.rankedTeamCount}
                    valueRank={summary.valueRank}
                    totalValue={summary.totalValue}
                    valueIsExact={summary.valueIsExact}
                    leagueTeamCount={league.total_rosters}
                    sourceSlug={sourceSlug}
                  />
                </>
              ) : (
                <>
                  <TeamStatusPending />
                  {/* Same button and same queue as the row behind this sheet:
                      syncing from here still holds the reader's one slot. */}
                  <LeagueSyncButton
                    sleeperLeagueId={league.league_id}
                    leagueName={league.name}
                  />
                </>
              )}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {teamStatus
                ? teamStatus.reason
                : "We have never loaded this league, so there is nothing to compare your roster against yet. Sync it here, or open it, and Power Pulse calculates."}
            </p>
          </section>
        </div>

        {/* Footer action, primary CTA stays visible without scrolling.
            Full width and on its own line. This sheet only ever opens on a
            phone, where a button sharing a row with its own explanation ends up
            narrow, right-aligned, and awkward to hit one-handed. The helper text
            sits above it instead. */}
        <div className="border-t border-line bg-surface px-5 py-4 sm:px-6 sm:py-5">
          <p className="text-xs text-ink-muted">
            {teamStatus
              ? "Opens the deep view, including rosters, transactions, and power rankings."
              : "Opens the deep view and calculates this league for the first time."}
          </p>
          <LeagueOpenLink
            sleeperLeagueId={league.league_id}
            href={href}
            ariaLabel={
              teamStatus
                ? `Open ${league.name} deep view`
                : `Open ${league.name} deep view, which calculates this league for the first time`
            }
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Open league
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </LeagueOpenLink>
        </div>
      </div>
    </SlideUpDialog>
  );
}

function FactCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-line bg-base/60 p-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-base font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}
