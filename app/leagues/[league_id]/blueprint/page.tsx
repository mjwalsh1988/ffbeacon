import type { Metadata } from "next";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { LEAGUE_CORE_COLUMNS, pulseLeagueCore } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { leagueMastheadProps } from "@/lib/league-masthead";
import { loadViewerCandidates } from "@/lib/league-positional-war-data";
import { matchViewerRoster } from "@/lib/league-viewer";
import { loadRosters } from "@/lib/power-pulse/load";
import { formatEastern } from "@/lib/datetime";
import { loadBlueprint, type LoadBlueprintArgs } from "@/lib/league-blueprint/data";
import { readCachedBlueprint } from "@/lib/league-blueprint/cache";
import { loadLeagueBlueprintSettings } from "@/lib/league-blueprint/settings";
import { describeBlueprint } from "@/lib/league-blueprint/share";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import type { LineupTeamOption } from "@/lib/league-lineups/types";
import type { SleeperLeague } from "@/lib/sleeper";
import { LeagueShell } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { ShareStrip } from "@/components/share-strip";
import { withUsername } from "@/components/league-schedule/format";
import { BlueprintControls } from "@/components/league-blueprint/blueprint-controls";
import { SheetSkeleton } from "@/components/league-blueprint/body-skeleton";
import { Sheet } from "@/components/league-blueprint/sheet";
import { BLUEPRINT_TITLE_ID, Letterhead } from "@/components/league-blueprint/letterhead";
import { StandingPanel } from "@/components/league-blueprint/standing-panel";
import { GradeRings } from "@/components/league-blueprint/grade-rings";
import { LineupTable } from "@/components/league-blueprint/lineup-table";
import { DepthLists } from "@/components/league-blueprint/depth-lists";
import { SharesPanel } from "@/components/league-blueprint/shares-panel";
import { AgeChart } from "@/components/league-blueprint/age-chart";
import { MoversPanel } from "@/components/league-blueprint/movers-panel";
import { SpotlightCard } from "@/components/league-blueprint/spotlight-card";
import { CallsPanel } from "@/components/league-blueprint/calls-panel";
import { loadMarketSignalSettings } from "@/lib/market-signals/settings";
import { CapitalPanel } from "@/components/league-blueprint/capital-panel";
import { PrioritiesPanel } from "@/components/league-blueprint/priorities-panel";
import { StrategyPanel } from "@/components/league-blueprint/strategy-panel";
import { SheetSection } from "@/components/league-blueprint/sheet";
import { ProductOffer } from "@/components/commerce/product-offer";
import { loadOfferState } from "@/lib/commerce/offer";

export const dynamic = "force-dynamic";

/**
 * Team Blueprint: one roster read as a one-page report card. Plan of record:
 * docs/completed/team-blueprint/team-blueprint-plan.md section 9; the sheet
 * layout is components/league-blueprint/sheet.tsx.
 *
 * The core sync and the league row, once per request, shared by
 * generateMetadata and the page (the leaderboards page's pattern). The whole
 * sheet, letterhead included, awaits loadBlueprint inside one Suspense
 * boundary, so the grade in the letterhead and the figures under it are
 * always from the same stored view; the skeleton prints the team name and
 * league, which are known before the body runs.
 */
const getSyncedLeague = cache(async (sleeperLeagueId: string) => {
  const pulse = await pulseLeagueCore(createAdminClient(), sleeperLeagueId);
  if (!pulse.ok) return null;
  const league =
    pulse.league ??
    (
      await (await createClient())
        .from("leagues")
        .select(LEAGUE_CORE_COLUMNS)
        .eq("sleeper_league_id", sleeperLeagueId)
        .maybeSingle()
    ).data;
  return league ? { league, cached: pulse.cached } : null;
});

