import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cache, Suspense } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarRange,
  Clock,
  LineChart,
  Swords,
  Users,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  loadBreakdown,
  LENSES,
  EMPTY_EXTRAS,
  type BreakdownPlayer,
  type GroupEdge,
  type LensId,
} from "@/lib/beacon-breakdown";
import type { MetricSide } from "@/lib/breakdown/metrics";
import { loadLeagueMode, type LeagueModeResult } from "@/lib/breakdown/league-mode";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { findPlayerTrades } from "@/lib/player-trades";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  describeSource,
} from "@/lib/source";
import { currentNflSeason } from "@/lib/sleeper";
import { resolveHandleGate } from "@/lib/sleeper-handle/resolve";
import { SITE } from "@/lib/site";
import { formatEastern } from "@/lib/datetime";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { searchFantasyPlayers } from "@/lib/player-search";
import { readSleeperId } from "@/lib/player-profile";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import {
  loadStartSitBoard,
  normalizeStartSitSlugs,
  parseStartCountParam,
  remainingWeeksFrom,
  resolveBoardWeek,
} from "@/lib/start-sit/load";
import { computeStartSit } from "@/lib/start-sit/engine";
import { clampStartCount } from "@/lib/start-sit/rank";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import {
  loadStartSitToughestCallsCached,
  type ToughestCallsFormat,
  type ToughestCallsPair,
  type ToughestCallsResult,
} from "@/lib/start-sit/toughest-calls";
import { START_SIT_FAQ, weekLabel } from "@/lib/start-sit/copy";
import {
  MIN_START_SIT_PLAYERS,
  type PulsePosition,
} from "@/lib/start-sit/types";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import { isDiscordMember } from "@/lib/discord-membership";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { StartSitPicker, type StartSitPickedPlayer } from "./start-sit-picker";
import { WeekSelect } from "./week-select";
import {
  StartSitBoard,
  type StartSitBoardFormMap,
  type StartSitBoardMarketMap,
} from "./start-sit-board";
import { WrittenSections } from "./written-sections";
import { ToughestCalls, buildStartSitClosestCalls } from "./toughest-calls";
import { BreakdownTabs, type BreakdownTab } from "./breakdown-tabs";
import { LensSwitch } from "./lens-switch";
import { BeaconEdgeMeter } from "./beacon-edge-meter";
import { EdgeContributionChart } from "./edge-contribution-chart";
import { BreakdownTable } from "./breakdown-table";
import { QuickTakeaways } from "./breakdown-summary";
import { LeagueTab } from "./league-tab";
import { LeaguePanel } from "./league-panel";
import { ProjectionsTab } from "./projections-tab";
import { ReliabilityTab } from "./reliability-tab";
import { MarketTab } from "./market-tab";
import { StatsCompare } from "./stats-compare";
import { loadBreakdownStats } from "./load-stats";
import {
  TOOL_PATH,
  START_SIT_TITLE,
  START_SIT_H1,
  buildStartSitDescription,
  buildStartSitCanonical,
  buildStartSitOgImagePath,
  parseRawPlayerEntries,
  firstParamValue,
  type StartSitSearchParams,
} from "./page-helpers";

export const dynamic = "force-dynamic";

type AnySupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ */
/* Slug / name resolution, shared by generateMetadata and the page.    */
/* ------------------------------------------------------------------ */

type ResolvedEntry = { slug: string; player: StartSitPickedPlayer | null };

type PlayerIdentityRow = {
  slug: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  external_ids: Record<string, unknown> | null;
};

function displayNameOf(row: {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  slug: string;
}): string {
  const full = row.full_name?.trim();
  if (full) return full;
  const combined = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return combined.length > 0 ? combined : row.slug;
}

