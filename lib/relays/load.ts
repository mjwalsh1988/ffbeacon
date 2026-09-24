/**
 * Public read layer for Relays: the /brief hub feed, the permalink, the chain
 * of earlier and later Relays for one story, the player profile panel and the
 * homepage block.
 *
 * Every query here runs through the anon or the cookie-free read client, so
 * RLS is the security boundary: `relays` is limited to status = 'published'
 * and the join tables to rows whose parent is published. Nothing here uses the
 * service-role client. The one exception, the permalink's 410 for a retracted
 * Relay, is answered by loadRelayStatusBySlug with an admin client the page
 * passes in, and it reads two columns.
 */

import type { createCachedReadClient, createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { BriefSidebarData, SidebarCategory } from "@/lib/beacon-brief-feed";
import {
  isRelayKind,
  parseRelayFacts,
  type RelayAvailability,
  type RelayFact,
  type RelayKind,
  type RelayStatus,
} from "./types";

type ReaderClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createCachedReadClient>;

/** Cards per page on the hub. */
export const RELAY_PAGE_SIZE = 30;

/** How many recent Relays the sidebar scans for its tag, player and team lists. */
const SIDEBAR_SCAN_LIMIT = 200;

/** Most ids one `.in()` filter carries; PostgREST puts them all in the URL. */
const ID_BATCH = 300;

export type RelayCardPlayer = {
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
  isPrimary: boolean;
};

export type RelayCardTeam = { abbreviation: string; name: string };

export type RelayCardData = {
  id: string;
  slug: string;
  kind: RelayKind;
  headline: string;
  facts: RelayFact[];
  timeline: string | null;
  availability: RelayAvailability | null;
  season: string;
  week: number | null;
  sourceHandle: string;
  /** Null when the stored value is not an https URL; the card then omits the link. */
  sourceUrl: string | null;
  sourcePostedAt: string;
  followsRelayId: string | null;
  /** The earlier Relay's slug, when it is published. */
  followsSlug: string | null;
  /** The Brief that covered it, once one is published. */
  brief: { slug: string; title: string } | null;
  category: { slug: string; name: string } | null;
  tags: string[];
  players: RelayCardPlayer[];
  teams: RelayCardTeam[];
};

export type RelayFeedFilter = {
  kind?: RelayKind | null;
  season?: string | null;
  week?: number | null;
  categoryId?: string | null;
  tag?: string | null;
  playerId?: string | null;
  teamId?: string | null;
  /** Half-open instant range on the post's own timestamp, for the day view. */
  postedFrom?: string | null;
  postedTo?: string | null;
};

type RelayRowLite = {
  id: string;
  slug: string;
  kind: string;
  headline: string;
  facts: unknown;
  timeline: string | null;
  availability: string | null;
  season: string;
  week: number | null;
  source_handle: string;
  source_url: string;
  source_posted_at: string;
  follows_relay_id: string | null;
  brief_id: string | null;
  category_id: string | null;
  tags: string[] | null;
};

const RELAY_SELECT =
  "id, slug, kind, headline, facts, timeline, availability, season, week, source_handle, source_url, source_posted_at, follows_relay_id, brief_id, category_id, tags";

/**
 * The source link, or null when it is not an https URL.
 *
 * `relays.source_url` has no scheme constraint in the schema and it is the one
 * value in this feature that becomes an href on a public page. Today it is
 * always an https x.com link, so this is the guard standing where the schema
 * does not: a `javascript:` or `data:` value from any future ingestion source
 * would otherwise be a clickable script link on the hub and on every permalink.
 */
function httpsOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Attach players, teams, category, the earlier Relay's slug and the covering
 * Brief to a page of rows. Four batched reads, never one per card.
 */
async function hydrate(supabase: ReaderClient, rows: RelayRowLite[]): Promise<RelayCardData[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const categoryIds = [...new Set(rows.map((r) => r.category_id).filter((v): v is string => Boolean(v)))];
  const followIds = [...new Set(rows.map((r) => r.follows_relay_id).filter((v): v is string => Boolean(v)))];
  const briefIds = [...new Set(rows.map((r) => r.brief_id).filter((v): v is string => Boolean(v)))];

  const playerLinks: Array<{ relay_id: string; is_primary: boolean; players: unknown }> = [];
  const teamLinks: Array<{ relay_id: string; nfl_teams: unknown }> = [];
  for (const batch of chunk(ids, ID_BATCH)) {
    const [{ data: rp }, { data: rt }] = await Promise.all([
      supabase
        .from("relay_players")
        .select("relay_id, is_primary, players(slug, full_name, first_name, last_name, position, team)")
        .in("relay_id", batch),
      supabase.from("relay_teams").select("relay_id, nfl_teams(abbreviation, name)").in("relay_id", batch),
    ]);
    playerLinks.push(...((rp ?? []) as typeof playerLinks));
    teamLinks.push(...((rt ?? []) as typeof teamLinks));
  }

  const [{ data: categories }, { data: follows }, { data: briefs }] = await Promise.all([
    categoryIds.length
      ? supabase.from("news_categories").select("id, slug, name").in("id", categoryIds)
      : Promise.resolve({ data: [] as { id: string; slug: string; name: string }[] }),
    followIds.length
      ? supabase.from("relays").select("id, slug").in("id", followIds)
      : Promise.resolve({ data: [] as { id: string; slug: string }[] }),
    briefIds.length
      ? supabase.from("articles").select("id, slug, title").in("id", briefIds).eq("status", "published")
      : Promise.resolve({ data: [] as { id: string; slug: string; title: string }[] }),
  ]);

  const playersByRelay = new Map<string, RelayCardPlayer[]>();
  for (const link of playerLinks) {
    const p = (Array.isArray(link.players) ? link.players[0] : link.players) as {
      slug: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      position: string | null;
      team: string | null;
    } | null;
    if (!p?.slug) continue;
    const list = playersByRelay.get(link.relay_id) ?? [];
    list.push({
      slug: p.slug,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team,
      isPrimary: link.is_primary,
    });
    playersByRelay.set(link.relay_id, list);
  }
  const teamsByRelay = new Map<string, RelayCardTeam[]>();
  for (const link of teamLinks) {
    const t = (Array.isArray(link.nfl_teams) ? link.nfl_teams[0] : link.nfl_teams) as {
      abbreviation: string;
      name: string;
    } | null;
    if (!t?.abbreviation) continue;
    const list = teamsByRelay.get(link.relay_id) ?? [];
    list.push({ abbreviation: t.abbreviation, name: t.name });
    teamsByRelay.set(link.relay_id, list);
  }
  const categoryById = new Map((categories ?? []).map((c) => [c.id, { slug: c.slug, name: c.name }]));
  const followSlugById = new Map((follows ?? []).map((f) => [f.id, f.slug]));
  const briefById = new Map((briefs ?? []).map((b) => [b.id, { slug: b.slug, title: b.title }]));

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    kind: isRelayKind(r.kind) ? r.kind : "other",
    headline: r.headline,
    facts: parseRelayFacts(r.facts),
    timeline: r.timeline,
    availability: (r.availability as RelayAvailability | null) ?? null,
    season: r.season,
    week: r.week,
    sourceHandle: r.source_handle,
    sourceUrl: httpsOrNull(r.source_url),
    sourcePostedAt: r.source_posted_at,
    followsRelayId: r.follows_relay_id,
    followsSlug: r.follows_relay_id ? (followSlugById.get(r.follows_relay_id) ?? null) : null,
    brief: r.brief_id ? (briefById.get(r.brief_id) ?? null) : null,
    category: r.category_id ? (categoryById.get(r.category_id) ?? null) : null,
    tags: r.tags ?? [],
    players: (playersByRelay.get(r.id) ?? []).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name)),
    teams: (teamsByRelay.get(r.id) ?? []).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation)),
  }));
}

