import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { pageShareMetadata } from "@/lib/page-og";
import { SITE } from "@/lib/site";
import { currentNflSeason } from "@/lib/nfl-season";
import { formatEasternDate } from "@/lib/datetime";
import { resolvePlayer, resolveTeam } from "@/lib/beacon-brief-feed";
import {
  loadLatestBrief,
  loadRelayFeed,
  loadRelaySidebar,
  loadRelayWeekCounts,
  loadRelaysBetween,
  RELAY_PAGE_SIZE,
  type RelayFeedFilter,
} from "@/lib/relays/load";
import {
  feedPath,
  feedQuery,
  parseDate,
  parseKind,
  parseMonth,
  parsePage,
  parsePlayerSlug,
  parseTeamCode,
  parseView,
  parseWeek,
  type FeedSearch,
} from "@/lib/relays/feed-params";
import { dayRange, easternDateKey, monthLabel, monthRange, parseDateKey } from "@/lib/relays/calendar";
import { easternParts } from "@/lib/relays/eastern-time";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";
import { BriefPagination } from "@/components/beacon-brief/brief-pagination";
import { RelayCalendar } from "@/components/relays/relay-calendar";
import { RelayFilters } from "@/components/relays/relay-filters";
import { RelayGrid } from "@/components/relays/relay-grid";
import { ViewSwitcher } from "@/components/relays/view-switcher";
import { WeekRail } from "@/components/relays/week-rail";

// Absolute, so the root layout does not append the site name a second time
// and push the rendered title past what a search result shows.
const TITLE = "The Beacon Brief: Fantasy Football News | FF Beacon";
const DESCRIPTION =
  "Injuries, trades, signings and depth chart moves as structured reports, newest first, and one Brief each week that checks every one against the numbers.";

type PageProps = { searchParams: Promise<FeedSearch> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const search = await searchParams;
  const currentPage = parsePage(search.page);
  const query = feedQuery(search);
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: {
      canonical: `${SITE.url}${feedPath("/brief", search)}`,
      types: {
        "application/rss+xml": [
          { url: "/brief/rss.xml", title: "The Beacon Brief" },
          { url: "/brief/relays.xml", title: "The Beacon Brief: every report" },
        ],
      },
    },
    // Only the first unfiltered page of the default view is indexable. A
    // filtered view, another view of the same reports, or page 2 onward would
    // be a near-duplicate page carrying no prose of its own, and every card's
    // destination is noindex. With 660 Relays that was 21 thin listing URLs
    // asking to be indexed. follow stays true on both, so the whole archive
    // remains crawlable, which is what the pagination was built for.
    //
    // Spread in, never set to undefined: Next merges metadata key by key and a
    // present-but-undefined `robots` replaces the root layout's
    // max-image-preview and max-snippet permissions with no robots tag at all
    // (app/layout.tsx names the trap). The indexable hub keeps the layout's.
    ...(query || currentPage > 1 ? { robots: { index: false, follow: true } } : {}),
    ...pageShareMetadata({ key: "brief", title: TITLE, description: DESCRIPTION, path: "/brief" }),
  };
}

