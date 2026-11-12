/**
 * The offseason board's build and read. The rules are in offseason-build.ts.
 *
 * BUILD (service role, from /api/cron/faab-priors). Walks one season's leagues
 * in batches of 150 through `waiver_pickup_counts`, which reduces each batch's
 * completed waiver and free agent adds to one jsonb value inside Postgres, so
 * no transaction row crosses the wire and the 1,000-row cap cannot truncate
 * anything. Then reads points for the qualifying players only, and median bids
 * from the kept FAAB sample. Stores one row per season in
 * `waiver_pickup_showcases`. Iterates leagues as id batches for an aggregate,
 * never per-league model work and never a Sleeper request.
 *
 * It runs only in the offseason (the hub has nothing else to show then) and
 * at most once a week per season, because a finished season changes only when
 * a late league sync files an old week.
 *
 * READ (public page). One row per season, cached daily under the
 * `waiverShowcase` tag, with player names resolved at render so a renamed or
 * re-slugged player is never shown under a stale name.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { createCachedReadClient } from "@/lib/supabase/server";
import {
  fetchAllRowsByKeyset,
  fetchAllRowsInChunks,
  fetchAllRowsInChunksByKeyset,
} from "@/lib/supabase/fetch-all";
import {
  foldPickupCounts,
  isShowcasePosition,
  medianOf,
  pointsAfter,
  qualifyingLeagues,
  selectStored,
  typicalWeek,
  type PickupAggregate,
  type PickupCountRow,
  type ShowcasePosition,
  type ShowcaseEntry,
  type WeekLine,
} from "./offseason-build";
export { offseasonSeasonFor, showcaseDue, SHOWCASE_STALE_MS } from "./offseason-build";

type ServiceClient = SupabaseClient<Database>;

const LEAGUE_BATCH = 150;
export type ShowcaseBuildResult = {
  season: number;
  leagues: number;
  candidates: number;
  stored: number;
};

async function seasonLeagueIds(supabase: ServiceClient, season: number): Promise<string[]> {
  const rows = await fetchAllRowsByKeyset<{ id: string }, string>(
    `showcase leagues ${season}`,
    (after, limit) => {
      let q = supabase
        .from("leagues")
        .select("id")
        .eq("season", season)
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q;
    },
    (row) => row.id,
  );
  return rows.map((r) => r.id);
}

/** Build and store one season's showcase. */
export async function buildPickupShowcase(
  supabase: ServiceClient,
  season: number,
): Promise<ShowcaseBuildResult> {
  const leagueIds = await seasonLeagueIds(supabase, season);
  const totals = new Map<string, PickupAggregate>();
  let leaguesWithAdds = 0;

  for (let i = 0; i < leagueIds.length; i += LEAGUE_BATCH) {
    const batch = leagueIds.slice(i, i + LEAGUE_BATCH);
    const { data, error } = await supabase.rpc("waiver_pickup_counts", {
      p_season: season,
      p_league_ids: batch,
    });
    if (error) throw new Error(`showcase counts failed: ${error.message}`);
    const payload = (data ?? {}) as { leagues?: unknown; rows?: unknown };
    leaguesWithAdds += Number(payload.leagues) || 0;
    foldPickupCounts(totals, Array.isArray(payload.rows) ? (payload.rows as PickupCountRow[]) : []);
  }

  const floor = qualifyingLeagues(leaguesWithAdds);
  const qualifying = Array.from(totals.values()).filter((a) => a.leagues >= floor);

  // Sleeper id to our player, at the four positions the board shows. A
  // defender is never scored from the pts_* columns (CLAUDE.md, IDP), so
  // defenders are left off rather than given a figure that would be wrong.
  const players = await fetchAllRowsInChunks(
    "showcase players",
    qualifying.map((q) => q.sleeperId),
    (chunk, from, to) =>
      supabase
        .from("players")
        .select("id, position, external_ids")
        .in("external_ids->>sleeper", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  const playerBySleeper = new Map<string, { id: string; position: ShowcasePosition }>();
  for (const p of players) {
    const ext = (p.external_ids ?? {}) as Record<string, unknown>;
    const sid = typeof ext.sleeper === "string" ? ext.sleeper : null;
    if (!sid || !isShowcasePosition(p.position)) continue;
    playerBySleeper.set(sid, { id: p.id, position: p.position });
  }

  const candidates = qualifying.filter((q) => playerBySleeper.has(q.sleeperId));
  const playerIds = candidates.map((c) => playerBySleeper.get(c.sleeperId)!.id);

  type StatRow = {
    id: string;
    player_id: string;
    week: number;
    gp: number | null;
    pts_ppr: number | null;
    pts_half_ppr: number | null;
    pts_std: number | null;
    rec: number | null;
  };
  const stats = await fetchAllRowsInChunksByKeyset<StatRow, string, string>(
    "showcase stats",
    playerIds,
    (chunk, after, limit) => {
      let q = supabase
        .from("player_stats")
        .select("id, player_id, week, gp, pts_ppr, pts_half_ppr, pts_std, rec")
        .in("player_id", chunk)
        .eq("season", season)
        .eq("season_type", "regular")
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q as unknown as PromiseLike<{ data: StatRow[] | null; error: { message: string } | null }>;
    },
    (row) => row.id,
  );
  const linesByPlayer = new Map<string, WeekLine[]>();
  for (const s of stats) {
    const list = linesByPlayer.get(s.player_id) ?? [];
    list.push({
      week: s.week,
      gp: s.gp === null ? null : Number(s.gp),
      ppr: s.pts_ppr === null ? null : Number(s.pts_ppr),
      half: s.pts_half_ppr === null ? null : Number(s.pts_half_ppr),
      std: s.pts_std === null ? null : Number(s.pts_std),
      rec: s.rec,
    });
    linesByPlayer.set(s.player_id, list);
  }

  type BidRow = { id: number; player_sleeper_id: string; winning_pct: number };
  const bids = await fetchAllRowsInChunksByKeyset<BidRow, string, number>(
    "showcase bids",
    candidates.map((c) => c.sleeperId),
    (chunk, after, limit) => {
      let q = supabase
        .from("faab_prior_auctions")
        .select("id, player_sleeper_id, winning_pct")
        .eq("season", season)
        .in("player_sleeper_id", chunk)
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q as unknown as PromiseLike<{ data: BidRow[] | null; error: { message: string } | null }>;
    },
    (row) => row.id,
  );
  const bidsBySleeper = new Map<string, number[]>();
  for (const b of bids) {
    const list = bidsBySleeper.get(b.player_sleeper_id) ?? [];
    list.push(Math.min(100, Math.max(0, Number(b.winning_pct))));
    bidsBySleeper.set(b.player_sleeper_id, list);
  }

  const entries: ShowcaseEntry[] = [];
  for (const c of candidates) {
    const player = playerBySleeper.get(c.sleeperId)!;
    const week = typicalWeek(c.weekCounts);
    if (week === null) continue;
    const points = pointsAfter(linesByPlayer.get(player.id) ?? [], week);
    if (points.games === 0) continue;
    const priced = bidsBySleeper.get(c.sleeperId) ?? [];
    const median = medianOf(priced);
    entries.push({
      playerId: player.id,
      sleeperId: c.sleeperId,
      position: player.position,
      typicalWeek: week,
      leagues: c.leagues,
      viaWaiver: c.viaWaiver,
      viaFreeAgent: c.viaFreeAgent,
      medianBidPct: median === null ? null : Math.round(median * 10) / 10,
      bidSamples: priced.length,
      points,
    });
  }

  const stored = selectStored(entries);
  const { error } = await supabase.from("waiver_pickup_showcases").upsert(
    {
      season,
      leagues_count: leaguesWithAdds,
      players: stored as unknown as Database["public"]["Tables"]["waiver_pickup_showcases"]["Insert"]["players"],
      built_at: new Date().toISOString(),
    },
    { onConflict: "season" },
  );
  if (error) throw new Error(`showcase write failed: ${error.message}`);

  return { season, leagues: leaguesWithAdds, candidates: candidates.length, stored: stored.length };
}

/** The stored row's built_at, or null when the season has none. */
export async function showcaseBuiltAt(
  supabase: ServiceClient,
  season: number,
): Promise<string | null> {
  const { data } = await supabase
    .from("waiver_pickup_showcases")
    .select("built_at")
    .eq("season", season)
    .maybeSingle();
  return data?.built_at ?? null;
}

/* ---------- Read ---------- */

export type ShowcasePlayer = Omit<ShowcaseEntry, "position"> & {
  name: string;
  slug: string;
  /** His position today, read at render. */
  position: ShowcasePosition;
};

export type PickupShowcase = {
  season: number;
  leagues: number;
  builtAt: string;
  players: ShowcasePlayer[];
};

function isEntry(value: unknown): value is ShowcaseEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.playerId === "string" &&
    typeof v.typicalWeek === "number" &&
    typeof v.leagues === "number" &&
    !!v.points &&
    typeof v.points === "object"
  );
}

