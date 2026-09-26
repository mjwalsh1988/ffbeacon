"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { boardTag, signalTag, revalidateProfileCaches } from "@/lib/signal-profile";
import type { Json } from "@/lib/database.types";
import {
  BOARD_SCOPES,
  MAX_BOARD_NAME_LENGTH,
  MAX_BOARD_PLAYERS,
  PROFILE_TOP_N_CHOICES,
  breaksFromTiers,
  isBoardScope,
  normalizeTierBreaks,
  type BoardScope,
  type ProfileBoard,
} from "@/lib/ranking-boards";
import { resolveBoardProvenance } from "@/lib/ranking-boards/provenance";

export type ActionResult = { ok: true } | { ok: false; error: string };
type BoardsResult =
  | { ok: true; boards: ProfileBoard[] }
  | { ok: false; error: string };

const BOARDS_TABLE = "user_ranking_boards";
const BOARD_PLAYERS_TABLE = "user_ranking_board_players";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Server actions for the My Rankings surfaces: creating and deleting boards,
 * curating which boards appear on the public profile, and busting the caches
 * those pages read through. Every write re-derives the caller from the
 * request-scoped session client and relies on the owner-only RLS policies on
 * user_ranking_boards (auth.uid() = user_id) as the backstop, never on an id
 * or ownership claim the client sends.
 */

async function ownerHandle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("signals")
    .select("handle")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.handle ?? null;
}

/** The caller's boards in profile-display order, in the exact shape the
 * boards manager renders. Re-read after every write so the client always
 * applies server-computed values (sort order, primary flag) rather than a
 * guess of its own. */
async function loadProfileBoards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<ProfileBoard[]> {
  const { data } = await supabase
    .from(BOARDS_TABLE)
    .select(
      "id, name, scope, includes_defenders, profile_visible, profile_is_primary, profile_sort, profile_top_n, user_ranking_board_players(count)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => {
    const countRel = row.user_ranking_board_players as unknown as
      | { count: number }[]
      | null;
    return {
      id: row.id,
      name: row.name,
      scope: isBoardScope(row.scope) ? row.scope : "overall",
      includesDefenders: row.includes_defenders,
      playerCount: countRel?.[0]?.count ?? 0,
      profileVisible: row.profile_visible,
      profileIsPrimary: row.profile_is_primary,
      profileSort: row.profile_sort,
      profileTopN: row.profile_top_n,
    };
  });
}

/** Confirms a board exists, belongs to the caller, and returns its current
 * tier settings. Lighter than requireOwnedBoard: the board editor's saves
 * happen far more often than the profile manager's, and don't need the
 * per-board player counts a full ProfileBoard list carries. */
async function verifyBoardOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  boardId: string,
): Promise<
  | { ok: true; tiersEnabled: boolean; tierBreaks: number[] }
  | { ok: false; error: string }
> {
  if (!isUuid(boardId)) return { ok: false, error: "Could not find that board." };
  const { data: board } = await supabase
    .from(BOARDS_TABLE)
    .select("user_id, tiers_enabled, tier_breaks")
    .eq("id", boardId)
    .maybeSingle();
  if (!board || board.user_id !== userId) {
    return { ok: false, error: "Could not find that board." };
  }
  return { ok: true, tiersEnabled: board.tiers_enabled, tierBreaks: board.tier_breaks ?? [] };
}

/** Confirms the board exists and belongs to the caller. Returns the caller's
 * full board list (for the manager's post-write state) on success. */
async function requireOwnedBoard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  boardId: string,
): Promise<{ ok: true; boards: ProfileBoard[] } | { ok: false; error: string }> {
  if (typeof boardId !== "string" || boardId.length === 0) {
    return { ok: false, error: "Could not find that board." };
  }
  const { data: board } = await supabase
    .from(BOARDS_TABLE)
    .select("id, user_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board || board.user_id !== userId) {
    return { ok: false, error: "Could not find that board." };
  }
  return { ok: true, boards: await loadProfileBoards(supabase, userId) };
}

/**
 * Create a new ranking board, owned by the caller. Name and scope are
 * validated server-side (never trust the client); the owner-only RLS insert
 * policy is the backstop for user_id.
 */
