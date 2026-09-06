import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, describeDerived } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { LeagueShell } from "@/components/league-shell";
import type { LeagueMastheadProps } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { LedgerTable } from "@/components/manager-ledger/ledger-table";
import { HowLedgerWorks } from "@/components/manager-ledger/how-it-works";
import { LedgerEmpty } from "@/components/manager-ledger/ledger-empty";
import { LedgerLeaders } from "@/components/manager-ledger/ledger-leaders";
import { LedgerHeadlineTiles } from "@/components/manager-ledger/ledger-headline";
import {
  buildLedgerHeadline,
  buildLedgerLeaders,
} from "@/lib/manager-ledger/leaders";
import {
  ledgerEmptyState,
  loadManagerLedgerView,
} from "@/lib/league-manager-ledger-data";
import { refreshManagerLedger } from "@/lib/league-manager-ledger";
import { loadViewerCandidates } from "@/lib/league-positional-war-data";
import { matchViewerRoster } from "@/lib/league-viewer";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { formatRelative } from "@/lib/datetime";
import { games, pct, pts, record } from "@/components/manager-ledger/format";
import { ListChecks } from "lucide-react";
import type { SleeperLeague } from "@/lib/sleeper";

/**
 * Decisions: the Manager Ledger.
 *
 * Every other section of League Pulse measures a ROSTER. This one measures the
 * person operating it, by grading the decisions they actually made against what
 * was actually available at the time, using results that have already happened.
 *
 * THE COMPUTE RUNS INSIDE THE LEDGER'S OWN SUSPENSE BOUNDARY, not above it.
 * `refreshManagerLedger` reads a season of settled matchups, every transaction
 * and every draft pick, so awaiting it before the shell would hold a blank
 * screen for the whole thing. Awaiting it inside the boundary that shows the
 * table paints the league's name, tabs and masthead immediately. The rest of
 * the derived sync runs in a second boundary that renders nothing, with
 * `includeManagerLedger: false` so the two never do the same work twice.
 *
 * FORMAT AND SOURCE ARE REPORTED, NOT USED. Like Power Pulse and Positional
 * WAR, this model varies by neither: every figure is points scored under the
 * league's own scoring. The masthead still names both, because a reader
 * arriving from another tab is entitled to see the toggle they set.
 *
 * THE TWO BOUNDARIES RACE, AND THAT IS THE CHEAPER OF TWO WRONGS. `DerivedWork`
 * is what syncs transactions and captures draft picks, and `LedgerSection`
 * reads those same tables. On the first load after a resync the ledger can
 * therefore grade the state as it was a moment before, which is a ONE-VIEW LAG
 * and not a stuck answer: the fingerprint counts transactions and picks, so the
 * next view sees a different key and recomputes. The alternative is to sequence
 * the ledger behind the whole derived pass, which would put the transaction
 * sync, the activity projection, the power rankings and Power Pulse in front of
 * the only thing this page displays.
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

  const title = `${league.name} Manager Decisions`;
  const description = `Lineup, waiver, trade and draft decisions graded against settled results for every manager in ${league.name}.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DecisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ source?: string; username?: string; roster?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const focusedRosterId = (() => {
    if (typeof sp.roster !== "string" || !sp.roster.trim()) return null;
    const n = Number.parseInt(sp.roster, 10);
    return Number.isFinite(n) ? n : null;
  })();

  const adminClient = createAdminClient();
  const pulseResult = await pulseLeagueCore(adminClient, sleeperLeagueId);
  if (!pulseResult.ok) notFound();

  const supabase = await createClient();

  // Who this page is acting for: the ?username= handle when there is one,
  // otherwise the reader's own saved handle (lib/sleeper-handle/resolve.ts).
  // `linkUsername` is what a link built on this page may carry, which is the
  // handle only when the reader arrived on one.
  const viewer = await resolveSleeperViewer(supabase, sp.username);
  const searchedUsername = viewer?.username ?? null;
  const linkUsername = viewerLinkUsername(viewer);
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata, manager_ledger_status",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  // Independent of each other, so they run together rather than in a queue.
  // `resolveLeagueContext` is the one that depends on its neighbour's result.
  const [{ otherLeagues }, resolvedSource] = await Promise.all([
    loadLeagueHeaderActions(
      supabase,
      league.id,
      sleeperLeagueId,
      viewer,
      league.season != null ? String(league.season) : null,
    ),
    resolveSourceSlug(supabase, sp.source),
  ]);

  // No handle on either link for a saved reader: /tools/league-pulse resolves
  // the same identity itself, and the deep view matches on the Sleeper user id.
  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(linkUsername)}`
    : `/leagues/${sleeperLeagueId}`;

  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(adminClient, sleeperLeague, resolvedSource.slug);
  const coverageOk = context.coverage !== "none";

  const lastPulsed = league.last_pulsed_at ? new Date(league.last_pulsed_at) : null;
  const mastheadProps: LeagueMastheadProps = {
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
    lastUpdatedLabel: lastPulsed ? formatRelative(lastPulsed.toISOString()) : "never",
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
      activeTab="decisions"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Decisions" }]}
      copyHref={`/leagues/${sleeperLeagueId}/decisions`}
      copyAriaLabel="Copy link to this league's manager decisions"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <div className="mt-6 space-y-6">
        <section
          aria-labelledby="ledger-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.13) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            Good, lucky, or carried
          </p>
          {/* Deliberately NOT "Manager decisions", which is what the
              leaderboard Panel below is called. Two h2s with identical text
              give a reader jumping by heading no way to tell the explainer from
              the table. */}
          <h2 id="ledger-intro" className="mt-1 text-xl font-semibold text-ink sm:text-2xl">
            What this page measures
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Every other page here grades your roster. This one grades what you did with it.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Lineups, waivers, trades and draft picks, all from finished weeks and real
            points. The highest-scoring team in the league can still finish last here.
          </p>
        </section>

        <Suspense fallback={<LedgerSkeleton />}>
          <LedgerSection
            leagueRowId={league.id}
            season={Number(league.season ?? 0)}
            storedStatus={league.manager_ledger_status}
            searchedUsername={searchedUsername}
            viewerSleeperUserId={viewer?.sleeperUserId ?? null}
            focusedRosterId={focusedRosterId}
          />
        </Suspense>
      </div>

      {/* The rest of the derived sync, inside its own boundary so it never
          holds up the ledger above. Renders nothing. */}
      <Suspense fallback={null}>
        <DerivedWork leagueRowId={league.id} resynced={!pulseResult.cached} />
      </Suspense>
    </LeagueShell>
  );
}

