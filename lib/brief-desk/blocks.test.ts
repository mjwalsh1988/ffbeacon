import { describe, expect, it } from "vitest";
import {
  BLOCK_KINDS,
  BLOCK_KIND_META,
  blockAcceptsDataset,
  parseBlockOptions,
  REQUIRED_IN_SEASON_BLOCKS,
} from "./blocks";

const ID = "11111111-1111-4111-8111-111111111111";

describe("block registry", () => {
  it("has metadata for every kind and no kind without metadata", () => {
    expect(BLOCK_KIND_META.map((m) => m.kind).sort()).toEqual([...BLOCK_KINDS].sort());
  });

  it("every required in-season block names real kinds", () => {
    for (const req of REQUIRED_IN_SEASON_BLOCKS) {
      for (const kind of req.kinds) expect(BLOCK_KINDS).toContain(kind);
    }
  });
});

describe("parseBlockOptions", () => {
  it("defaults the value movers options and rejects an out-of-range limit", () => {
    expect(parseBlockOptions("value_movers", {})).toEqual({ ok: true, options: { direction: "both", limit: 10 } });
    expect(parseBlockOptions("value_movers", { limit: 50 }).ok).toBe(false);
  });

  it("refuses free-typed keys, which is where an invented number would hide", () => {
    const out = parseBlockOptions("stat_tiles", { value: 42 });
    expect(out.ok).toBe(false);
  });

  it("validates an action list item by item", () => {
    const ok = parseBlockOptions("action_list", {
      items: [{ player_id: ID, action: "waiver", tool: "faab", note: "bid 12 percent" }],
    });
    expect(ok.ok).toBe(true);
    const bad = parseBlockOptions("action_list", {
      items: [{ player_id: "nope", action: "buy", tool: "faab", note: "" }],
    });
    expect(bad.ok).toBe(false);
  });

  it("keeps the return planner's window ordered", () => {
    expect(parseBlockOptions("return_planner", { default_weeks: [17, 15] }).ok).toBe(false);
    expect(parseBlockOptions("return_planner", {})).toEqual({ ok: true, options: { default_weeks: [15, 17] } });
  });
});

describe("blockAcceptsDataset", () => {
  it("matches a block to the dataset kinds it renders", () => {
    expect(blockAcceptsDataset("value_movers", "value_movers_up")).toBe(true);
    expect(blockAcceptsDataset("value_movers", "top_scorers")).toBe(false);
    expect(blockAcceptsDataset("callout", null)).toBe(true);
    expect(blockAcceptsDataset("callout", "top_scorers")).toBe(false);
  });
});
