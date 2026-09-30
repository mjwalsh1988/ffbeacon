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

export type CastGuestVoteResult =
  | { ok: true; side: WyrSide; alreadyVoted: boolean; used: number }
  | { ok: false; error: "guest_limit_reached"; used: number }
  | { ok: false; error: "not_found" | "server_error" };

/**
 * A guest's vote, with the free-vote allowance checked and spent in the SAME
 * database transaction (migration 0326, cast_would_you_rather_guest_vote).
 *
 * The route used to count a guest's votes and then insert, and five votes
 * fired in parallel all passed the count before any of them landed. The
 * function takes a per-guest and a per-actor advisory lock, counts
 * max(by cookie, by actor) and inserts under them, so the second of two
 * parallel votes sees the first. The unique indexes still decide "already
 * voted" exactly as they do for `castVote`; a repeat spends nothing.
 *
 * `used` is the allowance spent INCLUDING this vote when it landed, which is
 * what the route reports back as the remaining count.
 */
export async function castGuestVote(
  admin: Client,
  params: {
    tradeId: string;
    guestId: string;
    side: WyrSide;
    actorKey: string | null;
    limit: number;
  },
): Promise<CastGuestVoteResult> {
  // Untyped: the function arrives with migration 0326, ahead of regenerated types.
  const { data, error } = await (admin as unknown as SupabaseClient).rpc(
    "cast_would_you_rather_guest_vote",
    {
      p_trade_id: params.tradeId,
      p_guest_id: params.guestId,
      p_side: params.side,
      p_actor_key: params.actorKey,
      p_limit: params.limit,
    },
  );
  if (error) {
    // The function not existing yet (the code deployed before migration 0326)
    // falls back to the plain insert, which is exactly what guest votes did
    // before, so a deploy ordering slip costs the atomic cap rather than every
    // guest vote on the site.
    if (error.code === "PGRST202" || error.code === "42883") {
      const cast = await castVote(admin, {
        tradeId: params.tradeId,
        voter: { kind: "guest", userId: null, guestId: params.guestId },
        side: params.side,
        actorKey: params.actorKey,
      });
      if (!cast.ok) return cast;
      const { count } = await admin
        .from("would_you_rather_votes")
        .select("id", { count: "exact", head: true })
        .eq("guest_id", params.guestId);
      return { ...cast, used: count ?? 0 };
    }
    console.error("[would-you-rather] guest vote failed", error.message);
    return { ok: false, error: "server_error" };
  }
  return parseGuestVoteReply(data);
}

/** Read the function's jsonb reply. Anything unexpected is a server error. */
export function parseGuestVoteReply(data: unknown): CastGuestVoteResult {
  const reply = (data ?? {}) as { status?: unknown; side?: unknown; used?: unknown };
  const used = typeof reply.used === "number" && Number.isFinite(reply.used) ? reply.used : 0;
  const side = reply.side === "a" || reply.side === "b" ? reply.side : null;
  switch (reply.status) {
    case "inserted":
      return side ? { ok: true, side, alreadyVoted: false, used } : { ok: false, error: "server_error" };
    case "already_voted":
      return side ? { ok: true, side, alreadyVoted: true, used } : { ok: false, error: "server_error" };
    case "limit_reached":
      return { ok: false, error: "guest_limit_reached", used };
    case "not_found":
      return { ok: false, error: "not_found" };
    default:
      return { ok: false, error: "server_error" };
  }
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
