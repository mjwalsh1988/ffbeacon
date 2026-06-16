import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { getDefaultSourceSlug } from "@/lib/source";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import type { BoardScope } from "@/lib/ranking-boards";
import { isBoardScope } from "@/lib/ranking-boards";

/**
 * Server-only data layer for the public Signal profile (/u/[handle]) and the
 * public board view (/u/[handle]/rankings/[boardId]).
 *
 * CACHING MODEL (handoff.md Phase 2):
 *   - The whole profile bundle (signal row + featured-board metadata + featured
 *     league cards) is wrapped in unstable_cache tagged `signal:{handle}`. The
 *     My Signal editor and the boards manager revalidate that tag on edit, so
 *     anonymous hits are served from the data cache and the gating queries run
 *     only on a cache miss, never per request.
 *   - Each featured board's Top-N player list is cached separately, keyed by
 *     board id + updated_at and tagged `board:{id}`, so the board editor's
 *     `revalidateTag('board:{id}')` busts exactly that board (player-only edits
 *     do not bump board.updated_at, which is why the tag, not the key, is the
 *     authoritative invalidator).
 *
 * All reads here use the service-role client (no cookies) so the functions are
 * pure and cacheable. The page is responsible for gating visibility: it renders
 * public content only when the signal is live (published + public + not hidden),
 * and otherwise falls back to the cookie-based owner-preview path.
 */

const BUCKET = "signal-media";

export const PRIMARY_TOP_N_DEFAULT = 10;
export const SECONDARY_TOP_N_DEFAULT = 5;

export function signalTag(handle: string): string {
  return `signal:${handle.toLowerCase()}`;
}

export function boardTag(boardId: string): string {
  return `board:${boardId}`;
}

/**
 * Bust every cached surface that depends on a user's profile: the profile
 * bundle (signal:{handle}) AND each of the user's board caches (board:{id}).
 * The board view embeds the owner's handle + display name and is gated on the
 * owner's publish state, so a publish/visibility/handle/identity change must
 * invalidate the per-board caches too, not just the bundle. Boards are few per
 * user, so revalidating all of them is cheap and removes the unpublish-to-board
 * stale-cache window (and the newly-featured-board 404 window). Must be called
 * from a server action or route handler.
 */
export async function revalidateProfileCaches(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data: signal } = await supabase
    .from("signals")
    .select("handle")
    .eq("user_id", userId)
    .maybeSingle();
  if (signal?.handle) revalidateTag(signalTag(signal.handle));

  const { data: boards } = await supabase
    .from("user_ranking_boards")
    .select("id")
    .eq("user_id", userId);
  for (const board of boards ?? []) revalidateTag(boardTag(board.id));
}

