/**
 * Positional WAR, the section route.
 *
 * A third home for the same panel, joining the overview and the Power Pulse
 * page. It exists for three reasons: the chart gets the full width of the main
 * column with no rail, so it is at its largest here; a shareable social card
 * needs a page whose card it is; and the upgrade what-if needs a home that is
 * NOT a page rendered on every visit.
 *
 * That last one is the load-bearing constraint. The overview renders on every
 * visit, so a simulation running during its render would spend a rate-limit
 * slot on work nobody asked for. The upgrade what-if therefore lives here,
 * below the chart, behind an explicit press, and never on a GET.
 *
 * Like every other League Pulse section, this calls pulseLeague and never
 * writes to a league table directly.
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, describeDerived } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { buildLeagueFormatTags, buildLeagueScoringTags } from "@/lib/league-format-tags";
import { LeagueShell } from "@/components/league-shell";
import type { LeagueMastheadProps } from "@/components/league-shell";
import { PositionalWarSection } from "@/components/league-war/positional-war-section";
import { UpgradeWhatIfPanel } from "@/components/league-war/upgrade-panel";
import { matchViewerRoster } from "@/lib/league-viewer";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { loadViewerCandidates } from "@/lib/league-positional-war-data";
import { resolveUpgradePanelAvailability } from "@/lib/positional-war/upgrade";
import type { SleeperLeague } from "@/lib/sleeper";

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

  const title = `${league.name} Positional WAR`;
  const description = `Which positions are scarce in ${league.name}, measured in wins over replacement under this league's own scoring and starting lineup.`;
  // Its own card, not the league card: this page's whole point is the curve,
  // and the curve is what a shared link should show. The route is
  // source-independent and takes no ?source=, per CLAUDE.md.
  const ogPath = `/api/og/war/${league_id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogPath] },
  };
}

export default async function LeaguePositionalWarPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{
    source?: string;
    username?: string;
    roster?: string;
    war?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const focusedRosterId = (() => {
    if (typeof sp.roster !== "string" || !sp.roster.trim()) return null;
    const n = Number.parseInt(sp.roster, 10);
    return Number.isFinite(n) ? n : null;
  })();

  // Core pulse only: the league, its rosters and its members. The derived half
  // is what computes the curve when it is stale, and that is the slow part, so
  // it runs inside the Suspense boundary below and the masthead paints without
  // waiting for it.
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
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    viewer,
    league.season != null ? String(league.season) : null,
  );

  // No handle on either link for a saved reader: /tools/league-pulse resolves
  // the same identity itself, and the deep view matches on the Sleeper user id.
  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(linkUsername)}`
    : `/leagues/${sleeperLeagueId}`;

  // Format is derived from the league's own Sleeper settings; only the value
  // source respects the user's pick (CLAUDE.md: League Pulse Format Resolution).
  // Positional WAR itself uses neither, but the masthead reports both.
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
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

  const rosterPositions = Array.isArray(league.roster_positions)
    ? (league.roster_positions as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="positional-war"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Positional WAR" }]}
      copyHref={`/leagues/${sleeperLeagueId}/positional-war`}
      copyAriaLabel="Copy link to this league's Positional WAR"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <div className="mt-6 space-y-6">
        {/* Feature intro. Plain language, and short: this is the first thing
            a reader who has never met Positional WAR sees, and a wall of
            explanation in front of a chart is the thing they skip. Everything cut from here
            is still available: the footnote under the chart carries the
            definitions and the Signal Guide entry carries the long version.
            The heading is an h2; the masthead above owns this page's h1. */}
        <section
          aria-labelledby="war-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.13) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
          }}
        >
          {/* Decorative, and pointer-events-none so it never becomes the thing
              a hovering screen reader finds instead of the content under it.
              Same reasoning as the hairline in components/dashboard-panel.tsx. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            Where the scarcity is
          </p>
          <h2 id="war-intro" className="mt-1 text-xl font-semibold text-ink sm:text-2xl">
            Positional WAR
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Positional WAR estimates how many extra matchups a player should help you win,
            compared with a replacement player. A replacement player is the best one at his
            position who would not make a starting lineup anywhere in this league.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            It runs on projections for the games left to play, not on what has already happened, and
            it uses your league&apos;s own scoring and starting lineup. A steep line means the
            position runs out fast, so the players at the top of it are worth paying up for.
          </p>
        </section>

        <Suspense fallback={<WarSkeleton />}>
          <PositionalWarSection
            supabase={supabase}
            leagueRowId={league.id}
            leagueName={league.name}
            season={Number(league.season ?? 0)}
            teamCount={league.total_rosters ?? 0}
            rosterPositions={rosterPositions}
            scoringSettings={(league.scoring_settings ?? {}) as Record<string, number>}
            searchedUsername={searchedUsername}
            viewerSleeperUserId={viewer?.sleeperUserId ?? null}
            focusedRosterId={focusedRosterId}
            war={sp.war}
            variant="dashboard"
            // Positional WAR itself never varies by source or format
            // (CLAUDE.md). These are for the SCATTERPLOT's other axis, which is
            // the reader's own market: trade value at the league's derived
            // format, from whichever source they picked.
            formatConfigId={coverageOk ? context.formatConfigId : null}
            sourceSlug={coverageOk ? context.sourceSlug : null}
            sourceDisplay={coverageOk ? context.sourceDisplay : "your value source"}
            formatDisplay={coverageOk ? context.formatDisplay : "this league's format"}
          />
        </Suspense>

        {/* The upgrade what-if (T-WAR-48). Its own Suspense boundary so it
            never waits on the curve computation above: it only needs a
            roster lookup and a Power Pulse cache row count, neither of which
            is the curve. It resolves nothing itself; the simulation runs
            only from an explicit press, through app/leagues/[league_id]/
            positional-war/actions.ts. */}
        <Suspense fallback={<UpgradeSkeleton />}>
          <UpgradeWhatIfSection
            supabase={supabase}
            leagueRowId={league.id}
            season={Number(league.season ?? 0)}
            sleeperLeagueId={sleeperLeagueId}
            searchedUsername={searchedUsername}
            viewerSleeperUserId={viewer?.sleeperUserId ?? null}
            focusedRosterId={focusedRosterId}
          />
        </Suspense>
      </div>

      {/* The derived half, including the curve computation, runs here rather
          than blocking the masthead. It renders nothing. */}
      <Suspense fallback={null}>
        <DerivedWork leagueRowId={league.id} resynced={!pulseResult.cached} />
      </Suspense>
    </LeagueShell>
  );
}

