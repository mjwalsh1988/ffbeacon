import "server-only";

/**
 * Who is voting.
 *
 * A signed-in reader votes as their auth user id, so the vote follows them
 * across devices and the "one vote per trade" index means exactly that. A
 * signed-out visitor votes as a guest id kept in an httpOnly cookie, which is
 * what the free-trial allowance counts.
 *
 * THE ALLOWANCE IS COUNTED AGAINST TWO THINGS, WHICHEVER IS HIGHER.
 *
 * The cookie alone was not enough, and a security review demonstrated why: a
 * caller who simply sends no cookie is minted a fresh guest id on every
 * request, so their count is always zero and the wall never arrives. The only
 * thing left between that caller and the public tally was a per-IP rate limit,
 * which permits tens of thousands of votes a day at a trade whose id /next
 * hands straight back.
 *
 * So the count is `max(votes for this cookie, votes for this actor)`, where the
 * actor is the server-derived `user:<uuid>` or `ip:<salted sha256>` from
 * lib/rate-limit-actor.ts. It is never read from the request, so a caller
 * cannot choose it, and throwing the cookie away now buys nothing. This is the
 * same shape as the Signal Scout guest cap, which takes the max of a cookie
 * count and an IP count for the same reason.
 *
 * UNIQUENESS STAYS ON THE COOKIE, NOT THE ACTOR. Two people behind one office
 * NAT share an actor and are still two people. Making the actor a uniqueness
 * key would show the second of them the first one's reveal, for a side they did
 * not pick. They share an allowance, which is a cost worth paying; they do not
 * share a vote, which would not be.
 *
 * The cookie is httpOnly, so page JavaScript cannot read or forge it, and the
 * id is a server-minted uuid rather than anything derived from the request.
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";

type Client = SupabaseClient<Database>;

export const WYR_GUEST_COOKIE = "ffbeacon.wyr_guest";
export const WYR_GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const WYR_GUEST_COOKIE_OPTIONS = {
  path: "/" as const,
  maxAge: WYR_GUEST_COOKIE_MAX_AGE,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  httpOnly: true,
};

const uuidSchema = z.string().uuid();

export type WyrVoter =
  | { kind: "user"; userId: string; guestId: null }
  | { kind: "guest"; userId: null; guestId: string };

export interface ResolvedVoter {
  voter: WyrVoter;
  /**
   * Non-null only when a fresh guest id was minted on this request, so the
   * calling route knows to set the cookie on ITS OWN response. Route handlers
   * cannot write cookies through next/headers.
   */
  mintedGuestId: string | null;
}

/** Read one cookie off a raw Request. Route handlers here take plain Requests. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Session first, then the guest cookie, then a freshly minted guest id. */
export async function resolveVoter(req: Request): Promise<ResolvedVoter> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return { voter: { kind: "user", userId: user.id, guestId: null }, mintedGuestId: null };
  }

  const existing = readCookie(req, WYR_GUEST_COOKIE);
  if (existing && uuidSchema.safeParse(existing).success) {
    return { voter: { kind: "guest", userId: null, guestId: existing }, mintedGuestId: null };
  }

  const minted = randomUUID();
  return { voter: { kind: "guest", userId: null, guestId: minted }, mintedGuestId: minted };
}

/**
 * The same resolution from a Server Component, where there is no Request.
 *
 * Deliberately does NOT mint. A Server Component cannot set a cookie, so
 * minting here would hand back an id that is forgotten the moment the response
 * is sent, and the first vote would then be attributed to a different guest
 * than the page thought it was rendering for. A visitor with no cookie yet is
 * simply a guest with no votes on record; the first vote route call mints and
 * sets the cookie.
 */
export async function readVoter(): Promise<WyrVoter | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return { kind: "user", userId: user.id, guestId: null };

  const store = await cookies();
  const existing = store.get(WYR_GUEST_COOKIE)?.value ?? null;
  if (existing && uuidSchema.safeParse(existing).success) {
    return { kind: "guest", userId: null, guestId: existing };
  }
  return null;
}

/**
 * How many votes a guest has already spent. Always 0 for a signed-in reader.
 *
 * The higher of the two counts, for the reason in the module header: a cookie
 * count alone resets to zero the moment the cookie is discarded. Both reads are
 * indexed and go out together.
 */
export async function guestVotesUsed(
  admin: Client,
  voter: WyrVoter | null,
  actorKey: string | null,
): Promise<number> {
  if (!voter || voter.kind !== "guest") return 0;

  const [byCookie, byActor] = await Promise.all([
    admin
      .from("would_you_rather_votes")
      .select("id", { count: "exact", head: true })
      .eq("guest_id", voter.guestId),
    actorKey
      ? admin
          .from("would_you_rather_votes")
          .select("id", { count: "exact", head: true })
          .eq("actor_key", actorKey)
      : Promise.resolve({ count: 0 }),
  ]);

  return Math.max(byCookie.count ?? 0, byActor.count ?? 0);
}

/**
 * The server-derived actor for this request.
 *
 * Wraps `resolveRateLimitActorKey`, which reads the session cookie and the
 * platform's own forwarding headers and refuses the client-controlled leftmost
 * x-forwarded-for entry. Returns null only when the derivation itself fails,
 * and a null actor falls back to the cookie count rather than opening the gate.
 */
export async function resolveActorKey(req: Request): Promise<string | null> {
  try {
    return await resolveRateLimitActorKey(req);
  } catch {
    return null;
  }
}

/**
 * Votes left in the free trial.
 *
 * Null for a signed-in reader, which is what the UI reads as "no limit applies"
 * rather than "no votes left". The two must not be confused, so the absence is
 * typed rather than encoded as a large number.
 */
export function guestVotesRemaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}
