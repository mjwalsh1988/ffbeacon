"use server";

/**
 * The only writer of the reader's saved Sleeper identity.
 *
 * A handle is REFUSED unless Sleeper resolves it. That is a change from the
 * two client-side forms this replaces, which saved any string a reader typed;
 * a handle that does not exist is a handle every tool then fails on, silently,
 * on every future visit. Resolving it here also buys the three things D3 is
 * about: the Sleeper user id (so a tool page spends one Sleeper call per visit
 * instead of two), the display name (so the deep views can match a roster by
 * id rather than by a display name that may differ from the username), and the
 * avatar (so the identity card has a face without a network call).
 *
 * WHO IS WRITTEN, AND WITH WHICH CLIENT
 *   The user is established from the reader's OWN session (`auth.getUser()`
 *   on the cookie client) and nothing in the request can name another one.
 *   The write itself goes through `lib/sleeper-league-settings-write.ts` with
 *   the service role, because migration 0323 takes the column's INSERT and
 *   UPDATE grants away from `authenticated`. That grant is what let an owner
 *   PATCH an unverified Sleeper id into this jsonb and skip everything below;
 *   with it gone, this action is the only way a handle gets in.
 */

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { getSleeperUser } from "@/lib/sleeper";
import { writeSleeperLeagueSettings } from "@/lib/sleeper-league-settings-write";
import {
  INVALID_HANDLE_MESSAGE,
  normalizeSleeperHandle,
} from "@/lib/sleeper-handle/validate";
import type { SavedSleeperHandle } from "@/lib/sleeper-handle/types";

const RATE_BUCKET = "sleeper_handle_save";
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX = 6;

/** The cached pages that render the reader's saved handle. */
const IDENTITY_SURFACES = [
  "/my-beacon",
  "/my-beacon/sleeper-leagues",
  "/my-beacon/profile",
] as const;

export type SaveHandleFailure =
  "invalid" | "not-found" | "rate-limited" | "signed-out" | "failed";

export type SaveHandleResult =
  | { ok: true; handle: SavedSleeperHandle }
  | { ok: false; error: string; reason: SaveHandleFailure };

/** Fails closed: a limit we cannot evaluate is not a limit that passes. */
async function claimSlot(): Promise<boolean> {
  try {
    const requestHeaders = await headers();
    const actorKey = await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/sleeper-handle", {
        headers: requestHeaders,
      }),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "try_claim_rate_limit" as never,
      {
        p_bucket: RATE_BUCKET,
        p_key: actorKey,
        p_max_requests: RATE_MAX,
        p_window_seconds: RATE_WINDOW_SECONDS,
      } as never,
    );
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[sleeper-handle] rate-limit check failed", err);
    return false;
  }
}

/**
 * Re-render the surfaces that name the reader's Sleeper identity.
 *
 * Deliberately NOT `revalidatePath("/", "layout")`. That purges the route cache
 * and the data cache for the whole site, and at six saves a minute per account
 * it is enough to keep every cached page permanently cold. It also buys nothing
 * here: every page that renders the identity card is already `force-dynamic`,
 * and the form calls `router.refresh()` for the tab the reader is looking at.
 *
 * What is left is the small set of pages that DO cache and DO read the handle.
 */
function revalidateIdentitySurfaces(): void {
  for (const path of IDENTITY_SURFACES) {
    try {
      revalidatePath(path);
    } catch {
      // A revalidate that fails is a stale page, never a failed save.
    }
  }
}

/**
 * Validate, rate limit, resolve on Sleeper, then read-merge-write the jsonb.
 *
 * The order matters. Validation is first because a malformed string must gain
 * an attacker nothing and must not cost a real reader a slot. The rate limit
 * is before the Sleeper call because that call is the expensive half and the
 * one the site-wide budget in `lib/sleeper-budget.ts` cares about.
 */
export async function saveSleeperHandle(input: {
  username: string;
}): Promise<SaveHandleResult> {
  const username = normalizeSleeperHandle(input?.username);
  if (!username) {
    return { ok: false, reason: "invalid", error: INVALID_HANDLE_MESSAGE };
  }

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return {
      ok: false,
      reason: "signed-out",
      error: "Sign in first, then save your Sleeper username.",
    };
  }

  if (!(await claimSlot())) {
    return {
      ok: false,
      reason: "rate-limited",
      error: "Slow down a moment and try that again.",
    };
  }

  let sleeperUser: Awaited<ReturnType<typeof getSleeperUser>> = null;
  try {
    sleeperUser = await getSleeperUser(username);
  } catch {
    sleeperUser = null;
  }
  if (!sleeperUser?.user_id) {
    // The message quotes the NORMALIZED handle, never the raw input, so
    // nothing a caller typed is echoed back onto a page.
    return {
      ok: false,
      reason: "not-found",
      error: `Sleeper has no account called "${username}". Check the spelling and try again.`,
    };
  }

  const handle: SavedSleeperHandle = {
    username,
    sleeperUserId: sleeperUser.user_id,
    displayName: sleeperUser.display_name ?? null,
    avatar: sleeperUser.avatar ?? null,
    verifiedAt: new Date().toISOString(),
  };

  // Read-merge-write inside the writer, so the sibling keys in this jsonb
  // (featured_league_id, shown_league_ids, signal_league_ids) survive.
  const saved = await writeSleeperLeagueSettings(authUser.id, {
    username: handle.username,
    sleeper_user_id: handle.sleeperUserId,
    sleeper_display_name: handle.displayName,
    sleeper_avatar: handle.avatar,
    handle_verified_at: handle.verifiedAt,
  });
  if (!saved.ok) {
    return {
      ok: false,
      reason: "failed",
      error: "We could not save that just now. Try again in a moment.",
    };
  }

  revalidateIdentitySurfaces();

  return { ok: true, handle };
}

/** Clears the five identity keys. Same client, same rate bucket. */
export async function clearSleeperHandle(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return { ok: false, error: "Sign in first." };
  }

  if (!(await claimSlot())) {
    return { ok: false, error: "Slow down a moment and try that again." };
  }

  const cleared = await writeSleeperLeagueSettings(authUser.id, {
    username: null,
    sleeper_user_id: null,
    sleeper_display_name: null,
    sleeper_avatar: null,
    handle_verified_at: null,
  });
  if (!cleared.ok) {
    return { ok: false, error: "We could not clear that just now." };
  }

  revalidateIdentitySurfaces();
  return { ok: true };
}
