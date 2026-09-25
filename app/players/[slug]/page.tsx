import type { Metadata } from "next";
import { Suspense } from "react";
import { SectionLoadingCard } from "@/components/section-loading-card";
import { serializeJsonLd } from "@/lib/json-ld";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE, isDefender, positionNoun } from "@/lib/site";
import { idpRelevantPlayerIdSet } from "@/lib/player-search";
import {
  loadPlayerAndContext,
  loadTeamRow,
  recentFinishesForScoring,
  depthRoleForPlayer,
  SCORING_KEYS,
} from "@/lib/player-profile";
import { loadPositionalFinishesCached } from "@/lib/player-profile-cache";
import { PageBody } from "@/components/app-shell/page-body";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { PlayerHero } from "@/components/player-profile/player-hero";
import { PlayerTabs } from "@/components/player-profile/player-tabs";
import { PlayerRailSections } from "@/components/player-profile/player-rail-sections";
import {
  PLAYER_NAV_ITEMS,
  type PlayerTabId,
} from "@/components/player-profile/nav-items";
import { OverviewTab } from "@/components/player-profile/overview-tab";
import { StatsTab } from "@/components/player-profile/stats-tab";
import { TradesTab } from "@/components/player-profile/trades-tab";
import { BeaconBriefTab } from "@/components/player-profile/beacon-brief-tab";
import { TabLoading } from "@/components/player-profile/tab-loading";
import {
  DefenderOverviewTab,
  DefenderStatsTab,
  DEFENDER_FINISH_SCORING,
} from "@/components/player-profile/defender-tabs";

export const dynamic = "force-dynamic";

/** Read from the section list itself, so a new section cannot be reachable in
 *  the rail and rejected here. */
const VALID_TABS: PlayerTabId[] = PLAYER_NAV_ITEMS.map((item) => item.id);

type PlayerPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ format?: string; source?: string; tab?: string }>;
};

/**
 * Per-tab title suffix and description (SEO-T972 -- see plan section 4.5,
 * "The tab-canonical problem on player pages"). Statistics and trades carry
 * data unique to that tab (the game log, the trade ledger); Beacon Brief
 * carries the player's own news coverage, which is unique in the same way.
 * Overview is the default and keeps the original title/description below,
 * unmodified by this table.
 *
 * `description` is a suffix that STARTS with the name, so the shared cap
 * below can shorten only the name for an unusually long one, not the fixed
 * sentence that explains the tab.
 */
const TAB_METADATA: Record<
  Exclude<PlayerTabId, "overview">,
  { titleSuffix: string; description: (name: string) => string }
> = {
  statistics: {
    titleSuffix: "Game Log",
    description: (name) =>
      `${name} weekly fantasy football stat line: points, targets, carries, and box score totals for every game this season.`,
  },
  trades: {
    titleSuffix: "Trade History",
    description: (name) =>
      `${name} trade history: every fantasy football trade this player has been part of, graded with market value and a verdict.`,
  },
  "beacon-brief": {
    titleSuffix: "News",
    description: (name) =>
      `${name} fantasy football news: every Beacon Brief article that mentions this player.`,
  },
};

/**
 * The defender variants (plan IDP-203). A defender page has no trade value,
 * no value trend and no PPR line, so its title and descriptions name what it
 * does have: tackles, sacks, snap share, and points under IDP scoring.
 */
const DEFENDER_TAB_METADATA: typeof TAB_METADATA = {
  statistics: {
    titleSuffix: "IDP Game Log",
    description: (name) =>
      `${name} weekly defensive stat line: tackles, sacks, snap share and IDP points for every game this season.`,
  },
  trades: {
    titleSuffix: "Trade History",
    description: (name) =>
      `${name} trade history: every fantasy football trade this defensive player has been part of.`,
  },
  "beacon-brief": TAB_METADATA["beacon-brief"],
};

/** Title case for a position noun at the start of a label ("Linebacker"). */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Shorten only the name at the front of a description so the fixed sentence
 *  after it never gets cut mid-word for an unusually long player name. */
function capDescription(name: string, buildDescription: (name: string) => string, max = 150): string {
  const full = buildDescription(name);
  if (full.length <= max) return full;
  const suffixLength = buildDescription("").length;
  const budget = Math.max(0, max - suffixLength);
  const cappedName = name.slice(0, budget).trimEnd();
  return buildDescription(cappedName);
}