export async function createBoard(
  rawName: string,
  rawScope: string,
  rawIncludesDefenders = false,
): Promise<{ ok: true; boardId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length === 0 || name.length > MAX_BOARD_NAME_LENGTH) {
    return { ok: false, error: "Give your board a name." };
  }
  const scope: BoardScope = isBoardScope(rawScope) ? rawScope : "overall";
  if (!BOARD_SCOPES.includes(scope)) {
    return { ok: false, error: "That is not a valid board scope." };
  }

  // Defenders widen an overall board only; the database refuses the flag on
  // any other scope, so it is dropped here rather than failing the insert.
  const includesDefenders = scope === "overall" && rawIncludesDefenders === true;

  const { data, error } = await supabase
    .from(BOARDS_TABLE)
    .insert({ user_id: user.id, name, scope, includes_defenders: includesDefenders })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the board." };
  }

  revalidatePath("/my-beacon/rankings");
  return { ok: true, boardId: data.id };
}

/**
 * Delete a board (and, via ON DELETE CASCADE, all of its player rows).
 * RLS restricts the delete to the owner; we also re-verify ownership first so
 * a caller gets a clear "not found" instead of a silent zero-row delete.
 */
export async function deleteBoard(boardId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await requireOwnedBoard(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const { error } = await supabase.from(BOARDS_TABLE).delete().eq("id", boardId);
  if (error) return { ok: false, error: "Could not delete the board. Please try again." };

  revalidatePath("/my-beacon/rankings");
  revalidateTag(boardTag(boardId));
  const handle = await ownerHandle(supabase, user.id);
  if (handle) revalidateTag(signalTag(handle));
  return { ok: true };
}

/** Turn a board ON for the profile. The first board featured becomes the
 * primary automatically; later ones land at the end of the secondary order.
 * Recomputed from the caller's current rows, never from client-sent values. */
export async function featureBoard(boardId: string): Promise<BoardsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await requireOwnedBoard(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const hasPrimary = owned.boards.some((b) => b.profileVisible && b.profileIsPrimary);
  const becomePrimary = !hasPrimary;
  const secondaries = owned.boards.filter((b) => b.profileVisible && !b.profileIsPrimary);
  const maxSort = secondaries.reduce((max, b) => Math.max(max, b.profileSort), -1);
  const nextSort = becomePrimary ? 0 : maxSort + 1;

  const { error } = await supabase
    .from(BOARDS_TABLE)
    .update({
      profile_visible: true,
      profile_is_primary: becomePrimary,
      profile_sort: nextSort,
      updated_at: new Date().toISOString(),
    })
    .eq("id", boardId);
  if (error) {
    return { ok: false, error: "Could not update your profile display. Please try again." };
  }

  revalidatePath("/my-beacon/rankings");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true, boards: await loadProfileBoards(supabase, user.id) };
}

/** Turn a board OFF. If it was the primary, promote the first secondary so
 * the profile keeps a headline board whenever any board is still featured. */