/**
 * The player and team filters are DRIVEN FROM THE JOIN TABLE, with the Relay
 * embedded, never from `relays` with the join table embedded as a filter.
 *
 * Two earlier shapes were wrong. Reading the matching ids first and passing
 * them to `.in("id", ...)` put up to a thousand uuids in the query string,
 * which PostgREST behind Kong refuses past roughly 8 KB, and it did so
 * silently. Filtering `relays` on an embedded `relay_players!inner` looked
 * right and kept the count on the server, but PostgREST implements a filter
 * on an embedded to-many resource as a LATERAL subquery with `relays` as the
 * driving table: every published Relay is walked and probed, so the cost
 * grows with the whole table rather than with the player (measured with
 * EXPLAIN on the live project: 1,942 buffers and 26 ms for a 17-Relay player
 * against 113 buffers and 3.5 ms driven from the join table, and the gap
 * widens with every Relay written).
 *
 * Driven from `relay_players` (or `relay_teams`) the planner starts at the
 * (player_id) index, the embedded `relays!inner(...)` is a to-one join on
 * the primary key, the page and the exact count are still computed on the
 * server, and ordering the parent by the embedded column
 * (`order=relays(source_posted_at).desc`) is supported for a to-one embed.
 * Each join row is unique per (relay, player), so the count is a count of
 * Relays. The other filters are applied to the embedded Relay through the
 * dotted path, which with `!inner` restricts the parent rows too.
 */
