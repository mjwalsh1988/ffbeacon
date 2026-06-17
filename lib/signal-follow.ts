import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Server-only read layer for the Signal follow graph (Phase 8).
 *
 * The follower COUNT is the denormalized signals.follower_count, maintained by
 * the AFTER INSERT/DELETE trigger in migration 0063. It is read FRESH here on
 * the dynamic profile render rather than baked into the unstable_cache profile
 * bundle: follows are written by arbitrary signed-in users, so caching the count
 * in the bundle would either go stale or force a cache bust on every stranger's
 * follow (the same lesson as Wall reactions). A single indexed row read is cheap.
 *
 * loadFollowState also reports whether the current viewer follows this profile,
 * for the toggle's aria-pressed state. We read with the service-role client and
 * feed it the viewer id resolved from the authenticated session (never a
 * client-supplied id), mirroring loadReactionsForTargets.
 */

export type FollowState = {
  followerCount: number;
  viewerIsFollowing: boolean;
};

export async function loadFollowState(
  profileUserId: string,
  viewerUserId: string | null,
): Promise<FollowState> {
  const supabase = createAdminClient();

  const { data: signal } = await supabase
    .from("signals")
    .select("follower_count")
    .eq("user_id", profileUserId)
    .maybeSingle();
  const followerCount = signal?.follower_count ?? 0;

  let viewerIsFollowing = false;
  // No self-follow exists (DB CHECK), so skip the lookup on your own profile.
  if (viewerUserId && viewerUserId !== profileUserId) {
    const { data } = await supabase
      .from("signal_follows")
      .select("follower_user_id")
      .eq("follower_user_id", viewerUserId)
      .eq("followee_user_id", profileUserId)
      .maybeSingle();
    viewerIsFollowing = !!data;
  }

  return { followerCount, viewerIsFollowing };
}