export async function generateMetadata({
  params,
  searchParams,
}: PlayerPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  const { data: player } = await supabase
    .from("players")
    .select("id, first_name, last_name, full_name, position, team")
    .eq("slug", slug)
    .maybeSingle();
  if (!player) {
    return { title: "Player not found" };
  }
  const name = player.full_name ?? `${player.first_name} ${player.last_name}`;
  const posTeam = `${player.position}${player.team ? `, ${player.team}` : ""}`;
  const bareCanonical = `${SITE.url}/players/${slug}`;
  // An unknown or invalid ?tab= value falls back to the overview metadata and
  // the bare canonical, so an arbitrary query string can never mint a new
  // canonical URL for this page.
  const activeTab: PlayerTabId = VALID_TABS.includes((tab ?? "") as PlayerTabId)
    ? (tab as PlayerTabId)
    : "overview";

  // The title leads with the words a reader actually types. "Is He Worth It?"
  // was a better headline than it was a search result: it matched nothing
  // anyone looks for, and it pushed stats and trade value past where a SERP
  // truncates. Everything named here is a section the profile really has.
  const defender = isDefender(player.position);
  let title = defender
    ? `${name} IDP Stats, Snap Share and News`
    : `${name} Fantasy Football Stats, Trade Value, News`;
  let description = defender
    ? capDescription(
        name,
        (n) =>
          `${n} (${positionNoun(player.position)}${player.team ? `, ${player.team}` : ""}) IDP profile: tackles, sacks, snap share, a weekly game log in four IDP scoring systems, and news.`,
      )
    : capDescription(
        name,
        (n) =>
          `${n} (${posTeam}) fantasy football profile: trade value and trend, weekly projections, game-log stats, and news.`,
      );
  let canonical = bareCanonical;

  if (activeTab !== "overview") {
    const tabMeta = (defender ? DEFENDER_TAB_METADATA : TAB_METADATA)[activeTab];
    title = `${name} ${tabMeta.titleSuffix}`;
    description = capDescription(name, tabMeta.description);
    // Self-referencing: the canonical keeps the tab parameter, so each tab's
    // unique content can be indexed on its own URL instead of collapsing onto
    // the overview.
    canonical = `${bareCanonical}?tab=${activeTab}`;
  }

  // A defender outside the IDP relevance gate (plan R-15, R-17) is a
  // practice-squad or long-gone name: still reachable, not worth an index
  // entry. The gate is a memoised set, so this costs no query per page.
  let indexable = true;
  if (defender) {
    const gate = await idpRelevantPlayerIdSet(supabase).catch(() => null);
    indexable = gate ? gate.has(player.id) : true;
  }

  const ogImage = `${SITE.url}/api/og/player/${slug}`;
  return {
    title,
    description,
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE.name,
      type: "profile",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${name} fantasy profile card`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PlayerPage({
  params,
  searchParams,
}: PlayerPageProps) {
  const { slug } = await params;
  const { format, source, tab } = await searchParams;
  const supabase = await createClient();

  const loaded = await loadPlayerAndContext(supabase, slug, {
    formatParam: format,
    sourceParam: source,
  });
  // Found or not found is decided HERE, before anything streams, so a
  // renamed or mistyped slug still answers a real 404. Everything slower
  // than that one lookup streams behind the loading card below (PERF-T034):
  // a route-level loading.tsx would flush a 200 before this line ran and
  // turn every missing player into a soft 404 on indexed URLs.
  if (!loaded) {
    notFound();
  }

  const activeTab: PlayerTabId = VALID_TABS.includes((tab ?? "") as PlayerTabId)
    ? (tab as PlayerTabId)
    : "overview";

  return (
    <main id="main">
      <Suspense
        fallback={<SectionLoadingCard section="Players" message="Loading this player page." />}
      >
        <PlayerPageBody
          loaded={loaded}
          slug={slug}
          activeTab={activeTab}
          format={format}
          source={source}
        />
      </Suspense>
    </main>
  );
}

async function PlayerPageBody({
  loaded,
  slug,
  activeTab,
  format,
  source,
}: {
  loaded: NonNullable<Awaited<ReturnType<typeof loadPlayerAndContext>>>;
  slug: string;
  activeTab: PlayerTabId;
  format: string | undefined;
  source: string | undefined;
}) {
  const supabase = await createClient();
  const { player, sleeperId, context } = loaded;

  // Team colors/chant + positional finishes load once here; the last-3 slice is
  // shared by the hero and the overview sidebar so the RPC runs a single time.
  const [team, allFinishes] = await Promise.all([
    loadTeamRow(supabase, player.team),
    loadPositionalFinishesCached(player.id),
  ]);
  const defender = isDefender(player.position);
  // A defender's finishes are ranked on Sleeper default IDP scoring, never on
  // the header format's PPR key (plan IDP-106, IDP-204).
  const last3 = defender
    ? allFinishes
        .filter((f) => (f.scoring as string) === "idp123")
        .sort((a, b) => b.season - a.season)
        .slice(0, 3)
    : recentFinishesForScoring(allFinishes, context.scoringKey, 3);
  const scoringLabel = defender
    ? DEFENDER_FINISH_SCORING
    : (SCORING_KEYS.find((s) => s.key === context.scoringKey)?.label ?? "PPR");
  const depthRole = depthRoleForPlayer(player);

  const fullName =
    player.full_name ??
    `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const canonical = `${SITE.url}/players/${slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: fullName,
      url: canonical,
      jobTitle: `${defender ? capitalize(positionNoun(player.position)) : player.position}${
        player.team ? `, ${player.team}` : ""
      } (NFL)`,
      ...(player.team
        ? { memberOf: { "@type": "SportsTeam", name: player.team } }
        : {}),
      ...(player.college
        ? { alumniOf: { "@type": "CollegeOrUniversity", name: player.college } }
        : {}),
      ...(player.birth_date ? { birthDate: player.birth_date } : {}),
      ...(player.height_inches
        ? {
            height: {
              "@type": "QuantitativeValue",
              value: player.height_inches,
              unitCode: "INH",
            },
          }
        : {}),
      ...(player.weight_lbs
        ? {
            weight: {
              "@type": "QuantitativeValue",
              value: player.weight_lbs,
              unitCode: "LBR",
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        defender
          ? // No rankings board lists defenders (R-18) and /players is not a
            // route, so the middle crumb names the section without a URL.
            { "@type": "ListItem", position: 2, name: "Players" }
          : {
          // The rankings hub, canonically. This used to point at
          // /rankings?position=QB, which is not a page: the hub either
          // redirects a reader with a saved format or renders the format
          // directory, and /rankings is what its own canonical tag names.
          // A breadcrumb item naming a URL that redirects is a breadcrumb
          // item naming the wrong page.
          "@type": "ListItem",
          position: 2,
          name: "Rankings",
          item: `${SITE.url}/rankings`,
        },
        { "@type": "ListItem", position: 3, name: fullName, item: canonical },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      {/* An apostrophe cannot survive a slug, so name the page for the bar. */}
      <SetBreadcrumbLabel value={fullName} />
      {/* The profile's four sections go into the site rail, opened, rather than
          into a bar of their own above the content. */}
      <PlayerRailSections
        slug={player.slug}
        playerName={fullName}
        activeTab={activeTab}
        source={source}
        format={format}
      />
      <article>
        {/* The masthead sits in the shared page column; each section body brings
            its own. Both run the full width the rail leaves, the way every other
            dashboard surface does. */}
        <PageBody flush>
          <PlayerHero
            player={player}
            sleeperId={sleeperId}
            scoringLabel={scoringLabel}
            finishes={last3}
            team={team}
            role={depthRole}
            {...(defender ? { variant: "defender" as const } : {})}
          />

          {/* The value-source fallback says nothing about a defender, who has
              no value from any source. */}
          {!defender && context.fallbackBanner && (
            <p
              role="status"
              className="mt-4 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
            >
              <span className="font-medium text-ink">Heads up:</span> No{" "}
              {context.fallbackBanner.requested} data available for{" "}
              {context.fallbackBanner.formatDisplay}. Showing{" "}
              {context.fallbackBanner.actual} values instead.
            </p>
          )}
        </PageBody>

        {/* Below lg there is no rail, so the sections keep a strip of their
            own here. See player-tabs.tsx. */}
        <PlayerTabs
          slug={player.slug}
          activeTab={activeTab}
          source={source}
          format={format}
        />

        {/* Stream each section behind a skeleton so the masthead paints
            immediately instead of blocking on that section's data. */}
        <Suspense key={activeTab} fallback={<TabLoading />}>
          {defender && activeTab === "overview" && (
            <DefenderOverviewTab player={player} finishesLast3={last3} />
          )}
          {defender && activeTab === "statistics" && <DefenderStatsTab player={player} />}
          {!defender && activeTab === "overview" && (
            <OverviewTab
              player={player}
              sleeperId={sleeperId}
              context={context}
              finishesLast3={last3}
            />
          )}
          {!defender && activeTab === "statistics" && (
            <StatsTab
              player={player}
              scoringKey={context.scoringKey}
              scoringLabel={scoringLabel}
              tePremiumBonus={
                player.position === "TE" ? context.tePremiumBonus : 0
              }
            />
          )}
          {activeTab === "trades" && (
            <TradesTab
              player={player}
              sleeperId={sleeperId}
              context={context}
            />
          )}
          {activeTab === "beacon-brief" && (
            <BeaconBriefTab player={player} playerName={fullName} />
          )}
        </Suspense>
      </article>
    </>
  );
}
