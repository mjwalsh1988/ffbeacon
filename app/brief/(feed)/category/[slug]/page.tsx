import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { currentNflSeason } from "@/lib/nfl-season";
import { resolveCategory } from "@/lib/beacon-brief-feed";
import { loadRelayFeed, loadRelaySidebar, loadRelayWeeks, RELAY_PAGE_SIZE } from "@/lib/relays/load";
import { feedPath, feedQuery, parseKind, parsePage, parseWeek, type FeedSearch } from "@/lib/relays/feed-params";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";
import { RelayFilters } from "@/components/relays/relay-filters";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<FeedSearch>;
};

/** This route carries kind and week; the category is the route itself. */
const FILTER_KEYS = ["kind", "week"] as const;

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const search = await searchParams;
  const supabase = await createClient();
  const category = await resolveCategory(supabase, slug);
  if (!category) return { title: "Category not found" };

  const base = `/brief/category/${slug}`;
  const title = `${category.name} News - The Beacon Brief`;
  const description =
    category.description ??
    `The latest ${category.name.toLowerCase()} reports for fantasy football from The Beacon Brief.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}${feedPath(base, search, FILTER_KEYS)}` },
    // Never indexed, on this route's own terms rather than through the Brief's
    // master switch. This page lists Relays, every one of which is noindex by
    // design, so there is nothing here for an index entry to lead to; the
    // switch governs legacy articles, which this route has not rendered since
    // BD-T018. The tag and player archives say the same thing the same way.
    // follow stays true so a crawler still walks out to the player profiles
    // the reports link.
    robots: {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    },
    // og:url is this page, not the hub. Sharing /brief/category/injuries used
    // to produce a card pointing at /brief.
    ...pageShareMetadata({ key: "brief", title, description, path: base }),
  };
}

export default async function BriefCategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const search = await searchParams;
  const currentPage = parsePage(search.page);
  const kind = parseKind(search.kind);
  const week = parseWeek(search.week);
  const season = currentNflSeason();
  const supabase = await createClient();

  const category = await resolveCategory(supabase, slug);
  if (!category) notFound();

  const [sidebarData, feed, weeks] = await Promise.all([
    loadRelaySidebar(supabase),
    loadRelayFeed(supabase, { categoryId: category.id, kind, week, season: week !== null ? season : null }, currentPage),
    loadRelayWeeks(supabase, season),
  ]);

  const base = `/brief/category/${slug}`;

  return (
    <BriefFeed
      eyebrow="Category"
      heading={category.name}
      description={
        category.description ??
        `The latest ${category.name.toLowerCase()} reports from The Beacon Brief.`
      }
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: category.name },
      ]}
      sidebarData={sidebarData}
      active={{ type: "category", value: slug }}
      relays={feed.relays}
      total={feed.total}
      currentPage={currentPage}
      pageSize={RELAY_PAGE_SIZE}
      basePath={`${base}${feedQuery(search, FILTER_KEYS)}`}
      filters={<RelayFilters action={base} kind={kind} week={week} weeks={weeks} />}
    />
  );
}
