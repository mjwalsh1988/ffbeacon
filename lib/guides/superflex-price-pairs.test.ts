import { describe, expect, it } from "vitest";
import { joinPricePairs, pickPairSource } from "./superflex-price-pairs";
import type { RankingsBoardRow } from "@/lib/rankings-board";
import type { SourceRegistryRow } from "@/lib/source";

const PAIR = { oneQb: "dynasty-ppr-std", superflex: "dynasty-ppr-sflex" };

function source(
  slug: string,
  overrides: Partial<SourceRegistryRow> = {},
): SourceRegistryRow {
  return {
    slug,
    display_name: slug.toUpperCase(),
    description: null,
    priority: 1,
    is_default: false,
    data_type: ["rankings", "player_value_history"],
    supported_format_slugs: null,
    update_cadence: "daily",
    ...overrides,
  };
}

function row(
  slug: string,
  position: string,
  overall_rank: number,
  value: number | null = null,
): RankingsBoardRow {
  return {
    overall_rank,
    position_rank: 1,
    tier: null,
    slug,
    sleeper_id: null,
    name: slug,
    position,
    team: null,
    status: "Active",
    value,
    change_7d: null,
    change_7d_pct: null,
    trend_7d: null,
    rank_change_7d: null,
    rank_7d_ago: null,
    show_trend_7d: false,
  };
}

describe("pickPairSource", () => {
  it("honours the requested source when it covers both formats", () => {
    const registry = [source("a", { is_default: true }), source("b")];
    expect(pickPairSource(registry, PAIR, "b")).toBe("b");
  });

  it("falls to the default when the requested source covers only one side", () => {
    const registry = [
      source("a", { is_default: true }),
      source("b", { supported_format_slugs: ["dynasty-ppr-sflex"] }),
    ];
    expect(pickPairSource(registry, PAIR, "b")).toBe("a");
  });

  it("ignores a source that does not publish rankings at all", () => {
    const registry = [
      source("values-only", {
        is_default: true,
        data_type: ["player_value_history"],
      }),
      source("b"),
    ];
    expect(pickPairSource(registry, PAIR, null)).toBe("b");
  });

  it("falls to the first qualifying source in registry order when none is flagged default", () => {
    const registry = [
      source("values-only", { data_type: ["player_value_history"] }),
      source("first"),
      source("second"),
    ];
    expect(pickPairSource(registry, PAIR, null)).toBe("first");
  });

  it("returns null when nothing covers the pair", () => {
    const registry = [
      source("a", { supported_format_slugs: ["dynasty-ppr-std"] }),
    ];
    expect(pickPairSource(registry, PAIR, "a")).toBeNull();
  });
});

describe("joinPricePairs", () => {
  it("takes the top quarterbacks of the superflex board and joins the one-QB twin by slug", () => {
    const superflex = [
      row("qb-one", "QB", 1, 9000),
      row("rb-one", "RB", 2, 8800),
      row("qb-two", "QB", 3, 8500),
      row("qb-three", "QB", 9, 7000),
    ];
    const oneQb = [
      row("rb-one", "RB", 1, 9500),
      row("qb-one", "QB", 4, 7800),
      row("qb-two", "QB", 15, 6000),
    ];
    const rows = joinPricePairs(superflex, oneQb, 2);
    expect(rows).toEqual([
      {
        name: "qb-one",
        slug: "qb-one",
        team: null,
        superflexRank: 1,
        superflexValue: 9000,
        oneQbRank: 4,
        oneQbValue: 7800,
      },
      {
        name: "qb-two",
        slug: "qb-two",
        team: null,
        superflexRank: 3,
        superflexValue: 8500,
        oneQbRank: 15,
        oneQbValue: 6000,
      },
    ]);
  });

  it("sorts the superflex board by overall rank before taking the top rows", () => {
    const superflex = [
      row("qb-nine", "QB", 9),
      row("qb-one", "QB", 1),
      row("qb-three", "QB", 3),
    ];
    const rows = joinPricePairs(superflex, [], 2);
    expect(rows.map((r) => r.slug)).toEqual(["qb-one", "qb-three"]);
  });

  it("leaves the twin null rather than inventing a rank when the one-QB board lacks him", () => {
    const rows = joinPricePairs([row("qb-one", "QB", 1)], [], 8);
    expect(rows[0].oneQbRank).toBeNull();
    expect(rows[0].oneQbValue).toBeNull();
  });

  it("never matches a one-QB row at a different position, even with the same slug", () => {
    const rows = joinPricePairs(
      [row("shared", "QB", 1)],
      [row("shared", "RB", 2, 100)],
      8,
    );
    expect(rows[0].oneQbRank).toBeNull();
  });
});
