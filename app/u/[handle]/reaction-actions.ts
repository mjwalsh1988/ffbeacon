"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Reaction server actions for the Signal Wall (Phase 4f COMMIT 2). Like comments,
 * reactions are written by ANY signed-in user, so these run through the caller's
 * session client and the own-row RLS on signal_reactions (migration 0075):
 *
 *   - addReaction inserts the caller's own row. The insert RLS additionally
 *     requires the target to be publicly viewable AND the reaction type to be
 *     active. The unique(target_type, target_id, reaction_type_id, user_id)
 *     constraint makes a double-react a harmless no-op (we map 23505 to success
 *     so the toggle is idempotent).
 *   - removeReaction deletes the caller's own row (toggle off). Deleting a row
 *     that is not there affects zero rows and is treated as success.
 *
 * The denormalized signal_reaction_counts table is maintained by the AFTER
 * INSERT/DELETE trigger, so these actions never touch counts directly. The Wall is
 * dynamic, so the client repaints with router.refresh() after a successful write;
 * there is NO profile-cache bust (matches the comments/GIF/emoji cache decision).
 */

export type ReactionActionResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

const TARGET_TYPES = new Set(["post", "comment"]);

function validArgs(
  targetType: string,
  targetId: string,
  reactionTypeId: string,
): boolean {
  return (
    TARGET_TYPES.has(targetType) &&
    typeof targetId === "string" &&
    targetId.length > 0 &&
    typeof reactionTypeId === "string" &&
    reactionTypeId.length > 0
  );
}

export async function addReaction(
  targetType: string,
  targetId: string,
  reactionTypeId: string,
): Promise<ReactionActionResult> {
  if (!validArgs(targetType, targetId, reactionTypeId)) {
    return { ok: false, error: "Could not add that reaction." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to react." };
  }

  const { error } = await supabase.from("signal_reactions").insert({
    target_type: targetType,
    target_id: targetId,
    reaction_type_id: reactionTypeId,
    user_id: user.id,
  });
  if (error) {
    // Already reacted (unique violation): the toggle-on is a no-op success.
    if (error.code === "23505") return { ok: true };
    // RLS with-check failure: target not publicly viewable, or type inactive.
    if (
      error.code === "42501" ||
      (error.message ?? "").includes("row-level security")
    ) {
      return { ok: false, error: "You cannot react to this." };
    }
    return {
      ok: false,
      error: "Could not add that reaction. Please try again.",
    };
  }

  return { ok: true };
}

export async function removeReaction(
  targetType: string,
  targetId: string,
  reactionTypeId: string,
): Promise<ReactionActionResult> {
  if (!validArgs(targetType, targetId, reactionTypeId)) {
    return { ok: false, error: "Could not remove that reaction." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to manage reactions." };
  }

  // RLS delete-own scopes this to the caller; match user_id too so a guessed id
  // on someone else's reaction affects zero rows. A missing row is a no-op.
  const { error } = await supabase
    .from("signal_reactions")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("reaction_type_id", reactionTypeId)
    .eq("user_id", user.id);
  if (error) {
    return {
      ok: false,
      error: "Could not remove that reaction. Please try again.",
    };
  }

  return { ok: true };
}
