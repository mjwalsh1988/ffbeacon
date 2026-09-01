import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { projectLeagueActivity } from "@/lib/league-activity/project";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, describeDerived } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { LeagueShell } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { LeagueActivityPanel } from "@/components/league-activity/activity-panel";
import {
  ACTIVITY_DEFAULT_DAYS,
  ACTIVITY_MAX_ROWS,
  loadLeagueActivity,
  parseRosterId,
  parseWindowDays,
} from "@/lib/league-activity/load";
import { isActivityCategory, type ActivityCategory } from "@/lib/league-activity/types";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { formatRelative } from "@/lib/datetime";
import {
  ArrowRight,
  ArrowLeftRight,
  CalendarDays,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The full activity log.
 *
 * The same panel the overview carries, unbounded in height and with the team
 * filter switched on. There is deliberately no second implementation: both
 * surfaces call `loadLeagueActivity` and render `LeagueActivityPanel`, so the
 * page and the panel can never disagree about what happened in a league.
 *
 * THE DERIVED SYNC RUNS INSIDE THE BOUNDARY, NOT BEFORE IT. Projection of
 * transactions and results into the log is part of `pulseLeagueDerived`, and
 * that is the slow half of a league sync. Awaiting it above the shell would
 * hold a blank screen for the whole thing; awaiting it inside the feed's own
 * Suspense boundary paints the league's name, tabs and masthead immediately.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league_id: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("name")
    .eq("sleeper_league_id", league_id)
    .maybeSingle();
  if (!league) return { title: "League not found" };

  const title = `${league.name} activity`;
  const description = `Every trade, waiver claim, lineup change, result and rule change recorded for ${league.name}.`;
  const ogPath = `/api/og/league/${league_id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, images: [ogPath] },
  };
}

export default async function LeagueActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{
    username?: string;
    source?: string;
    adays?: string;
    acat?: string;
    ateam?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim() ? sp.username.trim() : null;

  const adminClient = createAdminClient();
  const pulseResult = await pulseLeagueCore(adminClient, sleeperLeagueId);
  if (!pulseResult.ok) notFound();

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  const sleeperLeague = league.metadata as unknown as Parameters<
    typeof resolveLeagueContext
  >[1];
  const [{ otherLeagues }, context] = await Promise.all([
    loadLeagueHeaderActions(
      supabase,
      league.id,
      sleeperLeagueId,
      searchedUsername,
      league.season != null ? String(league.season) : null,
    ),
    resolveSourceSlug(supabase, sp.source).then((resolved) =>
      resolveLeagueContext(adminClient, sleeperLeague, resolved.slug),
    ),
  ]);

  const days = parseWindowDays(sp.adays);
  const category: ActivityCategory | null = isActivityCategory(sp.acat) ? sp.acat : null;
  const rosterId = parseRosterId(sp.ateam);

  const homeHref = searchedUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
    : "/tools/league-pulse";
  const leagueHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}`;
  const teamsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}?tab=teams`;
  const transactionsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/transactions?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/transactions`;
  const scheduleHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/schedules?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/schedules`;

  const formatTags = buildLeagueFormatTags({
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teamCount: league.total_rosters,
  });
  const scoringTags = buildLeagueScoringTags(league.scoring_settings);
  const coverageOk = context.coverage !== "none";
  const mastheadProps = {
    leagueName: league.name,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags,
    scoringTags,
    lastUpdatedLabel: formatRelative(league.last_pulsed_at),
    cached: pulseResult.cached,
    coverage: context.coverage,
    sourceDisplay: coverageOk ? context.sourceDisplay : "N/A",
    formatDisplay: coverageOk ? context.formatDisplay : "N/A",
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
      activeTab="activity"
      searchedUsername={searchedUsername}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Activity" }]}
      copyHref={`/leagues/${sleeperLeagueId}/activity`}
      copyAriaLabel="Copy link to this league's activity log"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<FeedSkeleton />}>
            <ActivityFeed
              leagueRowId={league.id}
              sleeperLeagueId={sleeperLeagueId}
              searchedUsername={searchedUsername}
              sourceParam={typeof sp.source === "string" ? sp.source : null}
              days={days}
              category={category}
              rosterId={rosterId}
              season={league.season ?? 0}
              currentWeek={readCurrentWeek(league.metadata)}
              resynced={!pulseResult.cached}
            />
          </Suspense>
        </div>

        <aside
          aria-label="League links"
          className="space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
        >
          <Panel eyebrow="How this works" title="What lands in the log">
            <dl className="space-y-3 text-[13px] leading-relaxed">
              <div>
                <dt className="font-semibold text-ink">Timed to the second</dt>
                <dd className="mt-0.5 text-ink-muted">
                  Trades, waiver claims and free agent moves. Sleeper records when each one
                  happened, so the log prints that time.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Timed to the week</dt>
                <dd className="mt-0.5 text-ink-muted">
                  Final scores. One entry per game, carrying both the win and the loss, so a
                  result is never posted twice.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Spotted between syncs</dt>
                <dd className="mt-0.5 text-ink-muted">
                  Lineup edits, scoring and roster rule changes, managers arriving and leaving.
                  Sleeper timestamps none of these, so each entry says the window it was seen
                  in rather than a time nobody measured.
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel eyebrow="Go deeper" title="Explore this league">
            <ul className="space-y-2">
              <li>
                <ExploreLink
                  href={leagueHref}
                  icon={LayoutDashboard}
                  label="Overview"
                  hint="Rankings and league snapshot"
                />
              </li>
              <li>
                <ExploreLink
                  href={teamsHref}
                  icon={Users}
                  label="Teams and rosters"
                  hint="Compare every roster side by side"
                />
              </li>
              <li>
                <ExploreLink
                  href={scheduleHref}
                  icon={CalendarDays}
                  label="Schedules"
                  hint="Every week, every matchup, both lineups"
                />
              </li>
              <li>
                <ExploreLink
                  href={transactionsHref}
                  icon={ArrowLeftRight}
                  label="Transactions"
                  hint="The same moves, with what they were worth"
                />
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </LeagueShell>
  );
}

async function ActivityFeed({
  leagueRowId,
  sleeperLeagueId,
  searchedUsername,
  sourceParam,
  days,
  category,
  rosterId,
  season,
  currentWeek,
  resynced,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  sourceParam: string | null;
  days: number;
  category: ActivityCategory | null;
  rosterId: number | null;
  season: number;
  currentWeek: number | null;
  resynced: boolean;
}) {
  // WHAT THIS PAGE ACTUALLY NEEDS IS ONE STAGE OF THE DERIVED PASS.
  //
  // It used to await the whole of `pulseLeagueDerived`, which meant waiting on
  // Power Pulse, the power-rankings recompute and the draft-pick capture, none
  // of which puts anything on this page. On a cached load that was roughly 270
  // ms of pure waiting for a feed that needed none of it.
  //
  // A resync is different: the transactions the projector reads have to be
  // fetched first, and only the full derived pass does that. So the full pass
  // runs when there is genuinely new data to pull, and the cached path calls
  // the one stage it needs directly.
  const adminClient = createAdminClient();
  if (resynced) {
    await pulseLeagueDerived(adminClient, leagueRowId, {
      resynced,
      includePositionalWar: false,
    });
  } else {
    await projectLeagueActivity(adminClient, leagueRowId, Number(season), currentWeek);
  }

  const supabase = await createClient();
  const loaded = await loadLeagueActivity(supabase, {
    leagueRowId,
    sleeperLeagueId,
    days,
    category,
    rosterId,
    limit: ACTIVITY_MAX_ROWS,
    searchedUsername,
  });

  const carry: Record<string, string> = {};
  if (searchedUsername) carry.username = searchedUsername;
  if (sourceParam) carry.source = sourceParam;
  if (days !== ACTIVITY_DEFAULT_DAYS) carry.adays = days === 0 ? "all" : String(days);
  if (rosterId != null) carry.ateam = String(rosterId);

  return (
    <LeagueActivityPanel
      id="league-activity"
      loaded={loaded}
      days={days}
      scrollable={false}
      fullHref={null}
      helper="Every trade, claim, lineup edit, result and rule change on record for this league, newest first."
      filters={{
        basePath: `/leagues/${sleeperLeagueId}/activity`,
        carry,
        anchor: "#league-activity-title",
        category,
        available: loaded.availableCategories,
        rosterId,
        teams: loaded.teams,
        showTeams: true,
      }}
    />
  );
}

/**
 * Sleeper's own current week for this league.
 *
 * Read off the raw league object we already store. Null when it is missing, and
 * the projector then skips results rather than guessing which weeks were played.
 */
function readCurrentWeek(metadata: unknown): number | null {
  const leg = Number(
    (metadata as { settings?: { leg?: unknown } } | null)?.settings?.leg,
  );
  return Number.isFinite(leg) && leg > 0 ? leg : null;
}

function FeedSkeleton() {
  // Announced rather than hidden: this boundary can wait on a full league sync,
  // and a silent gap is worse than a spoken "loading".
  return (
    <div
      role="status"
      className="h-96 animate-pulse rounded-modal border border-line bg-surface/40"
    >
      <span className="sr-only">Loading league activity</span>
    </div>
  );
}

function ExploreLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[44px] items-center gap-3 rounded-card border border-line bg-base/40 px-3 py-2.5 transition-colors hover:border-brand-cyan/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        <span className="block truncate text-[11px] text-ink-muted">{hint}</span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
