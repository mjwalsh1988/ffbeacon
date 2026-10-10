import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

vi.mock("@/lib/discord", () => ({ postWebhookMessage: vi.fn() }));
vi.mock("./render", () => ({
  renderWriteup: vi.fn(() => ({ message: { content: "hi" }, pollMessage: null, dropped: [] })),
  renderPlainText: vi.fn(() => "hi"),
}));

import { postWebhookMessage } from "@/lib/discord";
import { claimAndSend, releaseStaleClaims, STALE_CLAIM_MS } from "./post";
import { renderWriteup } from "./render";

type Op = { op: string; payload?: unknown; filters: Array<[string, unknown[]]> };

/** A chain-recording fake for league_relay_posts and discord_webhooks. */
function fakeAdmin(respond: (op: Op) => { data: unknown; error: { message: string; code?: string } | null }) {
  const ops: Op[] = [];
  const make = (op: Op) => {
    const target: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(target, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(respond(op)).then(ok, err);
        }
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(respond(op));
        return (...args: unknown[]) => {
          op.filters.push([prop, args]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  const admin = {
    from(table: string) {
      const start = (op: string, payload?: unknown) => {
        const rec: Op = { op: `${table}.${op}`, payload, filters: [] };
        ops.push(rec);
        return make(rec);
      };
      return {
        insert: (p: unknown) => start("insert", p),
        update: (p: unknown) => start("update", p),
        delete: () => start("delete"),
        select: () => start("select"),
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient<Database>, ops };
}

const CHANNEL = { webhook_id: "wh", mention_role_ids: [], poll: false, poll_hours: 24 } as never;
const params = {
  leagueId: "league",
  messageType: "trade" as const,
  dedupeKey: "trade:league:1",
  season: 2026,
  week: 3,
  channel: CHANNEL,
  build: async () => ({ title: "A trade" }) as never,
};

beforeEach(() => {
  vi.mocked(postWebhookMessage).mockReset();
  vi.mocked(postWebhookMessage).mockResolvedValue({ ok: true, id: "msg", channelId: "ch" } as never);
});

function baseRespond(leaseRows: number) {
  return (op: Op) => {
    if (op.op === "league_relay_posts.insert") return { data: { id: "row-1" }, error: null };
    if (op.op === "discord_webhooks.select") {
      return { data: { url: "https://discord.com/api/webhooks/1/x", is_active: true }, error: null };
    }
    if (op.op === "league_relay_posts.update" && (op.payload as { send_started_at?: string }).send_started_at) {
      return { data: Array.from({ length: leaseRows }, () => ({ id: "row-1" })), error: null };
    }
    return { data: null, error: null };
  };
}

describe("claimAndSend send lease", () => {
  it("stamps the lease with the payload and sends once it holds it", async () => {
    const { admin, ops } = fakeAdmin(baseRespond(1));
    const out = await claimAndSend(admin, params);
    expect(out.status).toBe("posted");
    const lease = ops.find(
      (o) => o.op === "league_relay_posts.update" && (o.payload as { send_started_at?: string }).send_started_at,
    );
    expect(lease).toBeDefined();
    expect(lease!.filters.some(([k, a]) => k === "is" && a[0] === "send_started_at")).toBe(true);
    expect(postWebhookMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send when the claim was released or taken over while building", async () => {
    const { admin } = fakeAdmin(baseRespond(0));
    const out = await claimAndSend(admin, params);
    expect(out.status).toBe("duplicate");
    expect(postWebhookMessage).not.toHaveBeenCalled();
  });

  it("falls back to the old payload write before migration 0327 exists", async () => {
    const { admin } = fakeAdmin((op) => {
      if (op.op === "league_relay_posts.update" && (op.payload as { send_started_at?: string }).send_started_at) {
        return { data: null, error: { message: "column does not exist", code: "42703" } };
      }
      return baseRespond(1)(op);
    });
    const out = await claimAndSend(admin, params);
    expect(out.status).toBe("posted");
    expect(postWebhookMessage).toHaveBeenCalledTimes(1);
  });
});

describe("claimAndSend poll order", () => {
  const poll = { content: "", poll: { question: "Who won?", answers: ["A", "B"], durationHours: 24 } };

  it("sends the writeup first and the poll after it", async () => {
    vi.mocked(renderWriteup).mockReturnValueOnce({
      message: { content: "story" },
      pollMessage: poll,
      dropped: [],
    } as never);
    const { admin } = fakeAdmin(baseRespond(1));
    const out = await claimAndSend(admin, params);
    expect(out.status).toBe("posted");
    const calls = vi.mocked(postWebhookMessage).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual({ content: "story" });
    expect(calls[0][1].poll).toBeUndefined();
    expect(calls[1][1]).toBe(poll);
  });

  it("keeps the post as posted, with a note, when only the poll fails", async () => {
    vi.mocked(renderWriteup).mockReturnValueOnce({
      message: { content: "story" },
      pollMessage: poll,
      dropped: [],
    } as never);
    vi.mocked(postWebhookMessage)
      .mockResolvedValueOnce({ ok: true, id: "msg", channelId: "ch" } as never)
      .mockResolvedValueOnce({ ok: false, status: 400, retryAfterMs: null, error: "Discord post 400" });
    const { admin, ops } = fakeAdmin(baseRespond(1));
    const out = await claimAndSend(admin, params);
    expect(out.status).toBe("posted");
    const record = ops.find(
      (o) => o.op === "league_relay_posts.update" && (o.payload as { status?: string }).status === "posted",
    )!;
    expect((record.payload as { error?: string }).error).toContain("poll did not");
  });
});

describe("releaseStaleClaims", () => {
  it("releases never-started claims and closes started ones without a retry", async () => {
    const { admin, ops } = fakeAdmin((op) => {
      if (op.op === "league_relay_posts.delete") return { data: [{ id: "a" }, { id: "b" }], error: null };
      if (op.op === "league_relay_posts.update") return { data: [{ id: "c" }], error: null };
      return { data: null, error: null };
    });
    const now = new Date("2026-09-29T12:00:00Z");
    const out = await releaseStaleClaims(admin, now);
    expect(out).toEqual({ released: 2, closed: 1 });

    const del = ops.find((o) => o.op === "league_relay_posts.delete")!;
    expect(del.filters).toContainEqual(["is", ["send_started_at", null]]);
    expect(del.filters).toContainEqual(["is", ["payload", null]]);
    expect(del.filters).toContainEqual(["lt", ["created_at", new Date(now.getTime() - STALE_CLAIM_MS).toISOString()]]);

    const close = ops.find((o) => o.op === "league_relay_posts.update")!;
    expect((close.payload as { status: string }).status).toBe("error");
  });

  it("never throws", async () => {
    const { admin } = fakeAdmin(() => {
      throw new Error("down");
    });
    await expect(releaseStaleClaims(admin)).resolves.toEqual({ released: 0, closed: 0 });
  });
});