const PLAYER_JOIN = "relay_players!inner(player_id)";
const TEAM_JOIN = "relay_teams!inner(team_id)";

type JoinDriver = "relay_players" | "relay_teams";

/**
 * The feed read when a player or team filter is set: the join table drives,
 * the Relay is embedded, and both the page and the exact count come back.
 * When BOTH are set the player table drives and the team filter rides on the
 * embedded Relay through a second inner join.
 */
async function loadFeedThroughJoin(
  supabase: ReaderClient,
  filter: RelayFeedFilter,
  range: { from: number; to: number } | null,
  limit: number | null,
): Promise<{ rows: RelayRowLite[]; total: number; error: { message: string } | null }> {
  const driver: JoinDriver = filter.playerId ? "relay_players" : "relay_teams";
  const nested = filter.playerId && filter.teamId ? `, ${TEAM_JOIN}` : "";
  // The select string is built at runtime, which the typed client cannot
  // follow, so the driving column is named through the same loose type the
  // dotted embedded filters below already use.
  const driverColumn = driver === "relay_players" ? "player_id" : "team_id";
  const driverValue = driver === "relay_players" ? filter.playerId! : filter.teamId!;
  let query = supabase
    .from(driver)
    .select(`relays!inner(${RELAY_SELECT}${nested})`, { count: "exact" })
    .eq("relays.status", "published")
    .eq(driverColumn as "relay_id", driverValue);
  if (filter.playerId && filter.teamId) query = query.eq("relays.relay_teams.team_id", filter.teamId);
  if (filter.kind) query = query.eq("relays.kind", filter.kind);
  if (filter.season) query = query.eq("relays.season", filter.season);
  if (typeof filter.week === "number") query = query.eq("relays.week", filter.week);
  if (filter.categoryId) query = query.eq("relays.category_id", filter.categoryId);
  if (filter.tag) query = query.contains("relays.tags", [filter.tag]);
  if (filter.postedFrom) query = query.gte("relays.source_posted_at", filter.postedFrom);
  if (filter.postedTo) query = query.lt("relays.source_posted_at", filter.postedTo);
  query = query.order("relays(source_posted_at)", { ascending: false });
  if (range) query = query.range(range.from, range.to);
  if (limit !== null) query = query.limit(limit);
  const { data, count, error } = await query;
  const rows = ((data ?? []) as unknown as Array<{ relays: RelayRowLite | RelayRowLite[] | null }>)
    .map((r) => (Array.isArray(r.relays) ? r.relays[0] : r.relays))
    .filter((r): r is RelayRowLite => Boolean(r));
  return { rows, total: count ?? 0, error };
}

/**
 * One page of the feed, newest first by the post's own timestamp, with the
 * total for pagination. RLS keeps it to published rows.
 */
export async function loadRelayFeed(
  supabase: ReaderClient,
  filter: RelayFeedFilter,
  page: number,
  pageSize: number = RELAY_PAGE_SIZE,
): Promise<{ relays: RelayCardData[]; total: number }> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  if (filter.playerId || filter.teamId) {
    const { rows, total, error } = await loadFeedThroughJoin(supabase, filter, { from, to }, null);
    if (error) {
      console.error("[relays] loadRelayFeed (join) failed", error);
      return { relays: [], total: 0 };
    }
    return { relays: await hydrate(supabase, rows), total };
  }

  let query = supabase.from("relays").select(RELAY_SELECT, { count: "exact" }).eq("status", "published");
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.season) query = query.eq("season", filter.season);
  if (typeof filter.week === "number") query = query.eq("week", filter.week);
  if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
  if (filter.tag) query = query.contains("tags", [filter.tag]);
  if (filter.postedFrom) query = query.gte("source_posted_at", filter.postedFrom);
  if (filter.postedTo) query = query.lt("source_posted_at", filter.postedTo);

  const { data, count, error } = await query
    .order("source_posted_at", { ascending: false })
    .range(from, to);
  if (error) {
    console.error("[relays] loadRelayFeed failed", error);
    return { relays: [], total: 0 };
  }
  return {
    relays: await hydrate(supabase, (data ?? []) as unknown as RelayRowLite[]),
    total: count ?? 0,
  };
}

