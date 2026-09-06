import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { formatTeamLabel } from "@/lib/team-label";
import type { Database } from "@/lib/database.types";
import { getDefaultSourceSlug } from "@/lib/source";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import type { BoardScope } from "@/lib/ranking-boards";
import { isBoardScope } from "@/lib/ranking-boards";
import { nflTeamName } from "@/lib/nfl-teams";
import {
  type ProfileLayout,
  DEFAULT_LAYOUT,
  parseLayoutConfig,
  hasStoredBlocks,
  resolveLayout,
  seedBlocksFromProfile,
} from "@/lib/signal/blocks";

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
  id: string;
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
  layout: ProfileLayout;
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
  /**
   * Sleeper's own league logo id, or null when the league has no image.
   *
   * Read straight out of `leagues.metadata`, which holds the raw Sleeper league
   * object verbatim. There is no avatar column and none is to be added: this is
   * source data, so it lives in `metadata` per the Data Architecture rule.
   */
  avatar: string | null;
  season: number;
  totalRosters: number | null;
  formatDisplay: string | null;
  leaderTeam: string | null;
};

export type SignalProfileLink = { label: string; url: string };

export type ProfileFavorites = {
  team: { code: string; name: string } | null;
  player: {
    slug: string;
    name: string;
    position: string;
    team: string | null;
  } | null;
};

/**
 * A render-ready profile block: the layout_config block resolved against the
 * loaded bundle data. The resolver omits any block whose referenced entity is
 * gone or no longer public (graceful degrade), so the public page can render
 * `blocks` directly without re-checking visibility. `about` carries the bio,
 * `text` its own copy, and the reference blocks carry the live entity.
 */
export type ResolvedBlock =
  | { id: string; type: "about"; bio: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "links"; links: SignalProfileLink[] }
  | { id: string; type: "favorites"; favorites: ProfileFavorites }
  | { id: string; type: "board_top_n"; board: FeaturedBoardMeta }
  | { id: string; type: "league_card"; league: FeaturedLeagueCard };

export type ProfileBundle = {
  signal: SignalProfileRow | null;
  layout: ProfileLayout;
  /** Resolved, ordered, gracefully-degraded blocks. Render these directly. */
  blocks: ResolvedBlock[];
  // The raw entity collections are retained for any consumer that wants the full
  // set rather than the block-ordered view. The public page renders only `blocks`.
  boards: FeaturedBoardMeta[];
  leagues: FeaturedLeagueCard[];
  links: SignalProfileLink[];
  favorites: ProfileFavorites;
};

const EMPTY_FAVORITES: ProfileFavorites = { team: null, player: null };

/** Coerce signals.links jsonb into a shape-safe list. The DB shape guard
 * (migration 0069) enforces this on write; we parse defensively on read. */
function parseProfileLinks(value: unknown): SignalProfileLink[] {
  if (!Array.isArray(value)) return [];
  const out: SignalProfileLink[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { url?: unknown }).url === "string"
    ) {
      const label = (item as { label: string }).label;
      const url = (item as { url: string }).url;
      // Defense in depth: only https links reach an href on the public page,
      // even if a row ever bypassed the write-time + DB CHECK guards.
      if (!url.startsWith("https://")) continue;
      out.push({ label, url });
    }
  }
  return out;
}

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
    // `avatar` is projected out of the stored raw Sleeper object rather than
    // selecting the whole of it, the same arrow syntax lib/league-pulse.ts uses
    // for `leg`. No new column, no migration.
    .select(
      "id, sleeper_league_id, name, season, total_rosters, format_config_id, avatar:metadata->>avatar",
    )
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
      avatar: typeof l.avatar === "string" ? l.avatar : null,
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
    result.set(
      r.league_id,
      formatTeamLabel({
        teamName: u?.team_name,
        username: u?.display_name,
        sleeperRosterId: r.sleeper_roster_id,
      }),
    );
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
      "id, user_id, handle, display_name, headline, bio, accent, avatar_path, banner_path, status, visibility, hidden, layout, layout_config, links, favorite_team, favorite_player_id",
    )
    .eq("handle", handle)
    .maybeSingle();

  if (!signalRow) {
    return {
      signal: null,
      layout: DEFAULT_LAYOUT,
      blocks: [],
      boards: [],
      leagues: [],
      links: [],
      favorites: EMPTY_FAVORITES,
    };
  }
  const layout = resolveLayout(signalRow.layout);
  const signal = { ...(signalRow as SignalProfileRow), layout } satisfies SignalProfileRow;

  const links = parseProfileLinks(signalRow.links);
  const favorites = await resolveFavorites(
    supabase,
    signalRow.favorite_team,
    signalRow.favorite_player_id,
  );

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

  const blocks = resolveProfileBlocks(signal, signalRow.layout_config, {
    boards,
    leagues,
    links,
    favorites,
  });

  return { signal, layout, blocks, boards, leagues, links, favorites };
}