/**
 * ?p= entries, resolved into real player slugs. An entry that already matches
 * a known slug is used as-is; anything else is treated as a typed player
 * name (the no-JS picker submits names) and resolved through the same
 * fantasy-relevant player search the combobox itself calls, first match.
 * An entry that resolves to nothing is passed through unchanged so
 * loadStartSitBoard's own notFoundSlugs handling can tell the reader
 * plainly, and it is left out of `players` (the picker's chip list) since
 * there is nothing real to show a chip for.
 *
 * Deduped and capped through lib/start-sit/load.ts normalizeStartSitSlugs,
 * the same helper loadStartSitBoard itself uses, so the two can never
 * disagree about which slugs made the cut.
 */
/**
 * ONE LOOKUP PER REQUEST. generateMetadata and the page body both resolve the
 * same ?p= entries, and each non-slug entry is a player search. React cache
 * keys on its arguments by identity, so the entry list travels as one JSON
 * string, and the lookup uses the request-cached admin client (these are
 * public player reads).
 */
const resolveStartSitEntriesOnce = cache(async (entriesKey: string) =>
  resolveStartSitEntries(createAdminClient(), JSON.parse(entriesKey) as string[]),
);

async function resolveStartSitEntries(
  supabase: AnySupabase,
  rawEntries: string[],
): Promise<{ slugs: string[]; players: StartSitPickedPlayer[] }> {
  if (rawEntries.length === 0) return { slugs: [], players: [] };

  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("players")
    .select("slug, full_name, first_name, last_name, position, team, external_ids")
    .in("slug", rawEntries);

  const bySlug = new Map<string, PlayerIdentityRow>();
  for (const row of (data ?? []) as unknown as PlayerIdentityRow[]) {
    bySlug.set(row.slug, row);
  }

  const resolved: ResolvedEntry[] = await Promise.all(
    rawEntries.map(async (entry): Promise<ResolvedEntry> => {
      const direct = bySlug.get(entry);
      if (direct) {
        return {
          slug: direct.slug,
          player: {
            slug: direct.slug,
            name: displayNameOf(direct),
            position: direct.position,
            team: direct.team,
            sleeperId: readSleeperId({ external_ids: direct.external_ids, slug: direct.slug }),
          },
        };
      }
      try {
        const results = await searchFantasyPlayers(supabase, { query: entry, limit: 1 });
        const match = results[0];
        if (match) {
          return {
            slug: match.slug,
            player: {
              slug: match.slug,
              name: displayNameOf({
                full_name: match.full_name,
                first_name: match.first_name,
                last_name: match.last_name,
                slug: match.slug,
              }),
              position: match.position,
              team: match.team,
              sleeperId: readSleeperId(match),
            },
          };
        }
      } catch {
        // Falls through to the unresolved case below.
      }
      return { slug: entry, player: null };
    }),
  );

  const slugs = normalizeStartSitSlugs(resolved.map((r) => r.slug));
  const players = slugs
    .map((slug) => resolved.find((r) => r.slug === slug)?.player ?? null)
    .filter((p): p is StartSitPickedPlayer => p !== null);

  return { slugs, players };
}