/** One published Relay by slug, hydrated. Null when unpublished or unknown. */
export async function loadRelayBySlug(supabase: ReaderClient, slug: string): Promise<RelayCardData | null> {
  const { data } = await supabase.from("relays").select(RELAY_SELECT).eq("slug", slug).eq("status", "published").maybeSingle();
  if (!data) return null;
  const [card] = await hydrate(supabase, [data as RelayRowLite]);
  return card ?? null;
}

/**
 * The status behind a slug, for the permalink's 410. Takes the admin client
 * because a retracted row is invisible to the public policy, and that is the
 * one case a public page has to tell apart from "never existed".
 */
export async function loadRelayStatusBySlug(
  admin: SupabaseClient<Database>,
  slug: string,
): Promise<RelayStatus | null> {
  const { data } = await admin.from("relays").select("status").eq("slug", slug).maybeSingle();
  return (data?.status as RelayStatus | undefined) ?? null;
}

/**
 * The earlier Relays this one updates (walking follows_relay_id back) and the
 * later ones that update it. Bounded so a runaway chain cannot loop.
 */
export async function loadRelayChain(
  supabase: ReaderClient,
  relay: RelayCardData,
): Promise<{ earlier: RelayCardData[]; later: RelayCardData[] }> {
  const earlierRows: RelayRowLite[] = [];
  let cursor = relay.followsRelayId;
  const seen = new Set<string>([relay.id]);
  while (cursor && !seen.has(cursor) && earlierRows.length < 8) {
    seen.add(cursor);
    const { data } = await supabase.from("relays").select(RELAY_SELECT).eq("id", cursor).eq("status", "published").maybeSingle();
    if (!data) break;
    earlierRows.push(data as RelayRowLite);
    cursor = (data as RelayRowLite).follows_relay_id;
  }
  const { data: laterData } = await supabase
    .from("relays")
    .select(RELAY_SELECT)
    .eq("follows_relay_id", relay.id)
    .eq("status", "published")
    .order("source_posted_at", { ascending: true })
    .limit(8);
  const [earlier, later] = await Promise.all([
    hydrate(supabase, earlierRows.reverse()),
    hydrate(supabase, (laterData ?? []) as RelayRowLite[]),
  ]);
  return { earlier, later };
}

/** The newest published Relays that mention a player, for the profile panel. */
export async function loadRelaysForPlayer(
  supabase: ReaderClient,
  playerId: string,
  limit = 5,
): Promise<RelayCardData[]> {
  // Driven from relay_players (see loadFeedThroughJoin), so the read starts
  // at the player's index and five rows come back.
  const { rows, error } = await loadFeedThroughJoin(supabase, { playerId }, null, limit);
  if (error) {
    console.error("[relays] loadRelaysForPlayer failed", error);
    return [];
  }
  return hydrate(supabase, rows);
}

/**
 * Published Relays by id, hydrated, for the Brief edition page: the ones a
 * section cites and the ones a relay_quote block places inline. A retracted
 * or hidden id is simply absent from the result, and the page says so where
 * it matters rather than rendering a hole.
 */
export async function loadRelaysByIds(supabase: ReaderClient, ids: string[]): Promise<RelayCardData[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows: RelayRowLite[] = [];
  for (const batch of chunk(unique, ID_BATCH)) {
    const { data } = await supabase.from("relays").select(RELAY_SELECT).in("id", batch).eq("status", "published");
    rows.push(...((data ?? []) as RelayRowLite[]));
  }
  return hydrate(supabase, rows);
}

/** The newest published Relays site-wide, for the homepage block. */
export async function loadRecentRelays(supabase: ReaderClient, limit = 4): Promise<RelayCardData[]> {
  const { data } = await supabase
    .from("relays")
    .select(RELAY_SELECT)
    .eq("status", "published")
    .order("source_posted_at", { ascending: false })
    .limit(limit);
  return hydrate(supabase, (data ?? []) as RelayRowLite[]);
}

