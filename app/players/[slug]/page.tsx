import type { Metadata } from "next";
import { Suspense } from "react";
import { serializeJsonLd } from "@/lib/json-ld";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import {
  loadPlayerAndContext,
  loadTeamRow,
  recentFinishesForScoring,
  depthRoleForPlayer,
  SCORING_KEYS,
} from "@/lib/player-profile";
import { loadPositionalFinishesCached } from "@/lib/player-profile-cache";
import { PlayerHero } from "@/components/player-profile/player-hero";
import { PlayerTabs, type PlayerTabId } from "@/components/player-profile/player-tabs";
import { OverviewTab } from "@/components/player-profile/overview-tab";
import { StatsTab } from "@/components/player-profile/stats-tab";
import { TradesTab } from "@/components/player-profile/trades-tab";
import { BeaconBriefTab } from "@/components/player-profile/beacon-brief-tab";
import { TabLoading } from "@/components/player-profile/tab-loading";

export const dynamic = "force-dynamic";

const VALID_TABS: PlayerTabId[] = ["overview", "statistics", "trades", "beacon-brief"];

type PlayerPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ format?: string; source?: string; tab?: string }>;
};

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: player } = await supabase
    .from("players")
    .select("first_name, last_name, full_name, position, team")
    .eq("slug", slug)
    .maybeSingle();
  if (!player) {
    return { title: "Player not found" };
  }
  const name = player.full_name ?? `${player.first_name} ${player.last_name}`;
  const posTeam = `${player.position}${player.team ? `, ${player.team}` : ""}`;
  const canonical = `${SITE.url}/players/${slug}`;
  const title = `${name} fantasy outlook, stats & rankings`;
  const description = `${name} (${posTeam}) fantasy football profile: dynasty and redraft rankings, market value trends, career and weekly stats, trades, and the latest news.`;
  const ogImage = `${SITE.url}/api/og/player/${slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE.name,
      type: "profile",
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${name} fantasy profile card` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const { slug } = await params;
  const { format, source, tab } = await searchParams;
  const supabase = await createClient();

  const loaded = await loadPlayerAndContext(supabase, slug, {
    formatParam: format,
    sourceParam: source,
  });
  if (!loaded) {
    notFound();
  }
  const { player, sleeperId, context } = loaded;

  const activeTab: PlayerTabId = VALID_TABS.includes((tab ?? "") as PlayerTabId)
    ? (tab as PlayerTabId)
    : "overview";

  // Team colors/chant + positional finishes load once here; the last-3 slice is
  // shared by the hero and the overview sidebar so the RPC runs a single time.
  const [team, allFinishes] = await Promise.all([
    loadTeamRow(supabase, player.team),
    loadPositionalFinishesCached(player.id),
  ]);
  const last3 = recentFinishesForScoring(allFinishes, context.scoringKey, 3);
  const scoringLabel = SCORING_KEYS.find((s) => s.key === context.scoringKey)?.label ?? "PPR";
  const depthRole = depthRoleForPlayer(player);

  const fullName =
    player.full_name ?? `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const canonical = `${SITE.url}/players/${slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: fullName,
      url: canonical,
      jobTitle: `${player.position}${player.team ? `, ${player.team}` : ""} (NFL)`,
      ...(player.team ? { memberOf: { "@type": "SportsTeam", name: player.team } } : {}),
      ...(player.college ? { alumniOf: { "@type": "CollegeOrUniversity", name: player.college } } : {}),
      ...(player.birth_date ? { birthDate: player.birth_date } : {}),
      ...(player.height_inches
        ? { height: { "@type": "QuantitativeValue", value: player.height_inches, unitCode: "INH" } }
        : {}),
      ...(player.weight_lbs
        ? { weight: { "@type": "QuantitativeValue", value: player.weight_lbs, unitCode: "LBR" } }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        {
          "@type": "ListItem",
          position: 2,
          name: player.position,
          item: `${SITE.url}/rankings?position=${player.position}`,
        },
        { "@type": "ListItem", position: 3, name: fullName, item: canonical },
      ],
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article>
        <PlayerHero
          player={player}
          sleeperId={sleeperId}
          scoringLabel={scoringLabel}
          finishes={last3}
          team={team}
          role={depthRole}
        />

        {context.fallbackBanner && (
          <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
            <p
              role="status"
              className="rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
            >
              <span className="font-medium text-ink">Heads up:</span> No{" "}
              {context.fallbackBanner.requested} data available for{" "}
              {context.fallbackBanner.formatDisplay}. Showing {context.fallbackBanner.actual} values
              instead.
            </p>
          </div>
        )}

        <PlayerTabs slug={player.slug} activeTab={activeTab} source={source} format={format} />

        {/* Stream each tab behind a skeleton so the hero + tab bar paint
            immediately instead of blocking on the active tab's data. */}
        <Suspense key={activeTab} fallback={<TabLoading />}>
          {activeTab === "overview" && (
            <OverviewTab
              player={player}
              sleeperId={sleeperId}
              context={context}
              finishesLast3={last3}
            />
          )}
          {activeTab === "statistics" && (
            <StatsTab
              player={player}
              scoringKey={context.scoringKey}
              scoringLabel={scoringLabel}
              tePremiumBonus={player.position === "TE" ? context.tePremiumBonus : 0}
            />
          )}
          {activeTab === "trades" && (
            <TradesTab player={player} sleeperId={sleeperId} context={context} />
          )}
          {activeTab === "beacon-brief" && <BeaconBriefTab player={player} playerName={fullName} />}
        </Suspense>
      </article>
    </main>
  );
}
