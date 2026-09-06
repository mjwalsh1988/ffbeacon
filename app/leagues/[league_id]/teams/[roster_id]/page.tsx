import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { formatTeamLabel } from "@/lib/team-label";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
} from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { loadPowerPulseView } from "@/lib/league-power-pulse-data";
import { loadLeagueReadiness } from "@/lib/league-readiness";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import type { SleeperLeague } from "@/lib/sleeper";
import { TeamCard } from "@/components/team-card";
import { PicksToggle } from "@/components/picks-toggle";
import { LeagueShell } from "@/components/league-shell";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { formatRelative } from "@/lib/datetime";

export const dynamic = "force-dynamic";

type Params = Promise<{ league_id: string; roster_id: string }>;
type Search = Promise<{ source?: string; username?: string; picks?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { league_id, roster_id } = await params;
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("sleeper_league_id", league_id)
    .maybeSingle();
  if (!league) return { title: "Team not found" };
  const { data: roster } = await supabase
    .from("rosters")
    .select("id, owner_user_id")
    .eq("league_id", league.id)
    .eq("sleeper_roster_id", Number(roster_id))
    .maybeSingle();
  if (!roster) return { title: "Team not found" };
  const { data: user } = roster.owner_user_id
    ? await supabase
        .from("league_users")
        .select("display_name, team_name")
        .eq("league_id", league.id)
        .eq("sleeper_user_id", roster.owner_user_id)
        .maybeSingle()
    : { data: null };
  const teamName = formatTeamLabel({
    teamName: user?.team_name,
    username: user?.display_name,
    sleeperRosterId: roster_id,
  });
  const title = `${teamName}, ${league.name}`;
  const description = `Roster, draft picks, and value breakdown for ${teamName} in ${league.name}.`;
  const ogPath = `/api/og/team/${league_id}/${roster_id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogPath],
    },
  };
}

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { league_id: sleeperLeagueId, roster_id } = await params;
  const {
    source: sourceParam,
    username: usernameParam,
    picks: picksParam,
  } = await searchParams;
  const sleeperRosterId = Number(roster_id);
  if (!Number.isFinite(sleeperRosterId)) notFound();

  const supabase = await createClient();

  // Who this page is acting for: the ?username= handle when there is one,
  // otherwise the reader's own saved handle (lib/sleeper-handle/resolve.ts).
  // `linkUsername` is what a link built here may carry, which is the handle
  // only when the reader arrived on one.
  const viewer = await resolveSleeperViewer(supabase, usernameParam);
  const linkUsername = viewerLinkUsername(viewer);
  const adminClient = createAdminClient();

  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  // Source respects the user's selection; format is derived from the
  // league's actual Sleeper settings, NOT the user's global format toggle.
  // See CLAUDE.md → League Pulse Format Resolution.
  const resolvedSource = await resolveSourceSlug(supabase, sourceParam);
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(
    adminClient,
    sleeperLeague,
    resolvedSource.slug,
  );

  const formatConfigId =
    context.coverage === "none" ? null : context.formatConfigId;
  const effectiveSourceSlug =
    context.coverage === "none" ? null : context.sourceSlug;

  // Draft picks only carry value in dynasty leagues, so the "Include draft
  // picks" toggle is dynasty-only and matches the league overview. Default ON;
  // `?picks=off` shows player value only. Redraft forces picks off.
  const isDynasty = context.derived.league_type === "dynasty";
  const includePicks = isDynasty ? picksParam !== "off" : false;
  const showPicksToggle = isDynasty && context.coverage !== "none";

  // Single shared loader: the league inline view uses this for N teams,
  // we use it for one team. Same code path → identical visuals.
  const allTeams = await loadLeagueTeamCards(
    supabase,
    league.id,
    formatConfigId,
    effectiveSourceSlug,
    league.season != null ? String(league.season) : null,
    league.status ?? null,
    includePicks,
  );
  const team = allTeams.find((t) => t.sleeperRosterId === sleeperRosterId);
  if (!team) notFound();

  // Contender / Bubble / Rebuilder, the same tag this team wears
  // on the league list, the rankings table, and the Power Pulse tab. Skipped
  // entirely for a league that has not drafted, where there is nothing to call.
  const readiness = await loadLeagueReadiness(
    supabase,
    league.id,
    Number(league.season ?? 0),
    league.status ?? null,
  );
  const pulseView =
    readiness.preDraft || league.season == null
      ? null
      : await loadPowerPulseView(
          supabase,
          league.id,
          Number(league.season),
          formatConfigId,
          effectiveSourceSlug,
        );
  const teamStatus =
    pulseView?.teams.find((t) => t.rosterRowId === team.rosterRowId)?.status ?? null;

  const sourceDisplay =
    context.coverage === "none" ? "N/A" : context.sourceDisplay;
  const formatDisplay =
    context.coverage === "none" ? "N/A" : context.formatDisplay;

  // Shared header action data (in-view switcher + admin refresh gate).
  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    viewer,
    league.season != null ? String(league.season) : null,
  );

  // Back-links forward the handle only for a reader who arrived on one, so
  // the switcher and overview context survive a shared link without a saved
  // reader publishing their own handle. The copy link stays clean either way.
  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(linkUsername)}`
    : `/leagues/${sleeperLeagueId}`;
  const backToTeamsHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(linkUsername)}#team-${sleeperRosterId}`
    : `/leagues/${sleeperLeagueId}?tab=teams#team-${sleeperRosterId}`;

  // The same masthead every other League Pulse section carries. A team page is
  // still a view of one league, so it opens on the league's identity and the
  // team's own card follows underneath as an h2. The coverage and pick-source
  // notes that used to sit in this page's header are part of the masthead now,
  // so they read identically here and on every other section.
  const coverageOk = context.coverage !== "none";
  const mastheadProps = {
    leagueName: league.name,
    avatarId: sleeperLeague.avatar ?? null,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags: buildLeagueFormatTags({
      rosterPositions: league.roster_positions,
      scoringSettings: league.scoring_settings,
      teamCount: league.total_rosters,
    }),
    scoringTags: buildLeagueScoringTags(league.scoring_settings),
    lastUpdatedLabel: league.last_pulsed_at
      ? formatRelative(league.last_pulsed_at)
      : "never",
    // This page reads the already-synced rows rather than pulsing the league
    // itself, so whatever it shows came from the cache by definition.
    cached: true,
    coverage: context.coverage,
    sourceDisplay,
    formatDisplay,
    derivedLabel: describeDerived(context.derived),
    fallbackDisplay:
      context.coverage === "fallback" ? (context.fallback?.derivedDisplay ?? null) : null,
    pickSourceDisplay:
      coverageOk && context.pickSource && context.pickSource.slug !== context.sourceSlug
        ? context.pickSource.display
        : null,
  };

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="teams"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: team.teamName }]}
      copyHref={`/leagues/${sleeperLeagueId}/teams/${roster_id}`}
      copyAriaLabel="Copy link to this team"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <div className="space-y-6">
        {showPicksToggle && (
          <div className="flex justify-start">
            <PicksToggle includePicks={includePicks} />
          </div>
        )}
        <TeamCard
          data={team}
          sleeperLeagueId={sleeperLeagueId}
          showViewTeamPageLink={false}
          headingLevel="h2"
          valueIsBeacon={effectiveSourceSlug === "ffbeacon"}
          teamStatus={teamStatus}
          sourceSlug={effectiveSourceSlug}
          isDynasty={isDynasty}
        />

        {/* Head-to-head, with this league already attached. The Breakdown reads
            the league and roster straight off the URL, so the comparison it runs
            is scored under this league's own rules and measured against this
            roster's remaining weeks rather than a generic format. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <Link
            href={`/tools/beacon-breakdown?league=${encodeURIComponent(sleeperLeagueId)}&roster=${sleeperRosterId}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Compare two players for this team
          </Link>
          <p className="text-xs text-ink-subtle">
            Opens the Beacon Breakdown with this league connected, so it prices both players
            against this roster.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <Link
            href={backToTeamsHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 py-2 text-sm font-medium text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            aria-label="Back to league with all teams side-by-side"
          >
            <span aria-hidden="true">←</span>
            Back to league
          </Link>
          <p className="text-xs text-ink-subtle">
            Browse and compare every team side-by-side from the league view.
          </p>
        </div>
      </div>
    </LeagueShell>
  );
}