export type LatestBrief = {
  slug: string;
  title: string;
  tlDr: string | null;
  publishedAt: string | null;
  season: number | null;
  week: number | null;
  /** From articles.metadata, written by the drafts route. */
  periodStart: string | null;
  periodEnd: string | null;
  /**
   * "pre", "regular", "post" or "off", from articles.metadata. A pre-season
   * edition stores week null (plan section 22), so without this the listing
   * called August the off-season.
   */
  phase: string | null;
};

type BriefRow = {
  slug: string;
  title: string;
  tl_dr: string | null;
  published_at: string | null;
  season: number | null;
  week: number | null;
  period_start: string | null;
  period_end: string | null;
  phase: string | null;
};

function briefFromRow(row: BriefRow): LatestBrief {
  return {
    slug: row.slug,
    title: row.title,
    tlDr: row.tl_dr,
    publishedAt: row.published_at,
    season: row.season,
    week: row.week,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    phase: row.phase,
  };
}

/**
 * The three metadata keys these readers want, projected in the select rather
 * than pulled as the whole jsonb column.
 *
 * `articles.metadata` on an edition also carries every dataset the page's blocks
 * reference, which is tens of kilobytes per edition. Reading all of it to take
 * two date strings cost about 40 KB a row on a list that runs to 200, and the
 * same select backs the hub's latest-edition read on every request.
 */
const BRIEF_SELECT =
  "slug, title, tl_dr, published_at, season, week, period_start:metadata->>period_start, period_end:metadata->>period_end, phase:metadata->>phase";

/** The newest published edition, or null when none exists yet. */
export async function loadLatestBrief(supabase: ReaderClient): Promise<LatestBrief | null> {
  const { data } = await supabase
    .from("articles")
    .select(BRIEF_SELECT)
    .eq("status", "published")
    .eq("article_type", "brief")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data ? briefFromRow(data as unknown as BriefRow) : null;
}

/** Every published edition, newest first, for /brief/editions. */
export async function loadPublishedBriefs(supabase: ReaderClient, limit = 200): Promise<LatestBrief[]> {
  const { data } = await supabase
    .from("articles")
    .select(BRIEF_SELECT)
    .eq("status", "published")
    .eq("article_type", "brief")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as unknown as BriefRow[]).map(briefFromRow);
}

/**
 * The sidebar, built from Relays: active categories with published Relay
 * counts, the most-used tags, and the players and teams in the newest Relays.
 * Same shape the article sidebar produced, so the rail, the docking bar and
 * the filter drawer render unchanged. Memoised for a minute like its
 * predecessor (lib/beacon-brief-feed.ts loadSidebar).
 */
export async function loadRelaySidebar(supabase: ReaderClient): Promise<BriefSidebarData> {
  return memoTtl("ref:relays:sidebar", 60_000, () => loadRelaySidebarUncached(supabase));
}