/**
 * Runs the derived pulse and renders nothing.
 *
 * `includeManagerLedger: false`: the ledger's own compute lives in
 * LedgerSection, behind the boundary that shows it, so running it here as well
 * would do the same season of reads twice on every cold load.
 */
async function DerivedWork({
  leagueRowId,
  resynced,
}: {
  leagueRowId: string;
  resynced: boolean;
}) {
  await pulseLeagueDerived(createAdminClient(), leagueRowId, {
    resynced,
    includePositionalWar: false,
    includeManagerLedger: false,
  });
  return null;
}

/**
 * Compute the ledger if it is stale, then read and render it.
 *
 * The refresh is awaited here rather than above the shell so the page paints
 * first. `refreshManagerLedger` never throws, and a league it could not grade
 * leaves an honest verdict on `leagues.manager_ledger_status`, which is what
 * the empty state below reads.
 */
async function LedgerSection({
  leagueRowId,
  season,
  storedStatus,
  searchedUsername,
  viewerSleeperUserId,
  focusedRosterId,
}: {
  leagueRowId: string;
  season: number;
  storedStatus: string | null;
  searchedUsername: string | null;
  /** The viewer's Sleeper user id, tried before the handle: a saved handle is
   *  a Sleeper username while the candidates carry display names. */
  viewerSleeperUserId: string | null;
  focusedRosterId: number | null;
}) {
  const supabase = await createClient();

  // The candidate list does not depend on the ledger, so it resolves while the
  // compute runs rather than after it. Only the view read has to wait.
  const candidatesPromise = loadViewerCandidates(supabase, leagueRowId);

  await refreshManagerLedger(createAdminClient(), leagueRowId);

  const [view, candidates] = await Promise.all([
    loadManagerLedgerView(supabase, leagueRowId, season),
    candidatesPromise,
  ]);

  if (!view || view.teams.length === 0) {
    // The status is re-read rather than reusing the one from the page above,
    // because the refresh that just ran is exactly what would have changed it.
    const { data: fresh } = await supabase
      .from("leagues")
      .select("manager_ledger_status")
      .eq("id", leagueRowId)
      .maybeSingle();
    // HowLedgerWorks renders here too. A reader who arrives before their season
    // starts is exactly the one with time to read what the page will measure,
    // and it costs nothing: with no graded weeks it says "no weeks yet" and the
    // per-league slot note simply does not fire.
    return (
      <div className="space-y-6">
        <LedgerEmpty
          state={ledgerEmptyState(fresh?.manager_ledger_status ?? storedStatus)}
        />
        <HowLedgerWorks gradedWeeks={[]} ungradableSlots={[]} />
      </div>
    );
  }

  const viewerRosterId = matchViewerRoster(
    candidates,
    searchedUsername,
    focusedRosterId,
    viewerSleeperUserId,
  );
  const viewer = viewerRosterId === null
    ? null
    : (view.teams.find((t) => t.sleeperRosterId === viewerRosterId) ?? null);

  const worstOffender = [...view.teams].sort((a, b) => b.pointsLeft - a.pointsLeft)[0];
  const headline = buildLedgerHeadline(view.teams, view.gradedWeeks.length);
  const leaders = buildLedgerLeaders(view.teams);
  const weeksLabel = `${view.gradedWeeks.length} finished week${
    view.gradedWeeks.length === 1 ? "" : "s"
  } of ${view.season}`;

  return (
    <div className="space-y-6">
      {/* The league at a glance, before any team is named. Three figures a
          reader repeats to their league chat, and everything below is the
          evidence for them. */}
      <LedgerHeadlineTiles headline={headline} teamCount={view.teams.length} />

      {viewer ? <YourLedger team={viewer} total={view.teams.length} /> : null}

      <Panel
        eyebrow="Standouts"
        title="League leaders"
        helper="An award only shows up when someone has earned it."
        headingLevel={2}
      >
        <LedgerLeaders leaders={leaders} />
      </Panel>

      <Panel
        eyebrow="The leaderboard"
        title="Manager decisions"
        helper={`${weeksLabel}. Ordered by the share of their own points each manager started.`}
        headingLevel={2}
        action={
          <span className="hidden items-center gap-1.5 text-xs text-ink-subtle sm:inline-flex">
            <ListChecks aria-hidden="true" className="h-3.5 w-3.5" />
            {view.teams.length} teams
          </span>
        }
      >
        <LedgerTable teams={view.teams} />
        <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
          {worstOffender.teamName} has left the most behind:{" "}
          {pts(worstOffender.pointsLeft)} points
          {/* Guarded rather than interpolated. The per-week figure is null for a
              team with no graded weeks, and the formatter returns a dash, which
              made this sentence read "which is a week". */}
          {worstOffender.pointsLeftPerWeek === null
            ? "."
            : `, ${pts(worstOffender.pointsLeftPerWeek)} a week.`}{" "}
          Open a manager for their full season.
        </p>
      </Panel>

      <HowLedgerWorks
        gradedWeeks={view.gradedWeeks}
        ungradableSlots={view.ungradableSlots}
      />
    </div>
  );
}