/**
 * Runs the derived pulse and renders nothing.
 *
 * Its only job is to make the slow half of the sync happen inside a Suspense
 * boundary, so the page paints first and the curve appears on the next view
 * rather than holding a blank loader for the whole computation.
 */
async function DerivedWork({
  leagueRowId,
  resynced,
}: {
  leagueRowId: string;
  resynced: boolean;
}) {
  // The curve's own compute lives in PositionalWarSection, behind the boundary
  // that shows it, so this only has to carry the other derived stages.
  await pulseLeagueDerived(createAdminClient(), leagueRowId, {
    resynced,
    includePositionalWar: false,
  });
  return null;
}

/**
 * Resolves whether an upgrade panel has anything to show, and if so shows it.
 *
 * Read-only, and light: a roster-candidate lookup (matchViewerRoster, the same
 * rule the chart overlay uses) plus a Power Pulse cache row count. Neither is
 * the simulation this feature exists to meter, so both run here on a GET with
 * no rate-limit concern. Case 1 from section 15.1.2 ("no viewer roster
 * resolves") is handled by returning null: the panel does not render, and
 * there is nothing to ask.
 */
async function UpgradeWhatIfSection({
  supabase,
  leagueRowId,
  season,
  sleeperLeagueId,
  searchedUsername,
  viewerSleeperUserId,
  focusedRosterId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  leagueRowId: string;
  season: number;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  /** The viewer's Sleeper user id, tried before the handle: a saved handle is
   *  a Sleeper username while the candidates carry display names. */
  viewerSleeperUserId: string | null;
  focusedRosterId: number | null;
}) {
  const candidates = await loadViewerCandidates(supabase, leagueRowId);
  const viewerRosterId = matchViewerRoster(
    candidates,
    searchedUsername,
    focusedRosterId,
    viewerSleeperUserId,
  );
  if (viewerRosterId === null) return null;

  const availability = await resolveUpgradePanelAvailability(supabase, {
    leagueRowId,
    season,
    viewerRosterId,
  });

  return (
    <UpgradeWhatIfPanel
      sleeperLeagueId={sleeperLeagueId}
      viewerRosterId={viewerRosterId}
      searchedUsername={searchedUsername}
      focusedRosterId={focusedRosterId}
      availability={availability}
    />
  );
}

/**
 * Placeholder while the upgrade panel's own light reads resolve. Announced
 * politely, matching WarSkeleton below.
 */
function UpgradeSkeleton() {
  return (
    <div role="status" aria-live="polite" className="rounded-modal border border-line bg-surface/50 p-6">
      <p className="text-sm text-ink-muted">Loading the upgrade check</p>
    </div>
  );
}

/**
 * Placeholder while the curve streams in. Announced politely so a screen reader
 * hears that work is in progress rather than sitting on silence.
 */
function WarSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-modal border border-line bg-surface/50 p-6"
    >
      <p className="text-sm text-ink-muted">Loading Positional WAR</p>
      <div aria-hidden="true" className="mt-4 h-72 animate-pulse rounded-card bg-base/60" />
    </div>
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
