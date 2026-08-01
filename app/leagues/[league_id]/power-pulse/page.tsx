import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeague } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, describeDerived } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  buildPulseLeaders,
  loadPowerPulseView,
} from "@/lib/league-power-pulse-data";
import { describeLeagueScoring, type ScoringSettings } from "@/lib/league-scoring";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { LeagueBreadcrumb } from "@/components/league-breadcrumb";
import { LeagueHeaderActions } from "@/components/league-header-actions";
import { LeagueTabs } from "@/components/league-tabs";
import { LeagueInfoPanel } from "@/components/league-info-panel";
import { Panel, StatReadout } from "@/components/dashboard-panel";
import { PulseRankingsTable } from "@/components/power-pulse/pulse-rankings-table";
import { PulseLeaders } from "@/components/power-pulse/pulse-leaders";
import { ProjectedStandings } from "@/components/power-pulse/projected-standings";
import { TitleRace } from "@/components/power-pulse/title-race";
import { HowPowerPulseWorks } from "@/components/power-pulse/how-power-pulse-works";
import { formatEastern } from "@/lib/datetime";

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

  const title = `${league.name} Power Pulse`;
  const description = `Projected standings, playoff odds, and expected performance for every team in ${league.name}.`;
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

export default async function LeaguePowerPulsePage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ source?: string; username?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim() ? sp.username.trim() : null;

  // Same idempotent first-touch pulse as every other deep-view surface. This is
  // also what computes Power Pulse when it is stale.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeague(adminClient, sleeperLeagueId);
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

  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    searchedUsername,
    league.season != null ? String(league.season) : null,
  );

  const homeHref = searchedUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
    : "/tools/league-pulse";
  const leagueHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}`;

  // Format is derived from the league's own Sleeper settings; only the value
  // source respects the user's pick (CLAUDE.md: League Pulse Format Resolution).
  // Power Pulse itself does not use either, but the value-rank comparison does.
  const sleeperLeague = league.metadata as unknown as Parameters<
    typeof resolveLeagueContext
  >[1];
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
  const context = await resolveLeagueContext(adminClient, sleeperLeague, resolvedSource.slug);
  const coverageOk = context.coverage !== "none";

  const view = await loadPowerPulseView(
    supabase,
    league.id,
    Number(league.season),
    coverageOk ? context.formatConfigId : null,
    coverageOk ? context.sourceSlug : null,
  );

  const settings = (league.metadata as { settings?: Record<string, number> } | null)?.settings ?? {};
  const playoffTeams = Number(settings.playoff_teams ?? 6);

  const scoringDescription = describeLeagueScoring(
    (league.scoring_settings ?? {}) as ScoringSettings,
  );

  // Shared league identity card, matching every other deep-view surface.
  const formatTags = buildLeagueFormatTags({
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teamCount: league.total_rosters,
  });
  const scoringTags = buildLeagueScoringTags(league.scoring_settings);
  const lastPulsed = league.last_pulsed_at ? new Date(league.last_pulsed_at) : null;
  const infoPanelProps = {
    leagueName: league.name,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags,
    scoringTags,
    lastUpdatedLabel: lastPulsed ? formatRelative(lastPulsed) : "never",
    cached: pulseResult.cached,
    coverage: context.coverage,
    sourceDisplay: coverageOk ? context.sourceDisplay : "N/A",
    formatDisplay: coverageOk ? context.formatDisplay : "N/A",
    derivedLabel: describeDerived(context.derived),
    fallbackDisplay:
      context.coverage === "fallback" ? context.fallback?.derivedDisplay ?? null : null,
    pickSourceDisplay:
      coverageOk && context.pickSource && context.pickSource.slug !== context.sourceSlug
        ? context.pickSource.display
        : null,
  };

  const valueLabel = coverageOk
    ? `${context.formatDisplay} via ${context.sourceDisplay}`
    : null;

  return (
    <main id="main">
      <header className="relative overflow-hidden border-b border-line">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LeagueBreadcrumb
              homeHref={homeHref}
              crumbs={[{ label: league.name, href: leagueHref }, { label: "Power Pulse" }]}
            />
            <LeagueHeaderActions
              sleeperLeagueId={sleeperLeagueId}
              copyHref={`/leagues/${sleeperLeagueId}/power-pulse`}
              copyAriaLabel="Copy link to this league's Power Pulse"
              otherLeagues={otherLeagues}
              searchedUsername={searchedUsername}
            />
          </div>
        </div>
      </header>

      <LeagueTabs
        sleeperLeagueId={sleeperLeagueId}
        activeTab="power-pulse"
        searchedUsername={searchedUsername}
      />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Feature intro strip. Sets expectations before any number appears,
            and states the one thing Power Pulse ignores. */}
        <section
          aria-labelledby="pp-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.13) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">
            League Pulse
          </p>
          <h1
            id="pp-intro"
            className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
          >
            Power Pulse
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Every other power ranking adds up what your roster is worth. This one
            estimates what it will actually do: your real starting lineup, week by
            week, scored under your league's own rules, against the schedule you
            were dealt.
          </p>
          {view && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Chip
                label={view.preseason ? "Preseason" : `Through week ${view.throughWeek}`}
                accent
              />
              <Chip label={`${view.teams.length} teams`} />
              <Chip label={scoringDescription} />
              {view.generatedAt && (
                <Chip label={`Updated ${formatEastern(view.generatedAt)}`} />
              )}
            </div>
          )}
        </section>

        {!view ? (
          <div className="mt-6">
            <Panel
              eyebrow="Building"
              title="Power Pulse is still calculating"
              helper="This runs on the first load after a league syncs."
            >
              <p className="text-sm text-ink-muted">
                We need Sleeper's weekly projections and this league's head-to-head
                schedule before we can project anything. Both arrive on the next
                sync, so refreshing in a moment usually does it. If this league is
                mid-draft, Power Pulse waits until rosters are filled.
              </p>
            </Panel>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Main column: the rankings, then the standings, then the awards. */}
            <div className="min-w-0 space-y-6">
              <Panel
                eyebrow="The ranking"
                title="Power Pulse rankings"
                helper="Ranked by expected performance. The value column shows each team's trade-value rank and how far it sits from where it competes."
                bodyClassName="p-0"
                glow
              >
                <PulseRankingsTable
                  teams={view.teams}
                  sleeperLeagueId={sleeperLeagueId}
                  searchedUsername={searchedUsername}
                  valueLabel={valueLabel}
                />
              </Panel>

              <Panel
                eyebrow="Where this ends up"
                title="Projected final standings"
                helper={`Ordered by expected wins across every simulated season, so a hard schedule can drop a strong roster below the ${playoffTeams}-team cut.`}
                bodyClassName="p-0"
              >
                <ProjectedStandings teams={view.teams} playoffTeams={playoffTeams} />
              </Panel>

              <Panel
                eyebrow="Superlatives"
                title="League leaders"
                helper="The things a rankings table cannot tell you."
              >
                <PulseLeaders leaders={buildPulseLeaders(view.teams)} />
              </Panel>
            </div>

            {/* Right rail: the headline answer, then context, then methodology. */}
            <aside
              aria-label="Title race and methodology"
              className="space-y-6 xl:sticky xl:top-8 xl:self-start"
            >
              <Panel eyebrow="Simulated season" title="Title race" glow>
                <TitleRace teams={view.teams} />
              </Panel>

              <Panel eyebrow="At a glance" title="League snapshot">
                <dl className="grid grid-cols-3 gap-2">
                  <StatReadout
                    label="Teams"
                    value={String(view.teams.length)}
                    accent="cyan"
                  />
                  <StatReadout
                    label="Playoff spots"
                    value={String(playoffTeams)}
                    accent="purple"
                  />
                  <StatReadout
                    label="Weeks left"
                    value={String(view.teams[0]?.weekly.length ?? 0)}
                    accent="ink"
                  />
                </dl>
              </Panel>

              <LeagueInfoPanel layout="sidebar" {...infoPanelProps} />

              <HowPowerPulseWorks
                scoringDescription={scoringDescription}
                preseason={view.preseason}
              />
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function Chip({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
        accent ? "border-brand-cyan/40 text-brand-cyan" : "border-line text-ink-muted"
      }`}
    >
      {label}
    </span>
  );
}

function formatRelative(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
