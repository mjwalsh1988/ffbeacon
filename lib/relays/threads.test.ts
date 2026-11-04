import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { MAX_CARD_UPDATES, resolveCardHost, threadLinkProven } from "./threads";
import type { RelayRow } from "./types";

describe("threadLinkProven", () => {
  const post = (playerIds: string[], teamIds: string[] = []) => ({ playerIds, teamIds, relevanceTier: 3 });
  const target = (player_ids: string[], team_ids: string[] = []) => ({ player_ids, team_ids });

  it("needs a shared player when both sides name players", () => {
    expect(threadLinkProven({ foldedByX: true, viaReplyOnly: false, post: post(["p1"]), target: target(["p1", "p2"]) })).toBe(true);
    expect(threadLinkProven({ foldedByX: true, viaReplyOnly: false, post: post(["p3"]), target: target(["p1"]) })).toBe(false);
  });

  it("accepts a shared team for a quote, never for a reply alone", () => {
    expect(threadLinkProven({ foldedByX: true, viaReplyOnly: false, post: post([], ["t1"]), target: target(["p1"], ["t1"]) })).toBe(true);
    expect(threadLinkProven({ foldedByX: true, viaReplyOnly: true, post: post([], ["t1"]), target: target(["p1"], ["t1"]) })).toBe(false);
  });

  it("is not proven when one side names nobody we could resolve", () => {
    expect(threadLinkProven({ foldedByX: true, viaReplyOnly: false, post: post([]), target: target(["p1"], ["t1"]) })).toBe(false);
  });

  it("is not proven when a hop was a match rather than X's own link", () => {
    expect(threadLinkProven({ foldedByX: false, viaReplyOnly: false, post: post(["p1"]), target: target(["p1"]) })).toBe(false);
  });
});

/**
 * A minimal stand-in for the Supabase query builder: every chain method
 * records its filter and returns itself; awaiting it (or maybeSingle) asks
 * the resolver for the answer.
 */
type Query = { table: string; filters: Array<[string, unknown[]]> };
type Answer = { data?: unknown; count?: number | null; error?: null };
function fakeAdmin(resolve: (q: Query) => Answer): SupabaseClient<Database> {
  const make = (table: string) => {
    const q: Query = { table, filters: [] };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "filter", "order", "limit", "overlaps", "gte", "neq", "like"]) {
      builder[m] = (...args: unknown[]) => {
        q.filters.push([m, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve({ error: null, ...resolve(q) });
    builder.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve({ error: null, ...resolve(q) }).then(ok, bad);
    return builder;
  };
  return { from: make } as unknown as SupabaseClient<Database>;
}

function has(q: Query, method: string, ...args: unknown[]): boolean {
  return q.filters.some(([m, a]) => m === method && args.every((x, i) => JSON.stringify(a[i]) === JSON.stringify(x)));
}

function relay(over: Partial<RelayRow> = {}): RelayRow {
  return {
    id: "relay-host",
    ingestion_id: "ing-host",
    status: "published",
    discord_card_ingestion_id: null,
    ...over,
  } as RelayRow;
}

/** A Discord id whose embedded time is `msAgo` before now. */
function snowflakeAgo(msAgo: number): string {
  const ms = BigInt(Date.now() - msAgo) - BigInt(1_420_070_400_000);
  return (ms << BigInt(22)).toString();
}

function scenario(opts: { messageAgoMs?: number | null; pendingPost?: boolean; attachedCount?: number; hostRelay?: RelayRow }) {
  return fakeAdmin((q) => {
    if (q.table === "relays" && has(q, "eq", "discord_card_ingestion_id")) return { count: opts.attachedCount ?? 0 };
    if (q.table === "relays") return { data: opts.hostRelay ?? null };
    if (q.table === "news_ingestions") {
      return {
        data: {
          id: "ing-host",
          created_at: new Date().toISOString(),
          discord_message_id: opts.messageAgoMs == null ? null : snowflakeAgo(opts.messageAgoMs),
        },
      };
    }
    if (q.table === "beacon_brief_queue") {
      return { data: opts.pendingPost ? [{ run_after: new Date().toISOString() }] : [] };
    }
    return { data: null };
  });
}

const windows = { editWindowMinutes: 10, coalesceMinutes: 3 };

describe("resolveCardHost", () => {
  it("joins a proven follow-up to a card inside the edit window", async () => {
    const out = await resolveCardHost(scenario({ messageAgoMs: 6 * 60_000 }), { targetRelay: relay(), route: "thread", ...windows });
    expect(out.hostIngestionId).toBe("ing-host");
  });

  it("gives a model match only the short window", async () => {
    const out = await resolveCardHost(scenario({ messageAgoMs: 6 * 60_000 }), { targetRelay: relay(), route: "model", ...windows });
    expect(out.hostIngestionId).toBeNull();
  });

  it("posts a card of its own past the window", async () => {
    const out = await resolveCardHost(scenario({ messageAgoMs: 45 * 60_000 }), { targetRelay: relay(), route: "event_key", ...windows });
    expect(out.hostIngestionId).toBeNull();
  });

  it("joins a card that has not posted yet", async () => {
    const out = await resolveCardHost(scenario({ messageAgoMs: null, pendingPost: true }), { targetRelay: relay(), route: "model", ...windows });
    expect(out.hostIngestionId).toBe("ing-host");
  });

  it("never joins a card that was never posted and is not queued", async () => {
    const out = await resolveCardHost(scenario({ messageAgoMs: null, pendingPost: false }), { targetRelay: relay(), route: "thread", ...windows });
    expect(out.hostIngestionId).toBeNull();
  });

  it("downgrades a proven link to the short window when the target is itself on another card", async () => {
    const target = relay({ id: "relay-update", ingestion_id: "ing-update", discord_card_ingestion_id: "ing-host" });
    const admin = scenario({ messageAgoMs: 6 * 60_000, hostRelay: relay() });
    const out = await resolveCardHost(admin, { targetRelay: target, route: "thread", ...windows });
    expect(out.hostIngestionId).toBeNull();
  });

  it("refuses a hidden story and a full card", async () => {
    const hidden = await resolveCardHost(scenario({ messageAgoMs: 60_000 }), {
      targetRelay: relay({ status: "hidden" }),
      route: "thread",
      ...windows,
    });
    expect(hidden.hostIngestionId).toBeNull();
    const full = await resolveCardHost(scenario({ messageAgoMs: 60_000, attachedCount: MAX_CARD_UPDATES }), {
      targetRelay: relay(),
      route: "thread",
      ...windows,
    });
    expect(full.hostIngestionId).toBeNull();
  });

  it("is off when the window is zero", async () => {
    const out = await resolveCardHost(scenario({ messageAgoMs: 0, pendingPost: true }), {
      targetRelay: relay(),
      route: "thread",
      editWindowMinutes: 0,
      coalesceMinutes: 0,
    });
    expect(out.hostIngestionId).toBeNull();
  });
});
