import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { currentNflSeason } from "@/lib/nfl-season";
import { resolveTeam } from "@/lib/beacon-brief-feed";
import { loadRelayFeed, loadRelaySidebar, loadRelayWeeks, RELAY_PAGE_SIZE } from "@/lib/relays/load";
import { feedPath, feedQuery, parseKind, parsePage, parseWeek, type FeedSearch } from "@/lib/relays/feed-params";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";
import { RelayFilters } from "@/components/relays/relay-filters";

type PageProps = {
  params: Promise<{ abbr: string }>;
  searchParams: Promise<FeedSearch>;
};

/** This route carries kind and week; the team is the route itself. */
const FILTER_KEYS = ["kind", "week"] as const;

/**
 * The route segment, bounded before it reaches resolveTeam, which memoises on
 * it. Two to four letters is every NFL code; anything else is not a team and
 * costs no read.
 */
function teamCode(raw: string): string | null {
  const code = raw.slice(0, 4).toUpperCase();
  return /^[A-Z]{2,4}$/.test(code) ? code : null;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { abbr } = await params;
  const search = await searchParams;
  const code = teamCode(abbr);
  const supabase = await createClient();
  const team = code ? await resolveTeam(supabase, code) : null;
  if (!team) return { title: "Team not found" };

  const base = `/brief/team/${team.abbreviation}`;
  const title = `${team.name} News - The Beacon Brief`;
  const description = `The latest ${team.name} fantasy football reports from The Beacon Brief.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}${feedPath(base, search, FILTER_KEYS)}` },
    // Never indexed, on this route's own terms rather than through the Brief's
    // master switch, for the reason spelled out in the category route: this
    // page lists Relays, and a Relay is noindex by design. follow stays true so
    // a crawler still walks out to the player profiles the reports link.
    robots: {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    },
    // og:url is this page, not the hub.
    ...pageShareMetadata({ key: "brief", title, description, path: base }),
  };
}

export default async function BriefTeamPage({ params, searchParams }: PageProps) {
  const { abbr } = await params;
  const search = await searchParams;
  const currentPage = parsePage(search.page);
  const kind = parseKind(search.kind);
  const week = parseWeek(search.week);
  const season = currentNflSeason();
  const code = teamCode(abbr);
  if (!code) notFound();
  const supabase = await createClient();

  const team = await resolveTeam(supabase, code);
  if (!team) notFound();

  const [sidebarData, feed, weeks] = await Promise.all([
    loadRelaySidebar(supabase),
    loadRelayFeed(supabase, { teamId: team.id, kind, week, season: week !== null ? season : null }, currentPage),
    loadRelayWeeks(supabase, season),
  ]);

  const base = `/brief/team/${team.abbreviation}`;

  return (
    <BriefFeed
      eyebrow="Team coverage"
      heading={team.name}
      description={`Every report about the ${team.name}, newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: team.name },
      ]}
      sidebarData={sidebarData}
      active={{ type: "team", value: team.abbreviation }}
      relays={feed.relays}
      total={feed.total}
      currentPage={currentPage}
      pageSize={RELAY_PAGE_SIZE}
      basePath={`${base}${feedQuery(search, FILTER_KEYS)}`}
      filters={<RelayFilters action={base} kind={kind} week={week} weeks={weeks} />}
    />
  );
}