export async function unfeatureBoard(boardId: string): Promise<BoardsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await requireOwnedBoard(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const target = owned.boards.find((b) => b.id === boardId);
  const secondaries = owned.boards
    .filter((b) => b.profileVisible && !b.profileIsPrimary && b.id !== boardId)
    .sort((a, b) => a.profileSort - b.profileSort);
  const promote = target?.profileIsPrimary && secondaries.length > 0 ? secondaries[0] : null;

  const { error: offError } = await supabase
    .from(BOARDS_TABLE)
    .update({
      profile_visible: false,
      profile_is_primary: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", boardId);
  if (offError) {
    return { ok: false, error: "Could not update your profile display. Please try again." };
  }

  if (promote) {
    const { error: promoteError } = await supabase
      .from(BOARDS_TABLE)
      .update({
        profile_is_primary: true,
        profile_sort: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", promote.id);
    if (promoteError) {
      return { ok: false, error: "Could not update your profile display. Please try again." };
    }
  }

  revalidatePath("/my-beacon/rankings");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true, boards: await loadProfileBoards(supabase, user.id) };
}

/** Make a featured secondary the primary. The old primary swaps into the
 * slot the chosen board vacated, so the secondary order stays sensible. */
export async function makeBoardPrimary(boardId: string): Promise<BoardsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await requireOwnedBoard(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const old = owned.boards.find((b) => b.profileVisible && b.profileIsPrimary);
  if (old && old.id === boardId) return { ok: true, boards: owned.boards };
  const target = owned.boards.find((b) => b.id === boardId);
  const vacatedSort = target?.profileSort ?? 0;

  if (old) {
    const { error: clearError } = await supabase
      .from(BOARDS_TABLE)
      .update({
        profile_is_primary: false,
        profile_sort: vacatedSort,
        updated_at: new Date().toISOString(),
      })
      .eq("id", old.id);
    if (clearError) {
      return { ok: false, error: "Could not update your profile display. Please try again." };
    }
  }

  const { error: setError2 } = await supabase
    .from(BOARDS_TABLE)
    .update({ profile_is_primary: true, updated_at: new Date().toISOString() })
    .eq("id", boardId);
  if (setError2) {
    return { ok: false, error: "Could not update your profile display. Please try again." };
  }

  revalidatePath("/my-beacon/rankings");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true, boards: await loadProfileBoards(supabase, user.id) };
}

/** Reorder a secondary up or down by swapping sort values with its neighbour. */
export async function moveBoardOrder(
  boardId: string,
  direction: "up" | "down",
): Promise<BoardsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  if (direction !== "up" && direction !== "down") {
    return { ok: false, error: "Invalid move direction." };
  }

  const owned = await requireOwnedBoard(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const secondaries = owned.boards
    .filter((b) => b.profileVisible && !b.profileIsPrimary)
    .sort((a, b) => a.profileSort - b.profileSort);
  const index = secondaries.findIndex((b) => b.id === boardId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= secondaries.length) {
    return { ok: true, boards: owned.boards };
  }
  const a = secondaries[index];
  const b = secondaries[swapIndex];

  const { error: e1 } = await supabase
    .from(BOARDS_TABLE)
    .update({ profile_sort: b.profileSort, updated_at: new Date().toISOString() })
    .eq("id", a.id);
  if (e1) return { ok: false, error: "Could not update your profile display. Please try again." };
  const { error: e2 } = await supabase
    .from(BOARDS_TABLE)
    .update({ profile_sort: a.profileSort, updated_at: new Date().toISOString() })
    .eq("id", b.id);
  if (e2) return { ok: false, error: "Could not update your profile display. Please try again." };

  revalidatePath("/my-beacon/rankings");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true, boards: await loadProfileBoards(supabase, user.id) };
}

/** Set how many ranked players show in this board's profile summary. null
 * restores the per-role default (10 primary / 5 secondary). */
export async function setBoardProfileTopN(
  boardId: string,
  value: number | null,
): Promise<BoardsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  if (value !== null && !(PROFILE_TOP_N_CHOICES as readonly number[]).includes(value)) {
    return { ok: false, error: "That is not a valid count." };
  }

  const owned = await requireOwnedBoard(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from(BOARDS_TABLE)
    .update({ profile_top_n: value, updated_at: new Date().toISOString() })
    .eq("id", boardId);
  if (error) {
    return { ok: false, error: "Could not update your profile display. Please try again." };
  }

  revalidatePath("/my-beacon/rankings");
  await revalidateProfileCaches(supabase, user.id);
  return { ok: true, boards: await loadProfileBoards(supabase, user.id) };
}

/** Busts a board's cached Top-N and (when the owner has a Signal) the
 * profile bundle. Shared by the board-editor actions below and by the
 * public revalidateBoardCache action, which is the same work but re-derives
 * the caller and re-checks ownership from scratch for callers that don't
 * already have both in hand. */
async function bustBoardCache(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  boardId: string,
): Promise<void> {
  revalidateTag(boardTag(boardId));
  const handle = await ownerHandle(supabase, userId);
  if (handle) revalidateTag(signalTag(handle));
}

/**
 * Revalidate a single board's cached Top-N and (when the owner has a Signal)
 * the profile bundle. Player-only edits do not bump board.updated_at, so the
 * board:{id} tag is the authoritative bust.
 */
export async function revalidateBoardCache(boardId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Only the owner may trigger a revalidation for their board.
  const { data: board } = await supabase
    .from("user_ranking_boards")
    .select("user_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board || board.user_id !== user.id) return;

  await bustBoardCache(supabase, user.id, boardId);
}

/**
 * Persist the board editor's player list and its tier breaks together, because
 * a break means "a line after rank N" and is only meaningful against the list
 * it was drawn on.
 *
 * Deletes rows removed since the last save, then upserts the rest in board
 * order (rank_position = index + 1, matching what the reader sees). The breaks
 * are normalised against the saved length, so a line that fell off the end of
 * a shortened board is dropped rather than stored. Ownership is re-verified
 * from scratch and every id is validated before it reaches the database; the
 * owner-only RLS policies are the backstop.
 *
 * The board's updated_at moves on every save. The community build counts the
 * MOST RECENTLY CHANGED board per (account, format, scope), so a reorder has
 * to count as a change.
 */
export async function saveBoardPlayers(
  boardId: string,
  removals: string[],
  playerIds: string[],
  tierBreaks: number[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await verifyBoardOwner(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  if (!Array.isArray(removals) || !Array.isArray(playerIds) || !Array.isArray(tierBreaks)) {
    return { ok: false, error: "Could not read your board changes." };
  }
  if (playerIds.length > MAX_BOARD_PLAYERS || removals.length > MAX_BOARD_PLAYERS) {
    return { ok: false, error: "That board has too many players to save." };
  }
  if (!removals.every(isUuid) || !playerIds.every(isUuid)) {
    return { ok: false, error: "Could not read your board changes." };
  }
  if (new Set(playerIds).size !== playerIds.length) {
    return { ok: false, error: "Could not read your board changes." };
  }
  if (tierBreaks.length > 100) {
    return { ok: false, error: "Could not read your tier breaks." };
  }
  const breaks = normalizeTierBreaks(tierBreaks, playerIds.length).breaks;

  if (removals.length > 0) {
    const { error } = await supabase
      .from(BOARD_PLAYERS_TABLE)
      .delete()
      .eq("board_id", boardId)
      .in("player_id", removals);
    if (error) return { ok: false, error: "Could not save your changes. Please try again." };
  }

  const nowIso = new Date().toISOString();
  if (playerIds.length > 0) {
    const rows = playerIds.map((playerId, index) => ({
      board_id: boardId,
      player_id: playerId,
      rank_position: index + 1,
      updated_at: nowIso,
    }));
    const { error } = await supabase
      .from(BOARD_PLAYERS_TABLE)
      .upsert(rows, { onConflict: "board_id,player_id" });
    if (error) return { ok: false, error: "Could not save your changes. Please try again." };
  }

  const { error: boardError } = await supabase
    .from(BOARDS_TABLE)
    .update({ tier_breaks: breaks, updated_at: nowIso })
    .eq("id", boardId);
  if (boardError) return { ok: false, error: "Could not save your changes. Please try again." };

  await bustBoardCache(supabase, user.id, boardId);
  return { ok: true };
}

/**
 * Persist board metadata: name, whether tiers show, custom tier labels, the
 * community opt-out, and (for a board made before boards remembered one) the
 * format it is for. Every field is optional (the editor debounces and
 * coalesces several controls into one patch) and every field present is
 * validated against the same bounds the database enforces, so a bad value
 * fails here with a clear message instead of a raw constraint error.
 */
export async function saveBoardMeta(
  boardId: string,
  patch: {
    name?: string;
    tiersEnabled?: boolean;
    tierLabels?: Record<string, string>;
    communityOptOut?: boolean;
    formatSlug?: string;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await verifyBoardOwner(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  const update: {
    name?: string;
    tiers_enabled?: boolean;
    tier_labels?: Json;
    community_opt_out?: boolean;
    format_config_id?: string;
    updated_at?: string;
  } = {};

  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (name.length === 0 || name.length > MAX_BOARD_NAME_LENGTH) {
      return { ok: false, error: "Give your board a name." };
    }
    update.name = name;
  }
  if (patch.tiersEnabled !== undefined) {
    update.tiers_enabled = Boolean(patch.tiersEnabled);
  }
  if (patch.communityOptOut !== undefined) {
    update.community_opt_out = Boolean(patch.communityOptOut);
  }
  if (patch.formatSlug !== undefined) {
    const provenance = await resolveBoardProvenance(supabase, patch.formatSlug, null);
    if (!provenance) return { ok: false, error: "That is not a format we rank." };
    update.format_config_id = provenance.format.id;
  }
  if (patch.tierLabels !== undefined) {
    if (
      typeof patch.tierLabels !== "object" ||
      patch.tierLabels === null ||
      Array.isArray(patch.tierLabels)
    ) {
      return { ok: false, error: "Could not read your tier labels." };
    }
    const cleanedLabels: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch.tierLabels)) {
      if (!/^[0-9]{1,2}$/.test(key) || typeof value !== "string") {
        return { ok: false, error: "Could not read your tier labels." };
      }
      const label = value.trim().slice(0, 40);
      if (label.length > 0) cleanedLabels[key] = label;
    }
    update.tier_labels = cleanedLabels as unknown as Json;
  }

  if (Object.keys(update).length === 0) return { ok: true };
  update.updated_at = new Date().toISOString();

  const { error } = await supabase.from(BOARDS_TABLE).update(update).eq("id", boardId);
  if (error) return { ok: false, error: "Could not save your changes. Please try again." };

  await bustBoardCache(supabase, user.id, boardId);
  return { ok: true };
}

export type ImportedBoardPlayer = {
  playerId: string;
  tier: number | null;
};

/**
 * Replace the whole board with an imported rankings list: deletes every
 * existing row, then inserts the imported set. The source's published tiers
 * become tier BREAKS (a line wherever the source's tier changes between two
 * neighbours), and the tier labels reset, because a label named for the old
 * tier 2 would now sit on whatever the source put there.
 *
 * The board also records where it came from (plan decision 5): the format the
 * import was for and the source that actually answered, each checked against
 * the registry. A board imported without the builder therefore carries a
 * format and can count toward the community rankings.
 *
 * Returns the final order and breaks, so the client can rebuild its display
 * list (name/position/etc, which this table never stores) without a second
 * round trip.
 */
export async function replaceBoardFromImport(
  boardId: string,
  imported: ImportedBoardPlayer[],
  provenance: { formatSlug: string; sourceSlug: string | null },
): Promise<
  | {
      ok: true;
      order: string[];
      tierBreaks: number[];
      /** True when the source carried tiers that became breaks. */
      importedTiers: boolean;
    }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await verifyBoardOwner(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  if (!Array.isArray(imported)) {
    return { ok: false, error: "Could not read the imported rankings." };
  }
  if (imported.length > MAX_BOARD_PLAYERS) {
    return { ok: false, error: "That import has too many players." };
  }
  const seen = new Set<string>();
  for (const p of imported) {
    if (!isUuid(p?.playerId) || seen.has(p.playerId)) {
      return { ok: false, error: "Could not read the imported rankings." };
    }
    if (p.tier !== null && (!Number.isInteger(p.tier) || p.tier < 1)) {
      return { ok: false, error: "Could not read the imported rankings." };
    }
    seen.add(p.playerId);
  }

  const resolved = await resolveBoardProvenance(
    supabase,
    provenance?.formatSlug,
    provenance?.sourceSlug ?? null,
  );
  if (!resolved) {
    return { ok: false, error: "Could not read the imported rankings." };
  }

  const order = imported.map((p) => p.playerId);
  const hasTiers = imported.some((p) => p.tier !== null);
  const tierBreaks = hasTiers ? breaksFromTiers(imported.map((p) => p.tier)) : [];

  const { error: deleteError } = await supabase
    .from(BOARD_PLAYERS_TABLE)
    .delete()
    .eq("board_id", boardId);
  if (deleteError) {
    return { ok: false, error: "Could not replace the board. Please try again." };
  }

  const nowIso = new Date().toISOString();
  const { error: metaError } = await supabase
    .from(BOARDS_TABLE)
    .update({
      tier_breaks: tierBreaks,
      tier_labels: {},
      format_config_id: resolved.format.id,
      seed_source_slug: resolved.sourceSlug,
      left_off_player_ids: [],
      updated_at: nowIso,
    })
    .eq("id", boardId);
  if (metaError) {
    return { ok: false, error: "Could not replace the board. Please try again." };
  }

  if (order.length > 0) {
    const rows = order.map((playerId, index) => ({
      board_id: boardId,
      player_id: playerId,
      rank_position: index + 1,
      updated_at: nowIso,
    }));
    const { error: insertError } = await supabase.from(BOARD_PLAYERS_TABLE).insert(rows);
    if (insertError) {
      return { ok: false, error: "Could not replace the board. Please try again." };
    }
  }

  await bustBoardCache(supabase, user.id, boardId);
  return { ok: true, order, tierBreaks, importedTiers: tierBreaks.length > 0 };
}

/**
 * Revalidate the current user's profile bundle after the boards manager changes
 * which boards are featured, their order, the primary pick, or a Top-N count.
 */
export async function revalidateMySignal(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  // Bust the bundle AND every board cache: featuring a previously-unfeatured
  // board must invalidate that board's (cached-null) public view, and
  // unfeaturing must invalidate the now-private board view.
  await revalidateProfileCaches(supabase, user.id);
}