async function loadRelaySidebarUncached(supabase: ReaderClient): Promise<BriefSidebarData> {
  const [catsRes, recentRes] = await Promise.all([
    supabase.from("news_categories").select("id, slug, name, description, display_order").eq("is_active", true).order("display_order", { ascending: true }),
    supabase
      .from("relays")
      .select("id, category_id, tags")
      .eq("status", "published")
      .order("source_posted_at", { ascending: false })
      .limit(SIDEBAR_SCAN_LIMIT),
  ]);
  const recent = (recentRes.data ?? []) as { id: string; category_id: string | null; tags: string[] | null }[];

  const countByCategory = new Map<string, number>();
  for (const r of recent) {
    if (r.category_id) countByCategory.set(r.category_id, (countByCategory.get(r.category_id) ?? 0) + 1);
  }
  const categories: SidebarCategory[] = ((catsRes.data ?? []) as { id: string; slug: string; name: string; description: string | null }[])
    .map((c) => ({ slug: c.slug, name: c.name, description: c.description, count: countByCategory.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);

  const tagCounts = new Map<string, number>();
  for (const r of recent) for (const raw of r.tags ?? []) {
    const tag = raw.trim();
    if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const tags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 18);

  const recentIds = recent.map((r) => r.id);
  const rankById = new Map(recentIds.map((id, i) => [id, i]));
  const bestPlayer = new Map<string, number>();
  const bestTeam = new Map<string, number>();
  for (const batch of chunk(recentIds, ID_BATCH)) {
    const [{ data: rp }, { data: rt }] = await Promise.all([
      supabase.from("relay_players").select("relay_id, player_id").in("relay_id", batch),
      supabase.from("relay_teams").select("relay_id, team_id").in("relay_id", batch),
    ]);
    for (const r of rp ?? []) {
      const rank = rankById.get(r.relay_id);
      if (rank === undefined) continue;
      const prev = bestPlayer.get(r.player_id);
      if (prev === undefined || rank < prev) bestPlayer.set(r.player_id, rank);
    }
    for (const r of rt ?? []) {
      const rank = rankById.get(r.relay_id);
      if (rank === undefined) continue;
      const prev = bestTeam.get(r.team_id);
      if (prev === undefined || rank < prev) bestTeam.set(r.team_id, rank);
    }
  }
  const topPlayerIds = [...bestPlayer.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([id]) => id);
  const topTeamIds = [...bestTeam.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([id]) => id);

  const [playersRes, teamsRes] = await Promise.all([
    topPlayerIds.length
      ? supabase.from("players").select("id, slug, full_name, first_name, last_name, position, team").in("id", topPlayerIds)
      : Promise.resolve({ data: [] as never[] }),
    topTeamIds.length
      ? supabase.from("nfl_teams").select("id, abbreviation, name").in("id", topTeamIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const players = ((playersRes.data ?? []) as { id: string; slug: string; full_name: string | null; first_name: string | null; last_name: string | null; position: string | null; team: string | null }[])
    .sort((a, b) => (bestPlayer.get(a.id) ?? 0) - (bestPlayer.get(b.id) ?? 0))
    .map((p) => ({
      slug: p.slug,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team,
    }));
  const teams = ((teamsRes.data ?? []) as { id: string; abbreviation: string; name: string }[])
    .sort((a, b) => (bestTeam.get(a.id) ?? 0) - (bestTeam.get(b.id) ?? 0))
    .map(({ abbreviation, name }) => ({ abbreviation, name }));

  return { categories, tags, players, teams };
}

/** The distinct weeks that have published Relays this season, for the week filter. */
export async function loadRelayWeeks(supabase: ReaderClient, season: string): Promise<number[]> {
  return (await loadRelayWeekCounts(supabase, season)).map((w) => w.week);
}

export type RelayWeekCount = { week: number; count: number };

/**
 * Every season week with a published Relay and how many, newest week first.
 * Behind the week filter and the week rail. Memoised a minute.
 */
export async function loadRelayWeekCounts(supabase: ReaderClient, season: string): Promise<RelayWeekCount[]> {
  try {
    return await memoTtl(`ref:relays:week-counts:${season}`, 60_000, async () => {
      // PAGED, not capped at 1000. A single capped read ordered by week
      // descending drops the EARLIEST weeks of a busy season, so the filter
      // quietly stops offering week 1 while still looking complete. id breaks
      // the ties inside a week so pages neither overlap nor skip.
      const rows = await fetchAllRows(`relay week counts ${season}`, (from, to) =>
        supabase
          .from("relays")
          .select("week")
          .eq("status", "published")
          .eq("season", season)
          .not("week", "is", null)
          .order("week", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      );
      const counts = new Map<number, number>();
      for (const r of rows) if (typeof r.week === "number") counts.set(r.week, (counts.get(r.week) ?? 0) + 1);
      return [...counts.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => b.week - a.week);
    });
  } catch (err) {
    // The feed still renders without a week filter; a partial count would not
    // say it was partial. A rejected read is not memoised.
    console.error("[relays] week counts failed", err);
    return [];
  }
}

/** The light row the calendar view draws a day from. */
export type RelayCalendarItem = {
  id: string;
  slug: string;
  headline: string;
  kind: RelayKind;
  sourcePostedAt: string;
};

/**
 * Every published Relay posted inside [start, end), oldest first, with only
 * the columns a calendar cell shows. Paged: a busy month is a few hundred rows
 * and the cap would otherwise drop the end of it without a word.
 */
export async function loadRelaysBetween(supabase: ReaderClient, start: string, end: string): Promise<RelayCalendarItem[]> {
  let rows;
  try {
    rows = await fetchAllRows(`relays between ${start} and ${end}`, (from, to) =>
      supabase
        .from("relays")
        .select("id, slug, headline, kind, source_posted_at")
        .eq("status", "published")
        .gte("source_posted_at", start)
        .lt("source_posted_at", end)
        .order("source_posted_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    // An empty month renders; half a month would look like a quiet one.
    console.error("[relays] calendar read failed", err);
    return [];
  }
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    headline: r.headline,
    kind: isRelayKind(r.kind) ? r.kind : "other",
    sourcePostedAt: r.source_posted_at,
  }));
}