export function signalMediaUrl(path: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

export type SignalProfileRow = {
  user_id: string;
  handle: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  accent: string;
  avatar_path: string | null;
  banner_path: string | null;
  status: "draft" | "published";
  visibility: "public" | "private";
  hidden: boolean;
};

export type FeaturedBoardMeta = {
  id: string;
  name: string;
  scope: BoardScope;
  tiersEnabled: boolean;
  isPrimary: boolean;
  topN: number;
  updatedAt: string;
  playerCount: number;
};

export type FeaturedLeagueCard = {
  sleeperLeagueId: string;
  name: string;
  season: number;
  totalRosters: number | null;
  formatDisplay: string | null;
  leaderTeam: string | null;
};

export type ProfileBundle = {
  signal: SignalProfileRow | null;
  boards: FeaturedBoardMeta[];
  leagues: FeaturedLeagueCard[];
};

export type BoardTopNPlayer = {
  rank: number;
  tier: number | null;
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
};

function isLiveRow(signal: SignalProfileRow): boolean {
  return (
    signal.status === "published" &&
    signal.visibility === "public" &&
    !signal.hidden
  );
}

export function isProfileLive(signal: SignalProfileRow | null): boolean {
  return !!signal && isLiveRow(signal);
}

/** Default Top-N for a board when the owner has not set profile_top_n. */
function defaultTopN(isPrimary: boolean): number {
  return isPrimary ? PRIMARY_TOP_N_DEFAULT : SECONDARY_TOP_N_DEFAULT;
}

// ---------------------------------------------------------------------------
// Featured league cards
// ---------------------------------------------------------------------------

async function loadFeaturedLeagueCards(
  userId: string,
): Promise<FeaturedLeagueCard[]> {
  const supabase = createAdminClient();

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", userId)
    .maybeSingle();

  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);
  const orderedIds = settings.signal_league_ids ?? [];
  if (orderedIds.length === 0) return [];

  // Only render leagues already synced into our DB (the public page never calls
  // Sleeper). Missing ids resolve to a skipped card.
  const { data: leagueRows } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id, name, season, total_rosters, format_config_id")
    .in("sleeper_league_id", orderedIds);

  const leagues = leagueRows ?? [];
  if (leagues.length === 0) return [];

  // Format display names for the resolved formats.
  const formatIds = Array.from(
    new Set(leagues.map((l) => l.format_config_id).filter((id): id is string => !!id)),
  );
  const formatDisplayById = new Map<string, string>();
  if (formatIds.length > 0) {
    const { data: formats } = await supabase
      .from("format_configs")
      .select("id, display_name")
      .in("id", formatIds);
    for (const f of formats ?? []) {
      formatDisplayById.set(f.id, f.display_name);
    }
  }

  // Power-ranking leader per league, using the site default source. Picks no
  // values; just the rank-1 team name as a flavor stat. Graceful when absent.
  const leaderByLeagueId = await loadLeagueLeaders(
    supabase,
    leagues.map((l) => ({ id: l.id, formatConfigId: l.format_config_id })),
  );

  const bySleeperId = new Map(leagues.map((l) => [l.sleeper_league_id, l]));

  // Preserve the owner's chosen order; drop ids with no synced league.
  return orderedIds
    .map((sleeperId) => bySleeperId.get(sleeperId))
    .filter((l): l is NonNullable<typeof l> => !!l)
    .map((l) => ({
      sleeperLeagueId: l.sleeper_league_id,
      name: l.name,
      season: l.season,
      totalRosters: l.total_rosters,
      formatDisplay: l.format_config_id
        ? formatDisplayById.get(l.format_config_id) ?? null
        : null,
      leaderTeam: leaderByLeagueId.get(l.id) ?? null,
    }));
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function loadLeagueLeaders(
  supabase: AdminClient,
  leagues: Array<{ id: string; formatConfigId: string | null }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const withFormat = leagues.filter((l) => l.formatConfigId);
  if (withFormat.length === 0) return result;

  const source = await getDefaultSourceSlug(supabase);
  if (!source) return result;

  const leagueIds = withFormat.map((l) => l.id);
  const { data: cache } = await supabase
    .from("league_power_rankings_cache")
    .select("league_id, roster_id, format_config_id, overall_rank")
    .in("league_id", leagueIds)
    .eq("source", source)
    .eq("overall_rank", 1);

  // Keep only the row whose format matches the league's resolved format.
  const formatByLeague = new Map(withFormat.map((l) => [l.id, l.formatConfigId]));
  const leaderRosterByLeague = new Map<string, string>();
  for (const row of cache ?? []) {
    if (formatByLeague.get(row.league_id) !== row.format_config_id) continue;
    leaderRosterByLeague.set(row.league_id, row.roster_id);
  }
  if (leaderRosterByLeague.size === 0) return result;

  const rosterIds = Array.from(leaderRosterByLeague.values());
  const { data: rosters } = await supabase
    .from("rosters")
    .select("id, league_id, sleeper_roster_id, owner_user_id")
    .in("id", rosterIds);
  const { data: users } = await supabase
    .from("league_users")
    .select("league_id, sleeper_user_id, display_name, team_name")
    .in("league_id", leagueIds);

  const userKey = (leagueId: string, sleeperUserId: string) =>
    `${leagueId}:${sleeperUserId}`;
  const userByKey = new Map(
    (users ?? []).map((u) => [userKey(u.league_id, u.sleeper_user_id), u]),
  );

  for (const r of rosters ?? []) {
    const u = r.owner_user_id
      ? userByKey.get(userKey(r.league_id, r.owner_user_id))
      : null;
    const teamName =
      u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`;
    result.set(r.league_id, teamName);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Profile bundle (signal + featured board metadata + league cards)
// ---------------------------------------------------------------------------

async function buildProfileBundle(handle: string): Promise<ProfileBundle> {
  const supabase = createAdminClient();

  // Service role bypasses RLS, so we fetch the row in ANY state. The PAGE
  // gates whether public content renders (isProfileLive); owner preview is a
  // separate cookie-based path.
  const { data: signalRow } = await supabase
    .from("signals")
    .select(
      "user_id, handle, display_name, headline, bio, accent, avatar_path, banner_path, status, visibility, hidden",
    )
    .eq("handle", handle)
    .maybeSingle();

  if (!signalRow) return { signal: null, boards: [], leagues: [] };
  const signal = signalRow as SignalProfileRow;

  const { data: boardRows } = await supabase
    .from("user_ranking_boards")
    .select(
      "id, name, scope, tiers_enabled, profile_is_primary, profile_sort, profile_top_n, updated_at, user_ranking_board_players(count)",
    )
    .eq("user_id", signal.user_id)
    .eq("profile_visible", true);

  const boards: FeaturedBoardMeta[] = (boardRows ?? [])
    .map((row) => {
      const countRel = row.user_ranking_board_players as unknown as
        | { count: number }[]
        | null;
      const isPrimary = row.profile_is_primary;
      return {
        meta: {
          id: row.id,
          name: row.name,
          scope: isBoardScope(row.scope) ? row.scope : "overall",
          tiersEnabled: row.tiers_enabled,
          isPrimary,
          topN: row.profile_top_n ?? defaultTopN(isPrimary),
          updatedAt: row.updated_at,
          playerCount: countRel?.[0]?.count ?? 0,
        } satisfies FeaturedBoardMeta,
        sort: row.profile_sort,
      };
    })
    // Primary first, then by the owner's chosen secondary order.
    .sort((a, b) => {
      if (a.meta.isPrimary !== b.meta.isPrimary) return a.meta.isPrimary ? -1 : 1;
      return a.sort - b.sort;
    })
    .map((entry) => entry.meta);

  const leagues = await loadFeaturedLeagueCards(signal.user_id);

  return { signal, boards, leagues };
}

/**
 * Cached profile bundle. Tagged `signal:{handle}` so editor + boards-manager
 * edits revalidate it. Returns signal=null when no profile exists for the
 * handle.
 */
export function loadProfileBundle(handle: string): Promise<ProfileBundle> {
  const key = handle.toLowerCase();
  return unstable_cache(
    () => buildProfileBundle(key),
    ["signal-profile-bundle", key],
    { tags: [signalTag(key)], revalidate: 3600 },
  )();
}

// ---------------------------------------------------------------------------
// Featured board Top-N (per board, tagged board:{id})
// ---------------------------------------------------------------------------

async function buildBoardTopN(
  boardId: string,
  limit: number,
): Promise<BoardTopNPlayer[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("user_ranking_board_players")
    .select(
      "rank_position, tier, players(id, slug, full_name, first_name, last_name, position, team)",
    )
    .eq("board_id", boardId)
    .order("rank_position", { ascending: true })
    .limit(limit);

  return (data ?? [])
    .map((row) => {
      const p = row.players as unknown as {
        id: string;
        slug: string;
        full_name: string | null;
        first_name: string;
        last_name: string;
        position: string;
        team: string | null;
      } | null;
      if (!p) return null;
      const name = p.full_name || `${p.first_name} ${p.last_name}`.trim();
      return {
        rank: row.rank_position,
        tier: row.tier,
        playerId: p.id,
        slug: p.slug,
        name,
        position: p.position,
        team: p.team,
      } satisfies BoardTopNPlayer;
    })
    .filter((p): p is BoardTopNPlayer => p !== null);
}

/**
 * Cached Top-N for a single featured board. Keyed by board id + updated_at +
 * limit and tagged `board:{id}` so the board editor's revalidateTag busts it
 * even on player-only edits (which do not bump updated_at).
 */
export function loadBoardTopN(
  boardId: string,
  updatedAt: string,
  limit: number,
): Promise<BoardTopNPlayer[]> {
  return unstable_cache(
    () => buildBoardTopN(boardId, limit),
    ["signal-board-topn", boardId, updatedAt, String(limit)],
    { tags: [boardTag(boardId)], revalidate: 3600 },
  )();
}

// ---------------------------------------------------------------------------
// Public board view support
// ---------------------------------------------------------------------------

export type PublicBoardView = {
  board: {
    id: string;
    name: string;
    scope: BoardScope;
    tiersEnabled: boolean;
    tierLabels: Record<string, string>;
    updatedAt: string;
  };
  owner: { handle: string; displayName: string };
  players: BoardTopNPlayer[];
};

/**
 * Full public board, gated on the owner's Signal being live AND the board being
 * profile_visible. Returns null when the board is not publicly viewable.
 * Cached + tagged both `board:{id}` and `signal:{handle}` so either an edit to
 * the board or a change to the owner's publish state invalidates it.
 */
async function buildPublicBoard(boardId: string): Promise<PublicBoardView | null> {
  const supabase = createAdminClient();
  const { data: board } = await supabase
    .from("user_ranking_boards")
    .select(
      "id, name, scope, tiers_enabled, tier_labels, updated_at, profile_visible, user_id",
    )
    .eq("id", boardId)
    .maybeSingle();
  if (!board || !board.profile_visible) return null;

  const { data: signal } = await supabase
    .from("signals")
    .select("handle, display_name, status, visibility, hidden")
    .eq("user_id", board.user_id)
    .maybeSingle();
  if (
    !signal ||
    signal.status !== "published" ||
    signal.visibility !== "public" ||
    signal.hidden
  ) {
    return null;
  }

  const players = await buildBoardTopN(boardId, 1000);

  return {
    board: {
      id: board.id,
      name: board.name,
      scope: isBoardScope(board.scope) ? board.scope : "overall",
      tiersEnabled: board.tiers_enabled,
      tierLabels: (board.tier_labels as Record<string, string>) ?? {},
      updatedAt: board.updated_at,
    },
    owner: { handle: signal.handle, displayName: signal.display_name },
    players,
  };
}

export function loadPublicBoard(boardId: string): Promise<PublicBoardView | null> {
  return unstable_cache(
    () => buildPublicBoard(boardId),
    ["signal-public-board", boardId],
    { tags: [boardTag(boardId)], revalidate: 3600 },
  )();
}

/**
 * Resolve a (possibly historical) handle to the current handle of a live
 * profile, for the 301 redirect. Returns null when the handle has no history
 * or the target is not live. Not cached: only runs when the primary lookup
 * misses, which is rare.
 */
export async function resolveHistoricalHandle(
  handle: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: history } = await supabase
    .from("signal_handle_history")
    .select("signal_id")
    .eq("old_handle", handle.toLowerCase())
    .maybeSingle();
  if (!history) return null;
  const { data: current } = await supabase
    .from("signals")
    .select("handle, status, visibility, hidden")
    .eq("id", history.signal_id)
    .maybeSingle();
  if (
    !current ||
    current.status !== "published" ||
    current.visibility !== "public" ||
    current.hidden
  ) {
    return null;
  }
  return current.handle;
}
