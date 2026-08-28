/**
 * Writing a vote.
 *
 * A VOTE IS NEVER COUNTED TWICE, AND THE DATABASE IS WHAT GUARANTEES IT.
 * The insert is attempted, and a unique-violation (Postgres 23505 against
 * uq_wyr_votes_user or uq_wyr_votes_guest) is read as "already voted" rather
 * than as an error. That ordering matters: a "have they voted?" SELECT followed
 * by an INSERT is a race, and two clicks a few milliseconds apart would both
 * pass the check. Letting the index decide closes it, and costs one round trip
 * instead of two.
 *
 * A repeat vote is not an error to the reader either. They get the reveal for
 * the side they originally picked, with `alreadyVoted` set, so a double tap or
 * a back-button revisit shows the same screen rather than a failure.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { WyrSide } from "./types";
import type { WyrVoter } from "./identity";

type Client = SupabaseClient<Database>;

export type CastVoteResult =
  | { ok: true; side: WyrSide; alreadyVoted: boolean }
  | { ok: false; error: "not_found" | "server_error" };

/** Postgres unique violation. */
const UNIQUE_VIOLATION = "23505";
/** Postgres foreign key violation: the trade id does not exist. */
const FOREIGN_KEY_VIOLATION = "23503";

export async function castVote(
  admin: Client,
  params: {
    tradeId: string;
    voter: WyrVoter;
    side: WyrSide;
    /**
     * The server-derived actor, stored so the free-vote allowance can be
     * counted against something a caller cannot discard. Never a uniqueness
     * key: see the header of lib/would-you-rather/identity.ts.
     */
    actorKey: string | null;
  },
): Promise<CastVoteResult> {
  const { tradeId, voter, side, actorKey } = params;

  const { error } = await admin.from("would_you_rather_votes").insert({
    trade_id: tradeId,
    user_id: voter.kind === "user" ? voter.userId : null,
    guest_id: voter.kind === "guest" ? voter.guestId : null,
    side,
    actor_key: actorKey,
  });

  if (!error) return { ok: true, side, alreadyVoted: false };

  if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, error: "not_found" };

  if (error.code === UNIQUE_VIOLATION) {
    // Already voted. Read back which side they actually picked, because the
    // reveal has to show THEIR call, not the one they just tried to make.
    const existing = await readExistingVote(admin, tradeId, voter);
    return existing
      ? { ok: true, side: existing, alreadyVoted: true }
      : { ok: false, error: "server_error" };
  }

  console.error("[would-you-rather] vote insert failed", error.message);
  return { ok: false, error: "server_error" };
}

/** The side this voter already chose on this trade, if any. */
export async function readExistingVote(
  admin: Client,
  tradeId: string,
  voter: WyrVoter,
): Promise<WyrSide | null> {
  let query = admin
    .from("would_you_rather_votes")
    .select("side")
    .eq("trade_id", tradeId)
    .limit(1);
  query =
    voter.kind === "user"
      ? query.eq("user_id", voter.userId)
      : query.eq("guest_id", voter.guestId);
  const { data } = await query.maybeSingle();
  const side = data?.side;
  return side === "a" || side === "b" ? side : null;
}
