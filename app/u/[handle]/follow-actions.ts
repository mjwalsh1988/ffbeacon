"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { signalMediaUrl } from "@/lib/signal-profile";

/**
 * Follow server actions for Signal profiles (Phase 8). Follows are written by
 * ANY signed-in user, so these run through the caller's session client and the
 * own-row RLS on signal_follows (migration 0063):
 *
 *   - followProfile inserts the caller's own row. follower_user_id is always the
 *     authenticated user id (never client-supplied); the followee comes from the
 *     profile being viewed. The PK (follower, followee) makes a double-follow a
 *     harmless no-op (23505 mapped to success so the toggle is idempotent), and
 *     the CHECK (follower <> followee) blocks self-follow (23514 surfaced gently).
 *   - unfollowProfile deletes the caller's own row (toggle off). A missing row
 *     affects zero rows and is treated as success.
 *
 * The denormalized signals.follower_count is maintained by the AFTER trigger, so
 * these never touch the count directly. The profile is dynamic and reads the
 * count fresh, so the client repaints with router.refresh() after a write; there
 * is NO profile-cache bust (a stranger's follow must not invalidate the owner's
 * cached bundle, matching the Wall reactions decision).
 *
 * loadFollowList powers the authenticated-only follower/following modal.
 */

export type FollowActionResult =
  | { ok: true }
  | { ok: false; error: string; needsAuth?: boolean };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Light, best-effort in-memory throttle. Serverless instances are per-process so
// this is not a hard guarantee (durable state is bounded by the (follower,
// followee) primary key regardless); it just dampens rapid follow/unfollow
// toggling against the count trigger, consistent with the GIF route's posture.
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 12;
const attempts = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_IN_WINDOW) {
    attempts.set(userId, recent);
    return true;
  }
  recent.push(now);
  attempts.set(userId, recent);
  // Opportunistic eviction so the map cannot grow without bound.
  if (attempts.size > 5000) {
    for (const [key, times] of attempts) {
      if (times.every((t) => now - t >= WINDOW_MS)) attempts.delete(key);
    }
  }
  return false;
}

export async function followProfile(
  followeeUserId: string,
): Promise<FollowActionResult> {
  if (typeof followeeUserId !== "string" || !UUID_RE.test(followeeUserId)) {
    return { ok: false, error: "Could not follow this profile." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to follow." };
  }
  if (user.id === followeeUserId) {
    return { ok: false, error: "You cannot follow yourself." };
  }
  if (rateLimited(user.id)) {
    return { ok: false, error: "You are doing that too fast. Please wait a moment." };
  }

  const { error } = await supabase.from("signal_follows").insert({
    follower_user_id: user.id,
    followee_user_id: followeeUserId,
  });
  if (error) {
    // Already following (PK violation): toggle-on is an idempotent no-op.
    if (error.code === "23505") return { ok: true };
    // CHECK (follower <> followee): self-follow blocked at the DB.
    if (error.code === "23514") {
      return { ok: false, error: "You cannot follow yourself." };
    }
    // FK violation: the followee is not a real user.
    if (error.code === "23503") {
      return { ok: false, error: "That profile could not be found." };
    }
    if (
      error.code === "42501" ||
      (error.message ?? "").includes("row-level security")
    ) {
      return { ok: false, error: "You cannot follow this profile." };
    }
    return { ok: false, error: "Could not follow. Please try again." };
  }

  return { ok: true };
}

export async function unfollowProfile(
  followeeUserId: string,
): Promise<FollowActionResult> {
  if (typeof followeeUserId !== "string" || !UUID_RE.test(followeeUserId)) {
    return { ok: false, error: "Could not unfollow this profile." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to manage follows." };
  }
  if (rateLimited(user.id)) {
    return { ok: false, error: "You are doing that too fast. Please wait a moment." };
  }

  // RLS delete-own scopes this to the caller; match follower_user_id too so a
  // guessed followee on someone else's row affects zero rows. Missing row = no-op.
  const { error } = await supabase
    .from("signal_follows")
    .delete()
    .eq("follower_user_id", user.id)
    .eq("followee_user_id", followeeUserId);
  if (error) {
    return { ok: false, error: "Could not unfollow. Please try again." };
  }

  return { ok: true };
}

export type FollowListEntry = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

export type FollowListResult =
  | { ok: true; entries: FollowListEntry[]; truncated: boolean }
  | { ok: false; error: string; needsAuth?: boolean };

const FOLLOW_LIST_LIMIT = 100;

/**
 * Authenticated-only follower/following list for a profile (anon sees only the
 * count). Returns ONLY users who have a live (published + public + not hidden)
 * Signal, so a private or draft handle is never exposed through the graph; those
 * users still contribute to follower_count but are omitted from the list. The
 * action is gated on a session before any read.
 */
export async function loadFollowList(
  profileUserId: string,
  kind: "followers" | "following",
): Promise<FollowListResult> {
  if (typeof profileUserId !== "string" || !UUID_RE.test(profileUserId)) {
    return { ok: false, error: "Could not load that list." };
  }
  if (kind !== "followers" && kind !== "following") {
    return { ok: false, error: "Could not load that list." };
  }

  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) {
    return { ok: false, needsAuth: true, error: "Sign in to see this list." };
  }

  const supabase = createAdminClient();
  const selectCol =
    kind === "followers" ? "follower_user_id" : "followee_user_id";
  const matchCol =
    kind === "followers" ? "followee_user_id" : "follower_user_id";

  const { data: rows, error } = await supabase
    .from("signal_follows")
    .select(selectCol)
    .eq(matchCol, profileUserId)
    .order("created_at", { ascending: false })
    .limit(FOLLOW_LIST_LIMIT + 1);
  if (error) {
    return { ok: false, error: "Could not load that list. Please try again." };
  }

  const ids = (rows ?? [])
    .map((r) => (r as Record<string, string>)[selectCol])
    .filter((id): id is string => typeof id === "string");
  const truncated = ids.length > FOLLOW_LIST_LIMIT;
  const pageIds = ids.slice(0, FOLLOW_LIST_LIMIT);
  if (pageIds.length === 0) {
    return { ok: true, entries: [], truncated: false };
  }

  // Only live profiles are linkable/visible. The admin client bypasses RLS, so
  // the live predicate is applied explicitly here.
  const { data: signals } = await supabase
    .from("signals")
    .select("user_id, handle, display_name, avatar_path")
    .in("user_id", pageIds)
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("hidden", false);

  const byUser = new Map(
    (signals ?? []).map((s) => [
      s.user_id,
      {
        handle: s.handle,
        displayName: s.display_name,
        avatarUrl: signalMediaUrl(s.avatar_path),
      } satisfies FollowListEntry,
    ]),
  );

  // Preserve the follow recency order from signal_follows.
  const entries: FollowListEntry[] = [];
  for (const id of pageIds) {
    const entry = byUser.get(id);
    if (entry) entries.push(entry);
  }

  return { ok: true, entries, truncated };
}
