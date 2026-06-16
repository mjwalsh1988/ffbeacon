"use server";

import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { boardTag, signalTag, revalidateProfileCaches } from "@/lib/signal-profile";

/**
 * Cache-invalidation actions for the My Rankings surfaces. Board content and
 * board metadata are read on the public profile through tag-cached functions
 * (board:{id} for a board's Top-N, signal:{handle} for the profile bundle), so
 * the client editors call these after a successful write to bust exactly the
 * affected caches. Writes themselves still go through the browser client under
 * owner-only RLS; these actions only revalidate, and they re-verify ownership
 * before touching a board tag.
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

/**
 * Revalidate a single board's cached Top-N and (when the owner has a Signal)
 * the profile bundle, after the board editor saves. Player-only edits do not
 * bump board.updated_at, so the board:{id} tag is the authoritative bust.
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

  revalidateTag(boardTag(boardId));
  const handle = await ownerHandle(supabase, user.id);
  if (handle) revalidateTag(signalTag(handle));
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
