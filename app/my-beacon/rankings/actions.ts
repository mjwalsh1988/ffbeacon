"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { boardTag, signalTag, revalidateProfileCaches } from "@/lib/signal-profile";
import type { Json } from "@/lib/database.types";
import {
  BOARD_SCOPES,
  MAX_BOARD_NAME_LENGTH,
  MAX_TIERS,
  PROFILE_TOP_N_CHOICES,
  isBoardScope,
  type BoardScope,
  type ProfileBoard,
} from "@/lib/ranking-boards";

export type ActionResult = { ok: true } | { ok: false; error: string };
type BoardsResult =
  | { ok: true; boards: ProfileBoard[] }
  | { ok: false; error: string };

const BOARDS_TABLE = "user_ranking_boards";
const BOARD_PLAYERS_TABLE = "user_ranking_board_players";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Sanity ceiling on how many rows one board-editor save or import can carry.
// The largest real rankings pull is a few hundred players; this leaves room
// without letting a forged payload force an unbounded write.
const MAX_BOARD_PLAYERS = 2000;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isValidTier(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TIERS);
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
      "id, name, scope, profile_visible, profile_is_primary, profile_sort, profile_top_n, user_ranking_board_players(count)",
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
  | { ok: true; tiersEnabled: boolean; tierCount: number }
  | { ok: false; error: string }