/** Digits only, 1 to 3 characters (plan 15). Anything else is no roster. */
function rosterParam(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

const loadTeams = cache(async (leagueRowId: string): Promise<LineupTeamOption[]> => {
  const rosters = await loadRosters(createAdminClient(), leagueRowId);
  return rosters
    .map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      rosterRowId: r.id,
      teamName: r.teamName,
      ownerHandle: r.ownerHandle,
      record: { wins: r.wins, losses: r.losses, ties: r.ties },
    }))
    .sort((a, b) => a.sleeperRosterId - b.sleeperRosterId);
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ roster?: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const sp = await searchParams;
  const synced = await getSyncedLeague(league_id);
  if (!synced) return { title: "League not found" };
  const league = synced.league;
  const roster = rosterParam(sp.roster);
  const team = roster !== null ? (await loadTeams(league.id)).find((t) => t.sleeperRosterId === roster) : null;
  const title = team ? `${team.teamName} Team Blueprint, ${league.name}` : `${league.name} Team Blueprint`;
  const description = team
    ? `${team.teamName}'s plan in ${league.name}: grades by position, buy and sell calls, three trade shapes and the two best trade partners.`
    : `A one-page plan for any team in ${league.name}: grades by position, buy and sell calls, three trade shapes and the two best trade partners.`;
  const ogPath = team ? `/api/og/blueprint/${league_id}/${team.sleeperRosterId}` : null;
  return {
    title,
    description,
    // Never indexed: it is about one league's members.
    robots: { index: false, follow: true },
    openGraph: { title, description, ...(ogPath ? { images: [{ url: ogPath, width: 1200, height: 630 }] } : {}) },
    twitter: { card: "summary_large_image", title, ...(ogPath ? { images: [ogPath] } : {}) },
  };
}

export default async function LeagueBlueprintPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ roster?: string; username?: string; source?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,20}$/.test(sleeperLeagueId)) notFound();

  const synced = await getSyncedLeague(sleeperLeagueId);
  if (!synced) notFound();
  const { league, cached: pulseCached } = synced;

  const supabase = await createClient();
  const admin = createAdminClient();
  const viewer = await resolveSleeperViewer(supabase, sp.username);
  const linkUsername = viewerLinkUsername(viewer);

  const [{ otherLeagues }, resolvedSource, teams, candidates] = await Promise.all([
    loadLeagueHeaderActions(
      supabase,
      league.id,
      sleeperLeagueId,
      viewer,
      league.season != null ? String(league.season) : null,
    ),
    resolveSourceSlug(supabase, sp.source),
    loadTeams(league.id),
    loadViewerCandidates(supabase, league.id),
  ]);
  if (teams.length === 0) notFound();

  // Which roster: the ?roster= param (validated, must be in this league), else
  // the viewer's own team, else the first roster with the sheet saying so.
  const requested = rosterParam(sp.roster);
  if (sp.roster !== undefined && (requested === null || !teams.some((t) => t.sleeperRosterId === requested))) {
    notFound();
  }
  const viewerRosterId = matchViewerRoster(candidates, viewer?.username ?? null, null, viewer?.sleeperUserId ?? null);
  const rosterId = requested ?? viewerRosterId ?? teams[0].sleeperRosterId;
  const chosenByDefault = requested === null && viewerRosterId === null;
  const team = teams.find((t) => t.sleeperRosterId === rosterId)!;

  const context = await resolveLeagueContext(
    admin,
    league.metadata as unknown as SleeperLeague,
    resolvedSource.slug,
  );
  const season = String(league.season ?? new Date().getUTCFullYear());
  // A stored view already in hand lets loadBlueprint skip one read on its
  // warm path. One indexed row; no build.
  const cachedNow =
    context.coverage === "none"
      ? null
      : await readCachedBlueprint(admin, {
          leagueRowId: league.id,
          rosterId,
          season,
          source: context.sourceSlug,
        });

  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = withUsername(`/leagues/${sleeperLeagueId}`, linkUsername);
  const canonical = `/leagues/${sleeperLeagueId}/blueprint?roster=${rosterId}`;

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="blueprint"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Blueprint" }]}
      copyHref={canonical}
      copyAriaLabel={`Copy link to ${team.teamName}'s blueprint`}
      otherLeagues={otherLeagues}
      masthead={leagueMastheadProps(league, context, pulseCached)}
    >
      {/* The controls share a wrapper with the sheet so the sticky bar has the
          whole page to travel in; a wrapper of its own height pins it nowhere. */}
      <div className="mt-6">
        <BlueprintControls sleeperLeagueId={sleeperLeagueId} linkUsername={linkUsername} rosterId={rosterId} teams={teams} />
        {chosenByDefault && (
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            No team was chosen, so this is the first team in the league. Pick yours above.
          </p>
        )}

        <Suspense
          key={`${rosterId}-${context.sourceSlug}`}
          fallback={<SheetSkeleton teamName={team.teamName} leagueName={league.name} season={season} />}
        >
          <BlueprintBody
            leagueId={sleeperLeagueId}
            league={league}
            rosterId={rosterId}
            chosenByDefault={chosenByDefault}
            sourceSlug={resolvedSource.slug}
            resynced={!pulseCached}
            linkUsername={linkUsername}
            canonical={canonical}
            prefetched={{ context, cached: cachedNow }}
          />
        </Suspense>
      </div>
    </LeagueShell>
  );
}