/* ------------------------------------------------------------------ */
/* Metadata                                                             */
/* ------------------------------------------------------------------ */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<StartSitSearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const supabase = await createClient();

  const clock = await resolveSeasonClock(supabase);
  const description = buildStartSitDescription(clock.currentWeek);
  const canonical = buildStartSitCanonical();

  const rawEntries = parseRawPlayerEntries(params);
  let imagePath = "/api/og/page/beacon-breakdown";

  if (rawEntries.length >= MIN_START_SIT_PLAYERS) {
    const [{ slugs }, formatResolution, sourceResolution] = await Promise.all([
      resolveStartSitEntriesOnce(JSON.stringify(rawEntries)),
      resolveFormatSlug(supabase, params.format),
      resolveSourceSlug(supabase, params.source),
    ]);
    if (slugs.length >= MIN_START_SIT_PLAYERS) {
      imagePath = buildStartSitOgImagePath({
        slugs,
        start: clampStartCount(parseStartCountParam(params.start), slugs.length),
        week: resolveBoardWeek(params.week, clock.currentWeek),
        format: formatResolution.slug,
        source: sourceResolution.slug,
      });
    }
  }

  const image = `${SITE.url}${imagePath}`;
  const url = `${SITE.url}${canonical}`;

  return {
    title: { absolute: START_SIT_TITLE },
    description,
    alternates: { canonical },
    openGraph: {
      title: START_SIT_TITLE,
      description,
      url,
      siteName: SITE.name,
      type: "website",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: "Beacon Breakdown, the free start/sit tool",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: START_SIT_TITLE,
      description,
      images: [image],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default async function WhoShouldIStartPage({
  searchParams,
}: {
  searchParams: Promise<StartSitSearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();

  const rawEntries = parseRawPlayerEntries(params);

  const [clock, pulseSettings, formatResolution, sourceResolution, registry, activeFormats, isMember] =
    await Promise.all([
      resolveSeasonClock(supabase),
      loadPowerPulseSettings(admin),
      resolveFormatSlug(supabase, params.format),
      resolveSourceSlug(supabase, params.source),
      getAvailableSources(supabase),
      getActiveFormats(supabase),
      isDiscordMember(),
    ]);

  const formatRow = activeFormats.find((f) => f.slug === formatResolution.slug) ?? null;
  const formatDisplay = formatRow?.display_name ?? formatResolution.slug;
  const engineFormat: ToughestCallsFormat = {
    slug: formatResolution.slug,
    display: formatDisplay,
    scoring_type: formatRow?.scoring_type ?? "ppr",
    te_premium_bonus: formatRow?.te_premium_bonus ?? null,
  };

  const valueResolution = formatRow
    ? resolveSourceForFormat(registry, "player_value_history", formatRow.slug, sourceResolution.slug)
    : null;
  const sourceDisplay = valueResolution?.source ? describeSource(registry, valueResolution.source) : null;

  const rankingsResolution = formatRow
    ? resolveSourceForFormat(registry, "rankings", formatRow.slug, sourceResolution.slug)
    : null;
  const rankingsSource = rankingsResolution?.source ?? null;

  const { slugs: finalSlugs, players: initialPlayers } = await resolveStartSitEntriesOnce(JSON.stringify(rawEntries));
  const hasPlayers = finalSlugs.length >= MIN_START_SIT_PLAYERS;
  const initialStart = clampStartCount(parseStartCountParam(params.start), finalSlugs.length);

  const remainingWeeks = remainingWeeksFrom(clock.currentWeek);
  // The heading names the week the board shows (?week= or the live week), so it
  // never disagrees with the "Week N, season" line under it.
  const selectedWeek = resolveBoardWeek(params.week, clock.currentWeek);

  // The projection engine named in the written sections and the page's own
  // structured data: resolved for the LIVE week (the same window the
  // toughest-calls block uses), never the reader's selected ?week=, and
  // never the no-argument currentProjectionSourceCached(). The board itself
  // (inside the Suspense boundary) resolves its own copy for the SELECTED
  // week; the two agree whenever the switch has not moved mid-render.
  const [projectionSourceSlug, toughestCalls] = await Promise.all([
    clock.season != null
      ? resolveProjectionSourceForWindow({
          supabase,
          season: clock.season,
          fromWeek: clock.currentWeek,
          toWeek: clock.currentWeek,
          settings: pulseSettings.beaconProjections,
        })
      : Promise.resolve(null),
    clock.season != null && formatRow?.id && rankingsSource
      ? loadStartSitToughestCallsCached({
          supabase,
          formatConfigId: formatRow.id,
          format: engineFormat,
          rankingsSource,
          season: clock.season,
          week: clock.currentWeek,
        })
      : Promise.resolve<ToughestCallsResult>(emptyToughestCallsResult()),
  ]);

  const projectionSourceName = projectionSourceDisplay(projectionSourceSlug);

  const updatedAt = await loadFreshestProjectionTimestamp(
    supabase,
    clock.season,
    clock.currentWeek,
    projectionSourceSlug,
  );

  const closestCalls = buildStartSitClosestCalls(toughestCalls.byPosition, TOOL_PATH);

  const description = buildStartSitDescription(clock.currentWeek);
  const jsonLd = [
    webApplicationJsonLd({
      name: "Beacon Breakdown Start/Sit Tool",
      description,
      url: TOOL_PATH,
      category: "SportsApplication",
      dateModified: updatedAt ?? undefined,
    }),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: START_SIT_FAQ.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <PageBody>
        <PageMasthead
          eyebrow="Tools"
          title={START_SIT_H1}
          description="Put your players in and get a start/sit verdict built from this week's projections and matchups, with a confidence figure to back it."
          actions={
            <Link
              href="/rankings"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Player Rankings
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          }
        />

        {/* The H2 and the picker render in BOTH the empty and loaded state
            (section 2.4): the indexed empty state must carry this heading
            too, not only the loaded board. Only the Suspense-wrapped board
            itself is conditional on there being enough players to show one;
            the empty state is the masthead, the picker, the toughest calls
            and the written outline, with no skeleton where content should
            be. */}
        <section
          id="start-sit-board-section"
          aria-labelledby="start-sit-board-heading"
          className="mt-8 scroll-mt-24"
        >
          <div className="mx-auto max-w-[90rem]">
            <h2
              id="start-sit-board-heading"
              className="scroll-mt-24 text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
            >
              Who should I start in Week {selectedWeek}?
            </h2>

            <div className="mt-4 mx-auto max-w-5xl space-y-6">
              <StartSitPicker
                basePath={TOOL_PATH}
                initialPlayers={initialPlayers}
                initialStart={initialStart}
                formatDisplay={formatDisplay}
                sourceDisplay={sourceDisplay}
              />
              <WeekSelect currentWeek={clock.currentWeek} weeks={remainingWeeks} />
            </div>

            {hasPlayers && (
              <div className="mt-4">
                <Suspense fallback={<AnalysisSkeleton />}>
                  <BoardSection
                    finalSlugs={finalSlugs}
                    params={params}
                    pulseSettings={pulseSettings}
                    basePath={TOOL_PATH}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>

        <div className="mt-16 mx-auto max-w-5xl">
          <ToughestCalls result={toughestCalls} basePath={TOOL_PATH} week={clock.currentWeek} />
        </div>

        <div className="mx-auto max-w-5xl">
          <WrittenSections
            week={clock.currentWeek}
            season={clock.season ?? Number(currentNflSeason())}
            projectionSourceName={projectionSourceName}
            formatSlug={formatResolution.slug}
            formatDisplay={formatDisplay}
            closestCalls={closestCalls}
          />
        </div>
      </PageBody>
      <DiscordCtaSection
        eyebrow="Still not sure?"
        heading="Still can't decide? Talk it out with real people."
        body="The confidence figure gives you a clear lean, but a close start/sit call can stay close. Bring it to our Discord and real fantasy managers will help you settle it for free. Want to know what's behind FF Beacon? Read about the project."
        isMember={isMember}
        memberHeading="Call made? Explore the rest of the toolkit."
        memberBody="You're already in the crew, so we'll skip the invite. Dig into the other free FF Beacon tools for your next close call."
      />
    </main>
  );
}

function emptyToughestCallsResult(): ToughestCallsResult {
  const byPosition = {} as Record<PulsePosition, ToughestCallsPair[]>;
  for (const position of PULSE_POSITIONS) byPosition[position] = [];
  return { grid: [], byPosition };
}

/**
 * The freshest player_weekly_projections.updated_at for the live week and
 * the resolved projection source, for the page's own dateModified. Mirrors
 * the same read lib/start-sit/load.ts makes for the board's own timestamp,
 * scoped to the live week rather than the reader's selected one, matching
 * projectionSourceSlug above.
 */
async function loadFreshestProjectionTimestamp(
  supabase: AnySupabase,
  season: number | null,
  week: number,
  source: string | null,
): Promise<string | null> {
  if (season == null || !source) return null;
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_weekly_projections")
    .select("updated_at")
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("week", week)
    .eq("source", source)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.updated_at ?? null;
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <p role="status" className="sr-only">
        Working out who to start.
      </p>
      <div aria-hidden="true" className="space-y-6">
        <div className="h-24 animate-pulse motion-reduce:animate-none rounded-modal border border-line bg-surface/40" />
        <div className="h-48 animate-pulse motion-reduce:animate-none rounded-modal border border-line bg-surface/40" />
        <div className="h-96 animate-pulse motion-reduce:animate-none rounded-modal border border-line bg-surface/40" />
      </div>
    </div>
  );
}

/**
 * The connected league's Sleeper image id, or null. Read through the admin
 * client because leagues.metadata is the stored raw Sleeper object and the
 * row may belong to a league the reader is not in. Never throws: a missing
 * logo renders the same-sized placeholder and the row stays aligned.
 */
async function loadLeagueAvatar(sleeperLeagueId: string): Promise<string | null> {
  try {
    const { data } = await createAdminClient()
      .from("leagues")
      .select("avatar:metadata->>avatar")
      .eq("sleeper_league_id", sleeperLeagueId)
      .maybeSingle<{ avatar: unknown }>();
    const avatar = data?.avatar;
    return typeof avatar === "string" && avatar.length > 0 ? avatar : null;
  } catch {
    return null;
  }
}

/**
 * The measured half: the board, the market map, and (when the group loaded)
 * the background tabs. loadStartSitBoard and loadBreakdown run in parallel
 * over the SAME resolved slugs, then computeStartSit; everything the tabs
 * need beyond that (stats, trades, league mode) runs as a second parallel
 * wave, never a chain of awaits.
 */
async function BoardSection({
  finalSlugs,
  params,
  pulseSettings,
  basePath,
}: {
  finalSlugs: string[];
  params: StartSitSearchParams;
  pulseSettings: Awaited<ReturnType<typeof loadPowerPulseSettings>>;
  basePath: string;
}) {
  const supabase = await createClient();

  const [board, groupLookup] = await Promise.all([
    loadStartSitBoard({
      supabase,
      slugs: finalSlugs,
      weekParam: params.week,
      startParam: params.start,
      formatParam: params.format,
      sourceParam: params.source,
    }),
    loadBreakdown(supabase, finalSlugs, {
      formatParam: firstParamValue(params.format),
      sourceParam: firstParamValue(params.source),
      pulseSettings,
    }),
  ]);

  const verdict = computeStartSit({
    candidates: board.candidates,
    projections: Object.fromEntries(board.projections.map((p) => [p.playerId, p])),
    startCount: board.startCount,
    week: board.week,
    season: board.season ?? Number(currentNflSeason()),
    formatDisplay: board.format.display,
    projectionSource: board.projectionSource,
  });

  let market: StartSitBoardMarketMap | undefined;
  let recentForm: StartSitBoardFormMap | undefined;
  let tabsContent: ReactNode = null;

  if (groupLookup.ok) {
    const { group, extras, context } = groupLookup.result;

    // The per-week actual against projected list the Reliability tab draws,
    // handed to each card's recent form chart. Same load, no extra read.
    //
    // Trimmed to weeks already PLAYED. The loader keeps every projected week
    // of the graded season, so while that season is the current one, every
    // week still to come arrives with a projection, no score and
    // `missed: true`, and would chart as a game the player sat out. The live
    // week is excluded too: its games may still be in progress.
    recentForm = Object.fromEntries(
      group.sides.map((player) => {
        const reliability = extras.get(player.id)?.reliability ?? null;
        if (!reliability) return [player.id, null];
        const inCurrentSeason =
          reliability.season != null &&
          reliability.season >= (board.season ?? Number(currentNflSeason()));
        const playedThrough = inCurrentSeason ? board.currentWeek - 1 : Number.POSITIVE_INFINITY;
        return [
          player.id,
          {
            season: reliability.season,
            weeks: reliability.weeks.filter((w) => w.week <= playedThrough),
          },
        ];
      }),
    );

    if (context.sourceDisplay) {
      market = Object.fromEntries(
        group.sides.map((player) => [
          player.id,
          {
            value: player.value,
            overallRank: player.overallRank,
            sourceName: context.sourceDisplay as string,
            isBeacon: context.valueIsBeacon,
          },
        ]),
      );
    }

    const rosterIdRaw = firstParamValue(params.roster);
    const leagueId = firstParamValue(params.league);
    const rosterId = rosterIdRaw ? Number(rosterIdRaw) : NaN;
    const wantsLeague = Boolean(leagueId) && Number.isInteger(rosterId) && rosterId > 0;

    const [handleGate, leagueAvatar, stats, tradesEntries, leagueMode] = await Promise.all([
      resolveHandleGate(supabase, undefined),
      wantsLeague && leagueId ? loadLeagueAvatar(leagueId) : Promise.resolve(null),
      loadBreakdownStats(
        supabase,
        group.sides.map((p) => ({ id: p.id, name: p.name, position: p.position })),
      ),
      Promise.all(
        group.sides.map(
          async (p) =>
            [p.id, p.sleeperId ? await findPlayerTrades(supabase, p.sleeperId, { limit: 3 }) : []] as const,
        ),
      ),
      wantsLeague && leagueId
        ? loadLeagueMode({
            sleeperLeagueId: leagueId,
            rosterId,
            sleeperIds: group.sides.map((p) => p.sleeperId),
          })
        : Promise.resolve<LeagueModeResult>({ report: null, notice: null }),
    ]);

    const tradesById = new Map(tradesEntries);
    const leagueReport = leagueMode.report;

    const metricSides: MetricSide[] = group.sides.map((player, i) => ({
      player,
      extras: extras.get(player.id) ?? EMPTY_EXTRAS,
      league: leagueReport?.impacts[i] ?? null,
    }));

    const panels = Object.fromEntries(
      LENSES.map((lens) => [
        lens.id,
        <HeadToHeadPanel
          key={lens.id}
          sides={group.sides}
          metricSides={metricSides}
          edge={group.edges[lens.id]}
          lens={lens.id}
          valueIsBeacon={context.valueIsBeacon}
        />,
      ]),
    ) as Record<LensId, ReactNode>;

    const tabs: BreakdownTab[] = [
      {
        id: "head-to-head",
        label: "Head to head",
        icon: <Swords className="h-4 w-4" />,
        content: <LensSwitch panels={panels} />,
      },
    ];

    if (leagueReport) {
      tabs.push({
        id: "your-lineup",
        label: "Your lineup",
        icon: <Users className="h-4 w-4" />,
        content: (
          <LeagueTab
            sides={group.sides.map((p, i) => ({ player: p, impact: leagueReport.impacts[i] ?? null }))}
            report={leagueReport}
          />
        ),
      });
    }

    tabs.push(
      {
        id: "projections",
        label: "Projections",
        icon: <CalendarRange className="h-4 w-4" />,
        content: (
          <ProjectionsTab
            sides={group.sides}
            extras={extras}
            projectionSourceDisplay={projectionSourceDisplay(board.projectionSource)}
          />
        ),
      },
      {
        id: "reliability",
        label: "Reliability",
        icon: <Activity className="h-4 w-4" />,
        content: <ReliabilityTab sides={group.sides} extras={extras} />,
      },
      {
        id: "market",
        label: "Market",
        icon: <LineChart className="h-4 w-4" />,
        content: (
          <MarketTab
            sides={group.sides.map((player) => ({
              player,
              market: extras.get(player.id)?.market ?? null,
              trades: tradesById.get(player.id) ?? [],
            }))}
            sourceDisplay={context.sourceDisplay}
            formatDisplay={context.formatDisplay}
          />
        ),
      },
      {
        id: "stats",
        label: "Stats",
        icon: <BarChart3 className="h-4 w-4" />,
        content: <StatsCompare players={stats} />,
      },
    );

    tabsContent = (
      <div className="mt-6 space-y-6">
        <LeaguePanel
          active={
            leagueReport
              ? {
                  sleeperLeagueId: leagueReport.league.sleeperLeagueId,
                  name: leagueReport.league.name,
                  teamName: leagueReport.team.name,
                  record: leagueReport.team.record,
                  season: leagueReport.league.season,
                  scoringDescription: leagueReport.league.scoringDescription,
                  avatar: leagueAvatar,
                }
              : null
          }
          handleGate={handleGate}
          defaultSeason={currentNflSeason()}
          applyHrefBase={buildBoardUrl(basePath, params, { league: undefined, roster: undefined })}
          clearHref={buildBoardUrl(basePath, params, { league: undefined, roster: undefined })}
        />

        {leagueMode.notice && (
          <p
            role="status"
            className="rounded-card border border-dashed border-signal-warning/40 bg-signal-warning/5 px-4 py-2 text-sm text-ink-muted"
          >
            {leagueMode.notice}
          </p>
        )}

        <BreakdownTabs tabs={tabs} />

        <PackageHandoff />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {board.updatedAt && (
        <p className="inline-flex flex-wrap items-center gap-2 rounded-full border border-line bg-surface/50 px-3.5 py-1.5 text-sm text-ink-muted">
          <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
          <span>
            <span className="font-semibold text-ink">
              {weekLabel(board.week, board.season ?? Number(currentNflSeason()))}.
            </span>{" "}
            Projections updated {formatEastern(board.updatedAt)}.
          </span>
        </p>
      )}
      <StartSitBoard
        board={board}
        verdict={verdict}
        market={market}
        recentForm={recentForm}
        basePath={basePath}
      />
      {tabsContent}
    </div>
  );
}

/** One lens's worth of the Head to head tab: the meter, the contribution chart, the table, and the takeaways. */
function HeadToHeadPanel({
  sides,
  metricSides,
  edge,
  lens,
  valueIsBeacon,
}: {
  sides: BreakdownPlayer[];
  metricSides: MetricSide[];
  edge: GroupEdge;
  lens: LensId;
  valueIsBeacon: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <BeaconEdgeMeter sides={sides} edge={edge} />
        <EdgeContributionChart sides={sides} edge={edge} />
      </div>

      <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-6">
        <h3 className="mb-4 text-lg font-semibold tracking-tight text-ink sm:text-xl">Category comparison</h3>
        <BreakdownTable sides={metricSides} edge={edge} valueIsBeacon={valueIsBeacon} />
      </div>

      <QuickTakeaways sides={sides} edge={edge} lens={lens} />
    </div>
  );
}

/**
 * The current board URL with the named overrides applied. Only the params
 * the board itself owns are considered; an unrecognised key already present
 * in `params` is dropped rather than carried through blind, matching
 * lib/start-sit/picker-url.ts buildStartSitHref's own owned-params list.
 */
function buildBoardUrl(
  basePath: string,
  params: StartSitSearchParams,
  overrides: Partial<Record<"p" | "start" | "week" | "format" | "source" | "league" | "roster", string | undefined>>,
): string {
  const keys = ["p", "start", "week", "format", "source", "league", "roster"] as const;
  const merged = new URLSearchParams();
  for (const key of keys) {
    const value = key in overrides ? overrides[key] : firstParamValue(params[key]);
    if (value) merged.set(key, value);
  }
  const qs = merged.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * The exit to Signal Check. A head-to-head board is the wrong shape for a
 * real trade, which is usually two for one or three for two. Signal Check
 * already prices multi-asset packages, values picks, and grades the whole
 * deal, so the board points at it rather than growing a second, weaker copy
 * of that engine.
 */
function PackageHandoff() {
  return (
    <section
      aria-labelledby="package-heading"
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5"
    >
      <h3 id="package-heading" className="text-sm font-semibold text-ink">
        Is this actually a bigger trade?
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Real trades are rarely one player for one player. If these players are only part of a bigger deal,
        build the whole thing in the Signal Check trade calculator: it prices multi-player packages and draft
        picks together and grades the trade end to end.
      </p>
      <Link
        href="/tools/trade-calculator"
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Build the full trade in the Signal Check Trade Calculator
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