export default async function BriefIndexPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const currentPage = parsePage(search.page);
  const supabase = await createClient();
  const season = currentNflSeason();
  const view = parseView(search.view);

  const kind = parseKind(search.kind);
  const weekParam = parseWeek(search.week);
  const teamCode = parseTeamCode(search.team);
  const playerSlug = parsePlayerSlug(search.player);
  const date = parseDate(search.date);
  const [team, player] = await Promise.all([
    teamCode ? resolveTeam(supabase, teamCode) : Promise.resolve(null),
    playerSlug ? resolvePlayer(supabase, playerSlug) : Promise.resolve(null),
  ]);

  // A team or player in the address that resolves to nothing is an empty
  // view, not the whole feed. Rendering every report under "?team=PHIL" looks
  // like a working filter and is not one.
  const unrecognised = (teamCode !== null && !team) || (playerSlug !== null && !player);

  // The week view needs the season's weeks before it can pick one; the
  // filter form needs them on every view.
  const weekCounts = await loadRelayWeekCounts(supabase, season);
  const weeks = weekCounts.map((w) => w.week);
  // In the week view an unchosen week means the newest week with reports.
  const week = view === "week" && weekParam === null ? (weekCounts[0]?.week ?? null) : weekParam;

  const day = date ? parseDateKey(date) : null;
  const dayWindow = day ? dayRange(day.year, day.month, day.day) : null;

  const filter: RelayFeedFilter = {
    kind,
    week,
    season: week !== null ? season : null,
    teamId: team?.id ?? null,
    playerId: player?.id ?? null,
    postedFrom: dayWindow?.start ?? null,
    postedTo: dayWindow?.end ?? null,
  };

  // The calendar reads a month of light rows instead of a page of cards.
  const now = new Date();
  const todayParts = easternParts(now);
  const monthSel = parseMonth(search.month) ?? { year: todayParts.year, month: todayParts.month };
  const monthWindow = monthRange(monthSel.year, monthSel.month);

  const isBareHub = currentPage === 1 && view === "grid" && !kind && week === null && !teamCode && !playerSlug && !date;

  const [sidebarData, feed, latestBrief, monthItems] = await Promise.all([
    loadRelaySidebar(supabase),
    unrecognised || view === "calendar" ? Promise.resolve({ relays: [], total: 0 }) : loadRelayFeed(supabase, filter, currentPage),
    isBareHub ? loadLatestBrief(supabase) : Promise.resolve(null),
    view === "calendar" && !unrecognised ? loadRelaysBetween(supabase, monthWindow.start, monthWindow.end) : Promise.resolve([]),
  ]);

  // The address the pagination and the week rail build on carries the week
  // the view settled on, so page 2 of the newest week is still that week.
  const settled: FeedSearch = { ...search, week: week === null ? undefined : String(week) };
  const query = feedQuery(settled);
  const carry: Record<string, string> = {};
  if (team) carry.team = team.abbreviation;
  if (player) carry.player = player.slug;
  if (view !== "grid") carry.view = view;
  if (date) carry.date = date;

  const scope = [
    team ? `about the ${team.name}` : null,
    player ? `about ${player.name}` : null,
    date ? `from ${formatEasternDate(dayWindow!.start)}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const description = scope
    ? `Every report ${scope}, newest first. Filter by kind or week, or clear the filters to see everything.`
    : view === "calendar"
      ? `Every report in ${monthLabel(monthSel.year, monthSel.month)}, by the day it was posted. Open a day for every report from it, or a headline for the full report.`
      : view === "week"
        ? "The season one NFL week at a time: pick a week and every report from it is here, newest first."
        : "Every injury, trade, signing and role change the desk accepted, as a structured report with the original source credited. Once a week the Brief gathers the period's reports, checks each against the numbers, and says what to do.";

  const total = view === "calendar" ? monthItems.length : feed.total;
  const totalPages = Math.max(1, Math.ceil(feed.total / RELAY_PAGE_SIZE));

  let content: React.ReactNode | undefined;
  if (view === "calendar" && !unrecognised) {
    content = (
      <RelayCalendar
        year={monthSel.year}
        month={monthSel.month}
        items={monthItems}
        todayKey={easternDateKey(now)}
      />
    );
  } else if (view === "week" && !unrecognised && weekCounts.length > 0) {
    content = (
      <>
        <WeekRail weeks={weekCounts} selected={week} search={search} />
        {feed.relays.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-base/40 px-6 py-10 text-center text-sm text-ink-muted">
            No reports match these filters in week {week}.
          </p>
        ) : (
          <>
            <RelayGrid relays={feed.relays} />
            <BriefPagination basePath={`/brief${query}`} currentPage={currentPage} totalPages={totalPages} />
          </>
        )}
      </>
    );
  }

  return (
    <BriefFeed
      eyebrow="The Beacon Brief"
      heading="What changed, and the weekly Brief that checks it."
      description={description}
      breadcrumb={[{ label: "The Beacon Brief", href: "/brief" }]}
      sidebarData={sidebarData}
      active={{ type: "all" }}
      relays={feed.relays}
      total={total}
      currentPage={currentPage}
      pageSize={RELAY_PAGE_SIZE}
      basePath={`/brief${query}`}
      latestBrief={latestBrief}
      layout={view === "feed" ? "list" : "grid"}
      paginated={view !== "calendar"}
      viewSwitcher={<ViewSwitcher current={view} search={settled} />}
      content={content}
      emptyMessage={
        unrecognised
          ? "The team or player in the address was not recognised. Clear the filters to see every report."
          : undefined
      }
      filters={
        view === "calendar" ? null : (
          <RelayFilters action="/brief" kind={kind} week={week} weeks={weeks} carry={carry} />
        )
      }
    />
  );
}
