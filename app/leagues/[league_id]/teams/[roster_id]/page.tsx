import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  getActiveFormats,
  getAvailableSources,
  reconcileFormatWithSource,
} from "@/lib/source";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { TeamCard } from "@/components/team-card";

export const dynamic = "force-dynamic";

type Params = Promise<{ league_id: string; roster_id: string }>;
type Search = Promise<{ format?: string; source?: string }>;

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
  return {
    title: `${teamName} — ${league.name}`,
    description: `Roster, draft picks, and value breakdown for ${teamName} in ${league.name}.`,
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
  const { format: formatParam, source: sourceParam } = await searchParams;
  const sleeperRosterId = Number(roster_id);
  if (!Number.isFinite(sleeperRosterId)) notFound();

  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, status")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  // Resolve preferences (URL → DB → cookie → default) and reconcile against
  // the source's supported formats so we never query a (source, format)
  // combo that has no data.
  const [resolvedFormat, resolvedSource, registry, allFormats] = await Promise.all([
    resolveFormatSlug(supabase, formatParam),
    resolveSourceSlug(supabase, sourceParam),
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);
  const reconciled = reconcileFormatWithSource(
    registry,
    allFormats,
    resolvedSource.slug,
    resolvedFormat.slug,
  );
  const formatSlug = reconciled.formatSlug;
  const sourceSlug = resolvedSource.slug;

  const { data: formatRow } = await supabase
    .from("format_configs")
    .select("id, display_name")
    .eq("slug", formatSlug)
    .maybeSingle();

  // Single shared loader: the league inline view uses this for N teams,
  // we use it for one team. Same code path → identical visuals.
  const allTeams = await loadLeagueTeamCards(
    supabase,
    league.id,
    formatRow?.id ?? null,
    sourceSlug,
    league.season != null ? String(league.season) : null,
    league.status ?? null,
  );
  const team = allTeams.find((t) => t.sleeperRosterId === sleeperRosterId);
  if (!team) notFound();

  const sourceDisplay =
    registry.find((r) => r.slug === sourceSlug)?.display_name ?? sourceSlug ?? "—";
  const formatDisplay = formatRow?.display_name ?? formatSlug;

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-4 text-xs">
            <ol className="flex flex-wrap items-center gap-1 text-ink-subtle">
              <li>
                <Link
                  href="/tools/league-sync"
                  className="hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  League Sync
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
          <p className="text-xs uppercase tracking-wider text-brand-cyan">
            Team detail • {formatDisplay} • {sourceDisplay}
          </p>
          {reconciled.fallback && (
            <p
              role="status"
              className="mt-3 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs text-ink-muted"
            >
              Showing {reconciled.fallback.toName} because {reconciled.fallback.sourceName}{" "}
              does not publish values for {reconciled.fallback.fromName}.
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
