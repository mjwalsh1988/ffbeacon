import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/*
 * ingestClosedPolls, the voter-resolution order. A poll is claimed as
 * UNRESOLVED and flipped to resolved only after its voter rows land; a failed
 * upsert falls back to the aggregate totals and flags the trade.
 */

vi.mock("@/lib/discord", () => ({
  fetchWebhookPoll: vi.fn(),
  postWebhookMessage: vi.fn(),
}));
vi.mock("@/lib/discord-poll-voters", () => ({
  fetchPollAnswerVoters: vi.fn(),
  hasDiscordBotToken: vi.fn(() => true),
}));

import { fetchWebhookPoll } from "@/lib/discord";
import { fetchPollAnswerVoters } from "@/lib/discord-poll-voters";
import { ingestClosedPolls, sumDiscordVotes } from "./discord";
import { DEFAULT_WOULD_YOU_RATHER_SETTINGS } from "./default-settings";

type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

function fakeAdmin(opts: { upsertError?: boolean }) {
  const ops: Op[] = [];
  const POLL = {
    id: "poll-1",
    trade_id: "trade-1",
    webhook_id: "wh-1",
    discord_message_id: "m-1",
    discord_channel_id: "c-1",
    answer_id_a: 1,
    answer_id_b: 2,
    closes_at: "2026-09-01T00:00:00.000Z",
  };

  function resolve(op: Op): { data: unknown; error: { message: string } | null } {
    if (op.table === "would_you_rather_discord_polls" && op.op === "select") {
      // The pending sweep, or the recompute's counted-poll read.
      const counted = op.filters.some(([k]) => k === "voters_resolved");
      return counted ? { data: [], error: null } : { data: [POLL], error: null };
    }
    if (op.table === "discord_webhooks") {
      return { data: { url: "https://discord.com/api/webhooks/1/abc", is_active: true }, error: null };
    }
    if (op.table === "would_you_rather_discord_polls" && op.op === "update") {
      return { data: [{ id: "poll-1" }], error: null };
    }
    if (op.table === "would_you_rather_discord_votes" && op.op === "upsert") {
      return opts.upsertError
        ? { data: null, error: { message: "boom" } }
        : { data: [{ id: "v1" }, { id: "v2" }], error: null };
    }
    if (op.table === "would_you_rather_discord_votes" && op.op === "select") {
      return { data: [], error: null };
    }
    return { data: null, error: null };
  }

  function chain(op: Op) {
    const c: Record<string, unknown> = {};
    const self = new Proxy(c, {
      get(_t, prop: string) {
        if (prop === "then") {
          const r = resolve(op);
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(r).then(ok, err);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve(resolve(op));
        }
        return (...args: unknown[]) => {
          if (prop !== "select" || op.op === "select") op.filters.push([prop === "select" ? "_select" : String(args[0]), args[1]]);
          return self;
        };
      },
    });
    return self;
  }

  const admin = {
    from(table: string) {
      const start = (op: string, payload?: unknown) => {
        const rec: Op = { table, op, payload, filters: [] };
        ops.push(rec);
        return chain(rec);
      };
      return {
        select: () => start("select"),
        update: (p: unknown) => start("update", p),
        upsert: (p: unknown) => start("upsert", p),
        delete: () => start("delete"),
        insert: (p: unknown) => start("insert", p),
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient<Database>, ops };
}

beforeEach(() => {
  vi.mocked(fetchWebhookPoll).mockResolvedValue({
    ok: true,
    poll: {
      isFinalized: true,
      counts: new Map([
        [1, 2],
        [2, 1],
      ]),
      raw: {},
    },
  } as never);
  vi.mocked(fetchPollAnswerVoters).mockImplementation(async ({ answerId }) =>
    answerId === 1 ? { ok: true, userIds: ["u1", "u2"] } : { ok: true, userIds: ["u3"] },
  );
});

describe("ingestClosedPolls voter resolution", () => {
  it("claims the poll unresolved, then flips it to resolved once the rows land", async () => {
    const { admin, ops } = fakeAdmin({});
    const out = await ingestClosedPolls(admin, DEFAULT_WOULD_YOU_RATHER_SETTINGS, new Date("2026-09-02T00:00:00Z"));

    const pollUpdates = ops.filter((o) => o.table === "would_you_rather_discord_polls" && o.op === "update");
    const claim = pollUpdates[0].payload as { voters_resolved: boolean };
    expect(claim.voters_resolved).toBe(false);
    expect(pollUpdates.some((o) => (o.payload as { voters_resolved?: boolean }).voters_resolved === true)).toBe(true);
    expect(out.identified).toBe(1);
    expect(ops.some((o) => o.table === "would_you_rather_trades" && (o.payload as { discord_identity_gap?: boolean })?.discord_identity_gap)).toBe(false);
  });

  it("on a failed upsert, never marks the poll resolved, removes its rows and flags the trade", async () => {
    const { admin, ops } = fakeAdmin({ upsertError: true });
    const out = await ingestClosedPolls(admin, DEFAULT_WOULD_YOU_RATHER_SETTINGS, new Date("2026-09-02T00:00:00Z"));

    const pollUpdates = ops.filter((o) => o.table === "would_you_rather_discord_polls" && o.op === "update");
    expect(pollUpdates.some((o) => (o.payload as { voters_resolved?: boolean }).voters_resolved === true)).toBe(false);
    expect(ops.some((o) => o.table === "would_you_rather_discord_votes" && o.op === "delete")).toBe(true);
    expect(
      ops.some(
        (o) =>
          o.table === "would_you_rather_trades" &&
          (o.payload as { discord_identity_gap?: boolean } | undefined)?.discord_identity_gap === true,
      ),
    ).toBe(true);
    expect(out.identified).toBe(0);
    // Falls back to Discord's own totals for this poll.
    expect(out.votesAdded).toBe(3);
  });
});

describe("sumDiscordVotes", () => {
  it("adds both sides across trades and ignores nulls", () => {
    expect(
      sumDiscordVotes([
        { discord_votes_a: 3, discord_votes_b: 4 },
        { discord_votes_a: null, discord_votes_b: 2 },
      ]),
    ).toBe(9);
  });
});
