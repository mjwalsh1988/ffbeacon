import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { castGuestVote, parseGuestVoteReply } from "./vote";

describe("parseGuestVoteReply", () => {
  it("reads an inserted vote with the allowance it spent", () => {
    expect(parseGuestVoteReply({ status: "inserted", side: "a", used: 2 })).toEqual({
      ok: true,
      side: "a",
      alreadyVoted: false,
      used: 2,
    });
  });
  it("reads a repeat as the side originally picked", () => {
    expect(parseGuestVoteReply({ status: "already_voted", side: "b", used: 1 })).toEqual({
      ok: true,
      side: "b",
      alreadyVoted: true,
      used: 1,
    });
  });
  it("reads the limit refusal", () => {
    expect(parseGuestVoteReply({ status: "limit_reached", side: null, used: 2 })).toEqual({
      ok: false,
      error: "guest_limit_reached",
      used: 2,
    });
  });
  it("reads a missing trade and treats anything else as a server error", () => {
    expect(parseGuestVoteReply({ status: "not_found" })).toEqual({ ok: false, error: "not_found" });
    expect(parseGuestVoteReply({ status: "inserted" })).toEqual({ ok: false, error: "server_error" });
    expect(parseGuestVoteReply(null)).toEqual({ ok: false, error: "server_error" });
  });
});

describe("castGuestVote", () => {
  it("sends the whole decision to the one database function", async () => {
    const rpc = vi.fn(async () => ({ data: { status: "inserted", side: "a", used: 1 }, error: null }));
    const admin = { rpc } as unknown as SupabaseClient<Database>;
    const out = await castGuestVote(admin, {
      tradeId: "t",
      guestId: "g",
      side: "a",
      actorKey: "ip:x",
      limit: 2,
    });
    expect(rpc).toHaveBeenCalledWith("cast_would_you_rather_guest_vote", {
      p_trade_id: "t",
      p_guest_id: "g",
      p_side: "a",
      p_actor_key: "ip:x",
      p_limit: 2,
    });
    expect(out).toEqual({ ok: true, side: "a", alreadyVoted: false, used: 1 });
  });

  it("is a server error, never a success, when the call fails", async () => {
    const admin = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "nope" } })),
    } as unknown as SupabaseClient<Database>;
    const out = await castGuestVote(admin, { tradeId: "t", guestId: "g", side: "b", actorKey: null, limit: 2 });
    expect(out).toEqual({ ok: false, error: "server_error" });
  });
});
