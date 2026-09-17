import type { Metadata } from "next";
import { cache } from "react";
import { pageShareMetadata } from "@/lib/page-og";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { currentNflSeason } from "@/lib/nfl-season";
import { resolvePlayer } from "@/lib/beacon-brief-feed";
import { loadRelayFeed, loadRelaySidebar, loadRelayWeeks, RELAY_PAGE_SIZE } from "@/lib/relays/load";
import { feedPath, feedQuery, parseKind, parsePage, parseWeek, type FeedSearch } from "@/lib/relays/feed-params";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";
import { RelayFilters } from "@/components/relays/relay-filters";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<FeedSearch>;
};

/** This route carries kind and week; the player is the route itself. */
const FILTER_KEYS = ["kind", "week"] as const;

/**
 * generateMetadata and the page are two calls for one request, and
 * resolvePlayer is not memoised the way the category and team lookups are,
 * so without this the player was read twice per view. Keyed on the slug and
 * the client built inside, so both callers share the entry.
 */
const getPlayer = cache(async (slug: string) => resolvePlayer(await createClient(), slug.slice(0, 80)));

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const search = await searchParams;
  const player = await getPlayer(slug);
  if (!player) return { title: "Player not found" };

  const base = `/brief/player/${slug}`;
  const title = `${player.name} News - The Beacon Brief`;
  const description = `Every report about ${player.name} from The Beacon Brief, newest first.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}${feedPath(base, search, FILTER_KEYS)}` },
    // The player profile (/players/[slug]) is the canonical home for this
    // player's coverage. follow stays true so a crawler that lands here still
    // walks out to it.
    robots: {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    },
    // og:url is this page, not the hub.
    ...pageShareMetadata({ key: "brief", title, description, path: base }),
  };
}

export default async function BriefPlayerPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const search = await searchParams;
  const currentPage = parsePage(search.page);
  const kind = parseKind(search.kind);
  const week = parseWeek(search.week);
  const season = currentNflSeason();
  const supabase = await createClient();

  const player = await getPlayer(slug);
  if (!player) notFound();

  const [sidebarData, feed, weeks] = await Promise.all([
    loadRelaySidebar(supabase),
    loadRelayFeed(supabase, { playerId: player.id, kind, week, season: week !== null ? season : null }, currentPage),
    loadRelayWeeks(supabase, season),
  ]);

  const posTeam = [player.position, player.team].filter(Boolean).join(", ");
  const base = `/brief/player/${slug}`;

  return (
    <BriefFeed
      eyebrow="Player coverage"
      heading={player.name}
      description={`Every report that mentions ${player.name}${posTeam ? ` (${posTeam})` : ""}, newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: player.name },
      ]}
      sidebarData={sidebarData}
      active={{ type: "player", value: slug }}
      relays={feed.relays}
      total={feed.total}
      currentPage={currentPage}
      pageSize={RELAY_PAGE_SIZE}
      basePath={`${base}${feedQuery(search, FILTER_KEYS)}`}
      filters={<RelayFilters action={base} kind={kind} week={week} weeks={weeks} />}
    />
  );
}
