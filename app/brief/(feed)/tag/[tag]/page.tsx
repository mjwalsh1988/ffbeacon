import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { currentNflSeason } from "@/lib/nfl-season";
import { loadRelayFeed, loadRelaySidebar, loadRelayWeeks, RELAY_PAGE_SIZE } from "@/lib/relays/load";
import { feedPath, feedQuery, parseKind, parsePage, parseWeek, type FeedSearch } from "@/lib/relays/feed-params";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";
import { RelayFilters } from "@/components/relays/relay-filters";

type PageProps = {
  params: Promise<{ tag: string }>;
  searchParams: Promise<FeedSearch>;
};

/** This route carries kind and week; the tag is the route itself. */
const FILTER_KEYS = ["kind", "week"] as const;

/** URL-decode the tag segment. Tags are stored as free text (mixed case, spaces)
 * and encoded with encodeURIComponent when linked, so decode to match. */
function decodeTag(raw: string): string {
  try {
    return decodeURIComponent(raw).slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { tag: rawTag } = await params;
  const search = await searchParams;
  const tag = decodeTag(rawTag);
  const base = `/brief/tag/${encodeURIComponent(tag)}`;
  const title = `${tag} - The Beacon Brief`;
  const description = `Reports tagged "${tag}" from The Beacon Brief.`;
  // A tag is a free-text filter over reports that are themselves noindex, so
  // it is never advertised to search. follow stays true so a crawler that
  // lands here still walks out to the player profiles.
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}${feedPath(base, search, FILTER_KEYS)}` },
    robots: {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    },
    // og:url is this page, not the hub.
    ...pageShareMetadata({ key: "brief", title, description, path: base }),
  };
}

export default async function BriefTagPage({ params, searchParams }: PageProps) {
  const { tag: rawTag } = await params;
  const search = await searchParams;
  const tag = decodeTag(rawTag);
  const currentPage = parsePage(search.page);
  const kind = parseKind(search.kind);
  const week = parseWeek(search.week);
  const season = currentNflSeason();
  const supabase = await createClient();

  const [sidebarData, feed, weeks] = await Promise.all([
    loadRelaySidebar(supabase),
    loadRelayFeed(supabase, { tag, kind, week, season: week !== null ? season : null }, currentPage),
    loadRelayWeeks(supabase, season),
  ]);

  const base = `/brief/tag/${encodeURIComponent(tag)}`;

  return (
    <BriefFeed
      eyebrow="Tag"
      heading={tag}
      description={`Every report tagged "${tag}", newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: tag },
      ]}
      sidebarData={sidebarData}
      active={{ type: "tag", value: tag }}
      relays={feed.relays}
      total={feed.total}
      currentPage={currentPage}
      pageSize={RELAY_PAGE_SIZE}
      basePath={`${base}${feedQuery(search, FILTER_KEYS)}`}
      filters={<RelayFilters action={base} kind={kind} week={week} weeks={weeks} />}
    />
  );
}