/**
 * Resolve the stored layout_config blocks against the loaded bundle data into an
 * ordered, render-ready list. GRACEFUL DEGRADE: a block is dropped when its
 * referenced entity is absent from the bundle, which is exactly the set of
 * entities that are publicly available right now (boards = profile_visible only,
 * leagues = synced + featured only, links/favorites/bio = present and non-empty).
 * So a board later made private or a league later un-synced renders nothing,
 * never errors, and never leaks. When layout_config has no blocks yet (an
 * un-customized profile), the default seed is produced so existing live profiles
 * keep showing their content until the owner customizes.
 */
function resolveProfileBlocks(
  signal: SignalProfileRow,
  rawLayoutConfig: unknown,
  data: {
    boards: FeaturedBoardMeta[];
    leagues: FeaturedLeagueCard[];
    links: SignalProfileLink[];
    favorites: ProfileFavorites;
  },
): ResolvedBlock[] {
  const hasFavorites = !!(data.favorites.team || data.favorites.player);
  const bio = signal.bio?.trim() ?? "";

  // Seed defaults ONLY for an un-customized profile. A configured-but-empty
  // layout (the owner removed every block) is respected as empty, not re-seeded.
  let blocks = parseLayoutConfig(rawLayoutConfig);
  if (!hasStoredBlocks(rawLayoutConfig)) {
    blocks = seedBlocksFromProfile({
      hasBio: bio.length > 0,
      hasFavorites,
      hasLinks: data.links.length > 0,
      boardIds: data.boards.map((b) => b.id),
      sleeperLeagueIds: data.leagues.map((l) => l.sleeperLeagueId),
    });
  }

  const boardById = new Map(data.boards.map((b) => [b.id, b]));
  const leagueById = new Map(data.leagues.map((l) => [l.sleeperLeagueId, l]));

  const resolved: ResolvedBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "about":
        if (bio.length > 0) resolved.push({ id: block.id, type: "about", bio });
        break;
      case "text": {
        const text = block.text.trim();
        if (text.length > 0) resolved.push({ id: block.id, type: "text", text });
        break;
      }
      case "links":
        if (data.links.length > 0) {
          resolved.push({ id: block.id, type: "links", links: data.links });
        }
        break;
      case "favorites":
        if (hasFavorites) {
          resolved.push({
            id: block.id,
            type: "favorites",
            favorites: data.favorites,
          });
        }
        break;
      case "board_top_n": {
        const board = boardById.get(block.boardId);
        if (board) resolved.push({ id: block.id, type: "board_top_n", board });
        break;
      }
      case "league_card": {
        const league = leagueById.get(block.sleeperLeagueId);
        if (league) {
          resolved.push({ id: block.id, type: "league_card", league });
        }
        break;
      }
    }
  }
  return resolved;
}

/** Resolve the stored favorite team code + player id into display-ready data.
 * The team name comes from the canonical list; the player from a single
 * service-role lookup. Either may be null. */
async function resolveFavorites(
  supabase: AdminClient,
  favoriteTeam: string | null,
  favoritePlayerId: string | null,
): Promise<ProfileFavorites> {
  const teamName = nflTeamName(favoriteTeam);
  const team =
    favoriteTeam && teamName ? { code: favoriteTeam, name: teamName } : null;

  let player: ProfileFavorites["player"] = null;
  if (favoritePlayerId) {
    const { data: p } = await supabase
      .from("players")
      .select("slug, full_name, first_name, last_name, position, team")
      .eq("id", favoritePlayerId)
      .maybeSingle();
    if (p) {
      player = {
        slug: p.slug,
        name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
        position: p.position,
        team: p.team,
      };
    }
  }

  return { team, player };
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
