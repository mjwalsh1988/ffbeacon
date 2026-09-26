import "server-only";

/**
 * Who a signed-out Beacon Ranker reader is (plan section 8).
 *
 * A guest board is keyed by an httpOnly cookie holding a server-minted uuid,
 * the Would You Rather pattern: page JavaScript cannot read or forge it, and
 * the id is never derived from anything in the request. There is no public URL
 * for a guest board; it is reachable only through this cookie, only on the
 * server, and only through the service-role client (the table has no anon or
 * authenticated policy at all, migration 0308).
 *
 * Minting happens in a server action, which CAN set a cookie. A Server
 * Component reading the page never mints: it cannot set the cookie, and an id
 * forgotten the moment the response is sent would orphan the first answer.
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export const RANKER_GUEST_COOKIE = "ffbeacon.ranker_guest";

/** The cookie outlives the board on purpose: an expired board behind a live
 * cookie is a no-op, while a cookie that expired first would orphan a board
 * the page promised to keep for the full retention window. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The guest id from the cookie, or null. Safe in a Server Component. */
export async function readGuestId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(RANKER_GUEST_COOKIE)?.value ?? null;
  return value && UUID_RE.test(value) ? value : null;
}

/** The guest id, minting and setting the cookie when there is none. Server
 * actions and route handlers only. */
export async function ensureGuestId(): Promise<string> {
  const existing = await readGuestId();
  if (existing) return existing;
  const minted = randomUUID();
  const store = await cookies();
  store.set(RANKER_GUEST_COOKIE, minted, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  });
  return minted;
}

/** Forget the guest: after a claim, or when a guest starts over. */
export async function clearGuestCookie(): Promise<void> {
  const store = await cookies();
  store.delete(RANKER_GUEST_COOKIE);
}

/**
 * Delete every guest board that has gone unchanged for `retentionHours`. One
 * indexed delete (idx_ranking_guest_boards_updated). Returns how many went.
 */
export async function deleteExpiredGuestBoards(
  admin: SupabaseClient<Database>,
  retentionHours: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionHours * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("ranking_guest_boards")
    .delete()
    .lt("updated_at", cutoff)
    .select("id");
  if (error) throw new Error(`guest board cleanup failed: ${error.message}`);
  return data?.length ?? 0;
}

/** When a guest board will be deleted, from its last change. */
export function guestBoardExpiresAt(updatedAt: string, retentionHours: number): Date {
  return new Date(new Date(updatedAt).getTime() + retentionHours * 3_600_000);
}