function BlueprintShare({
  view,
  canonical,
  sleeperLeagueId,
  linkUsername,
}: {
  view: BlueprintView;
  canonical: string;
  sleeperLeagueId: string;
  linkUsername: string | null;
}) {
  const shareHref = `/api/og/blueprint/${sleeperLeagueId}/${view.rosterId}/share${
    view.header.sourceSlug ? `?source=${encodeURIComponent(view.header.sourceSlug)}` : ""
  }`;
  return (
    <ShareStrip
      id="blueprint-share"
      imageHref={shareHref}
      imageDescription={describeBlueprint(view)}
      imageAriaLabel={`Copy image: ${view.header.teamName}'s blueprint, as a picture on the clipboard`}
      imageLinkAriaLabel={`Copy image link: a web address for ${view.header.teamName}'s blueprint picture`}
      pageHref={withUsername(canonical, linkUsername)}
      pageNoun="Blueprint link"
      pageAriaLabel={`Copy page link: a web address for ${view.header.teamName}'s blueprint`}
    />
  );
}

async function BlueprintBody({
  leagueId,
  league,
  rosterId,
  chosenByDefault,
  sourceSlug,
  resynced,
  linkUsername,
  canonical,
  prefetched,
}: {
  leagueId: string;
  league: NonNullable<Awaited<ReturnType<typeof getSyncedLeague>>>["league"];
  rosterId: number;
  chosenByDefault: boolean;
  sourceSlug: string | null;
  resynced: boolean;
  linkUsername: string | null;
  canonical: string;
  prefetched: LoadBlueprintArgs["prefetched"];
}) {
  const admin = createAdminClient();
  const [result, settings, marketSettings, offer] = await Promise.all([
    loadBlueprint({ admin, league, rosterId, sourceSlug, resynced, prefetched }),
    loadLeagueBlueprintSettings(admin),
    loadMarketSignalSettings(admin),
    loadOfferState(admin),
  ]);

  if (result.kind === "no-coverage") {
    return (
      <div className="mt-6">
        <Panel eyebrow="Team Blueprint" title="No values for this format">
          <p className="text-sm leading-relaxed text-ink-muted">
            {result.context.sourceDisplay} has no values for this league&apos;s format. Pick another source in the header.
          </p>
        </Panel>
      </div>
    );
  }
  if (result.kind === "rate-limited") {
    return (
      <div className="mt-6">
        <Panel eyebrow="Team Blueprint" title="Try again in a minute">
          <p className="text-sm leading-relaxed text-ink-muted">
            Too many blueprints were built from here in the last minute.
          </p>
        </Panel>
      </div>
    );
  }
  if (result.kind === "failed") {
    return (
      <div className="mt-6">
        <Panel eyebrow="Team Blueprint" title="The blueprint could not be built">
          <p className="text-sm leading-relaxed text-ink-muted">
            Something went wrong reading this league&apos;s numbers. Reload the page to try again.
          </p>
        </Panel>
      </div>
    );
  }

  const view = result.view;
  const bands: [number, number] = [settings.activity.lowBelow, settings.activity.highAbove];
  const T = view.header.teamCount;
  return (
    <>
      {result.kind === "stale" && (
        <p role="status" className="mt-6 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-4 py-3 text-sm text-ink">
          {result.reason === "failed"
            ? "The latest rebuild failed; showing the previous blueprint."
            : "Too many blueprints were built from here in the last minute; showing the previous blueprint."}{" "}
          As of {formatEastern(view.generatedAt)}.
        </p>
      )}
      <Sheet labelledBy={BLUEPRINT_TITLE_ID}>
        <Letterhead view={view} leagueName={league.name}>
          <BlueprintShare view={view} canonical={canonical} sleeperLeagueId={leagueId} linkUsername={linkUsername} />
        </Letterhead>
        <StandingPanel view={view} number="01" />
        <PrioritiesPanel priorities={view.priorities} number="02" />
        <GradeRings grades={view.grades} teamCount={T} number="03" />
        <LineupTable view={view} number="04" />
        <DepthLists view={view} number="05" />
        <SharesPanel view={view} number="06" />
        <AgeChart age={view.age} number="07" />
        <MoversPanel view={view} number="08" />
        <SpotlightCard view={view} number="09" />
        <CallsPanel view={view} bands={bands} linkUsername={linkUsername} signalWindowDays={marketSettings.windowDays} number="10" />
        <CapitalPanel view={view} number="11" />
        <StrategyPanel view={view} linkUsername={linkUsername} number="12" />
        {/* Outside the stored view on purpose: the cache, the fingerprint and
            the share images know nothing about it. */}
        {offer.settings.placements.blueprintSection && offer.availability.reason !== "closed" && (
          <SheetSection id="review" number="13" title="Personal review" helper="Michael reads this team and writes to you.">
            <ProductOffer
              family="team-review"
              placement="blueprint"
              sleeperLeagueId={leagueId}
              rosterId={chosenByDefault ? null : rosterId}
              linkUsername={linkUsername}
              products={offer.products}
              availability={offer.availability}
              settings={offer.settings}
            />
          </SheetSection>
        )}
        <footer
          aria-labelledby="bp-notes"
          className="grid gap-4 border-t border-line bg-base/30 px-5 py-6 sm:px-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8"
        >
          <h2 id="bp-notes" className="text-sm font-bold uppercase tracking-[0.14em] text-ink">
            How this is read
          </h2>
          <div className="min-w-0 space-y-1 text-xs leading-relaxed text-ink-muted">
            <p>
              {view.header.formatDisplay} values by {view.header.sourceDisplay}.
              {view.header.pickSourceDisplay ? ` Draft pick values powered by ${view.header.pickSourceDisplay}.` : ""}
            </p>
            <p>Defenders carry no market value and receive no call.</p>
            <p>Grades are league relative: 10 is the best of {T} teams.</p>
            <p>
              Market signals compare each player with his own last {marketSettings.windowDays} days of {view.header.sourceDisplay} values.
            </p>
            <p>Trade shapes never send a Build around player, so the plan and the trades agree.</p>
            <p>Prepared {formatEastern(view.generatedAt)} by FF Beacon, ffbeacon.com. Not a promise about any player; the league&apos;s numbers as they stand.</p>
          </div>
        </footer>
      </Sheet>
    </>
  );
}