> {
  if (!isUuid(boardId)) return { ok: false, error: "Could not find that board." };
  const { data: board } = await supabase
    .from(BOARDS_TABLE)
    .select("user_id, tiers_enabled, tier_count")
    .eq("id", boardId)
    .maybeSingle();
  if (!board || board.user_id !== userId) {
    return { ok: false, error: "Could not find that board." };
  }
  return { ok: true, tiersEnabled: board.tiers_enabled, tierCount: board.tier_count };
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

  const { data, error } = await supabase
    .from(BOARDS_TABLE)
    .insert({ user_id: user.id, name, scope })
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
 * Persist the board editor's player list: delete rows removed since the
 * last save, then upsert the rest in display order (rank_position = index +
 * 1, matching what the reader sees). `players` must already be in the order
 * to persist; ownership is re-verified from scratch, never trusted from the
 * client, and every id and tier value is validated before it reaches the
 * database, the owner-only RLS policies are the backstop.
 */
export async function saveBoardPlayers(
  boardId: string,
  removals: string[],
  players: { playerId: string; tier: number | null }[],
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const owned = await verifyBoardOwner(supabase, user.id, boardId);
  if (!owned.ok) return owned;

  if (!Array.isArray(removals) || !Array.isArray(players)) {
    return { ok: false, error: "Could not read your board changes." };
  }
  if (players.length > MAX_BOARD_PLAYERS || removals.length > MAX_BOARD_PLAYERS) {
    return { ok: false, error: "That board has too many players to save." };
  }
  const cleanRemovals = removals.filter(isUuid);
  if (cleanRemovals.length !== removals.length) {
    return { ok: false, error: "Could not read your board changes." };
  }
  for (const p of players) {
    if (!isUuid(p?.playerId) || !isValidTier(p?.tier)) {
      return { ok: false, error: "Could not read your board changes." };
    }
  }

  if (cleanRemovals.length > 0) {
    const { error } = await supabase
      .from(BOARD_PLAYERS_TABLE)
      .delete()
      .eq("board_id", boardId)
      .in("player_id", cleanRemovals);
    if (error) return { ok: false, error: "Could not save your changes. Please try again." };
  }

  if (players.length > 0) {
    const nowIso = new Date().toISOString();
    const rows = players.map((p, index) => ({
      board_id: boardId,
      player_id: p.playerId,
      rank_position: index + 1,
      tier: owned.tiersEnabled ? p.tier : null,
      updated_at: nowIso,
    }));
    const { error } = await supabase
      .from(BOARD_PLAYERS_TABLE)
      .upsert(rows, { onConflict: "board_id,player_id" });
    if (error) return { ok: false, error: "Could not save your changes. Please try again." };
  }

  await bustBoardCache(supabase, user.id, boardId);
  return { ok: true };
}

/**
 * Persist board metadata: name, whether tiers are on, the tier count, and
 * custom tier labels. Every field is optional (the editor debounces and
 * coalesces several controls into one patch) and every field present is
 * validated against the same bounds the database enforces, so a bad value
 * fails here with a clear message instead of a raw constraint error.
 */
export async function saveBoardMeta(
  boardId: string,
  patch: {
    name?: string;
    tiersEnabled?: boolean;
    tierCount?: number;
    tierLabels?: Record<string, string>;
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
    tier_count?: number;
    tier_labels?: Json;
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
  if (patch.tierCount !== undefined) {
    const tierCount = Number(patch.tierCount);
    if (!Number.isInteger(tierCount) || tierCount < 0 || tierCount > MAX_TIERS) {
      return { ok: false, error: "That is not a valid tier count." };
    }
    update.tier_count = tierCount;
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
      if (!/^[0-9]{1,3}$/.test(key) || typeof value !== "string") {
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
 * Replace the whole board with an imported rankings list: cancels any
 * pending debounced save on the caller's side (the client does that before
 * calling this), deletes every existing row, then inserts the imported set
 * atomically. When the board has tiers on, the source's published tiers are
 * remapped to contiguous board tiers (1..N) and tier_count/tier_labels are
 * reset to match; the CALLER'S current tiers_enabled/tier_count come from the
 * database, never from the client, since they decide whether remapping
 * happens at all.
 *
 * Returns the final persisted order and each player's assigned tier, so the
 * client can rebuild its display list (name/position/etc, which this table
 * never stores) without a second round trip.
 */
export async function replaceBoardFromImport(
  boardId: string,
  imported: ImportedBoardPlayer[],
): Promise<
  | {
      ok: true;
      order: string[];
      tierByPlayer: Record<string, number | null>;
      tierCount: number;
      tierLabels: Record<string, string>;
      /** True when the import actually carried tier data that got remapped
       * (tiers were on AND at least one imported player had a tier). The
       * client uses this to decide whether to overwrite its local tier
       * count / labels, exactly like the announcement copy below. */
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

  // Remap source tiers to contiguous board tiers (1..N) when tiers are on.
  const tiersEnabled = owned.tiersEnabled;
  let tierCount = owned.tierCount;
  let tierLabels: Record<string, string> = {};
  let importedTiers = false;
  const tierByPlayer = new Map<string, number | null>();
  if (tiersEnabled) {
    const distinct = Array.from(
      new Set(imported.map((p) => p.tier).filter((t): t is number => t != null)),
    )
      .sort((a, b) => a - b)
      .slice(0, MAX_TIERS);
    if (distinct.length > 0) {
      const remap = new Map<number, number>();
      distinct.forEach((srcTier, i) => remap.set(srcTier, i + 1));
      imported.forEach((p) =>
        tierByPlayer.set(p.playerId, p.tier != null ? remap.get(p.tier) ?? null : null),
      );
      tierCount = distinct.length;
      importedTiers = true;
    } else {
      imported.forEach((p) => tierByPlayer.set(p.playerId, null));
    }
  }

  // Same traversal order as lib/ranking-boards.ts orderBoardForDisplay: tier
  // 1..tierCount, then everyone else, so the persisted rank_position always
  // means the same thing the board editor and public Top-N reader expect.
  const order: string[] = [];
  if (tiersEnabled) {
    for (let tier = 1; tier <= tierCount; tier += 1) {
      imported.forEach((p) => {
        if (tierByPlayer.get(p.playerId) === tier) order.push(p.playerId);
      });
    }
    imported.forEach((p) => {
      const t = tierByPlayer.get(p.playerId);
      if (t == null || t > tierCount) order.push(p.playerId);
    });
  } else {
    imported.forEach((p) => order.push(p.playerId));
  }

  const { error: deleteError } = await supabase
    .from(BOARD_PLAYERS_TABLE)
    .delete()
    .eq("board_id", boardId);
  if (deleteError) {
    return { ok: false, error: "Could not replace the board. Please try again." };
  }

  if (importedTiers) {
    const { error: metaError } = await supabase
      .from(BOARDS_TABLE)
      .update({ tier_count: tierCount, tier_labels: {}, updated_at: new Date().toISOString() })
      .eq("id", boardId);
    if (metaError) {
      return { ok: false, error: "Could not replace the board. Please try again." };
    }
  }

  if (order.length > 0) {
    const nowIso = new Date().toISOString();
    const rows = order.map((playerId, index) => ({
      board_id: boardId,
      player_id: playerId,
      rank_position: index + 1,
      tier: tiersEnabled ? tierByPlayer.get(playerId) ?? null : null,
      updated_at: nowIso,
    }));
    const { error: insertError } = await supabase.from(BOARD_PLAYERS_TABLE).insert(rows);
    if (insertError) {
      return { ok: false, error: "Could not replace the board. Please try again." };
    }
  }

  await bustBoardCache(supabase, user.id, boardId);
  return {
    ok: true,
    order,
    tierByPlayer: Object.fromEntries(tierByPlayer),
    tierCount,
    tierLabels,
    importedTiers,
  };
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