async function readShowcase(season: number): Promise<PickupShowcase | null> {
  // Public by policy (anon SELECT): the row is aggregates over leagues and
  // carries no league, roster or manager identifier.
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("waiver_pickup_showcases")
    .select("season, leagues_count, players, built_at")
    .eq("season", season)
    .maybeSingle();
  // An error throws so unstable_cache never stores it: a transient failure
  // would otherwise show the empty state for a full day.
  if (error) throw new Error(`showcase read failed: ${error.message}`);
  if (!data) return null;
  const entries = (Array.isArray(data.players) ? data.players : []).filter(isEntry);
  if (entries.length === 0) return null;

  const { data: rows, error: pErr } = await supabase
    .from("players")
    .select("id, full_name, slug, position")
    .in(
      "id",
      entries.map((e) => e.playerId),
    );
  if (pErr) throw new Error(`showcase player read failed: ${pErr.message}`);
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));

  const players: ShowcasePlayer[] = [];
  for (const e of entries) {
    const p = byId.get(e.playerId);
    if (!p || !p.full_name || !p.slug || !isShowcasePosition(p.position)) continue;
    players.push({ ...e, name: p.full_name, slug: p.slug, position: p.position });
  }
  return {
    season: data.season,
    leagues: data.leagues_count,
    builtAt: data.built_at,
    players,
  };
}

/** One season's showcase, cached daily. Null when none is stored. */
export async function loadPickupShowcaseCached(season: number): Promise<PickupShowcase | null> {
  const cached = unstable_cache(() => readShowcase(season), ["waiver-pickup-showcase", String(season)], {
    revalidate: CACHE_TTL.daily,
    tags: [CACHE_TAGS.waiverShowcase],
  });
  try {
    return await cached();
  } catch {
    try {
      return await readShowcase(season);
    } catch {
      return null;
    }
  }
}