/**
 * The reader's own team, above the leaderboard.
 *
 * Shown only when a roster resolves to the person looking, by the same rule the
 * Positional WAR overlay uses. Nothing here is unavailable in the table below;
 * it saves a reader scanning twelve rows for their own name.
 */
function YourLedger({
  team,
  total,
}: {
  team: import("@/lib/league-manager-ledger-data").LedgerViewTeam;
  total: number;
}) {
  return (
    <Panel eyebrow="Your team" title={team.teamName} glow headingLevel={2}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">Started</dt>
          <dd className="font-mono text-2xl font-extrabold tabular-nums text-ink">
            {pct(team.efficiency)}
            <span className="block font-sans text-[11px] font-normal text-ink-muted">
              {team.efficiencyRank === null
                ? "not ranked yet"
                : `${team.efficiencyRank} of ${total} in the league`}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">
            Left behind
          </dt>
          <dd className="font-mono text-2xl font-extrabold tabular-nums text-ink">
            {pts(team.pointsLeft)}
            <span className="block font-sans text-[11px] font-normal text-ink-muted">
              {team.pointsLeftPerWeek === null
                ? "not measured yet"
                : `${pts(team.pointsLeftPerWeek)} a week`}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">Record</dt>
          <dd className="font-mono text-2xl font-extrabold tabular-nums text-ink">
            {record(team.actualRecord)}
            <span className="block font-sans text-[11px] font-normal text-ink-muted">
              {record(team.bestLineupRecord)} at your best
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">
            Wins left behind
          </dt>
          <dd className="font-mono text-2xl font-extrabold tabular-nums text-brand-purple">
            {team.winsLeftOnBench}
            <span className="block font-sans text-[11px] font-normal text-ink-muted">
              {team.winsLeftOnBench === 0
                ? "no loss was winnable from your bench"
                : "losses your bench would have won"}
            </span>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Placeholder while the ledger computes. Announced politely. */
function LedgerSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-modal border border-line bg-surface/50 p-6"
    >
      <p className="text-sm text-ink-muted">Grading this league</p>
      <div aria-hidden="true" className="mt-4 h-72 animate-pulse rounded-card bg-base/60" />
    </div>
  );
}
