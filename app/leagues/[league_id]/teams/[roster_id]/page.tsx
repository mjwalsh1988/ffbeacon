import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
} from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import type { SleeperLeague } from "@/lib/sleeper";
import { TeamCard } from "@/components/team-card";
import { CopyLinkButton } from "@/components/copy-link-button";

export const dynamic = "force-dynamic";

type Params = Promise<{ league_id: string; roster_id: string }>;
type Search = Promise<{ source?: string }>;

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
  const teamName = user?.team_name || user?.display_name || `Team ${roster_id}`;
  const title = `${teamName} — ${league.name}`;
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
  const { source: sourceParam } = await searchParams;
  const sleeperRosterId = Number(roster_id);
  if (!Number.isFinite(sleeperRosterId)) notFound();

  const supabase = await createClient();
  const adminClient = createAdminClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, status, metadata")
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

  // Single shared loader: the league inline view uses this for N teams,
  // we use it for one team. Same code path → identical visuals.
  const allTeams = await loadLeagueTeamCards(
    supabase,
    league.id,
    formatConfigId,
    effectiveSourceSlug,
    league.season != null ? String(league.season) : null,
    league.status ?? null,
  );
  const team = allTeams.find((t) => t.sleeperRosterId === sleeperRosterId);
  if (!team) notFound();

  const sourceDisplay =
    context.coverage === "none" ? "—" : context.sourceDisplay;
  const formatDisplay =
    context.coverage === "none" ? "—" : context.formatDisplay;

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-4 text-xs">
            <ol className="flex flex-wrap items-center gap-1 text-ink-subtle">
              <li>
                <Link
                  href="/tools/league-pulse"
                  className="hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  League Pulse
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/leagues/${sleeperLeagueId}`}
                  className="hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {league.name}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-ink" aria-current="page">
                {team.teamName}
              </li>
            </ol>
          </nav>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-xs uppercase tracking-wider text-brand-cyan">
              Team detail • {formatDisplay} • {sourceDisplay}
            </p>
            <CopyLinkButton
              href={`/leagues/${sleeperLeagueId}/teams/${roster_id}`}
              ariaLabel="Copy link to this team"
              size="sm"
            />
          </div>
          {context.coverage === "fallback" && context.fallback && (
            <p
              role="status"
              className="mt-3 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs text-ink-muted"
            >
              Showing values for {context.formatDisplay} because{" "}
              {context.sourceDisplay} doesn't publish data for{" "}
              {context.fallback.derivedDisplay}.
            </p>
          )}
          {context.coverage === "none" && (
            <p
              role="status"
              className="mt-3 rounded-card border border-signal-warning/40 bg-signal-warning/10 p-3 text-xs text-signal-warning"
            >
              No data source covers {describeDerived(context.derived)} yet. Values are
              unavailable for this team.
            </p>
          )}
          {context.coverage !== "none" &&
            context.pickSource &&
            context.pickSource.slug !== context.sourceSlug && (
              <p role="note" className="mt-2 text-xs text-ink-subtle">
                Draft pick values powered by {context.pickSource.display}.
              </p>
            )}
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <TeamCard
          data={team}
          sleeperLeagueId={sleeperLeagueId}
          showViewTeamPageLink={false}
          headingLevel="h1"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <Link
            href={`/leagues/${sleeperLeagueId}?tab=teams#team-${sleeperRosterId}`}
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
    </main>
  );
}
