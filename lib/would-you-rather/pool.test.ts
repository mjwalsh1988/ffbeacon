import { describe, expect, it } from "vitest";
import { admitGradedTrade } from "./pool";

type Result = Parameters<typeof admitGradedTrade>[0];

function result(over: { hasMissingValues?: boolean; startup?: unknown; kinds?: string[] } = {}): Result {
  return {
    startup: (over.startup ?? null) as Result["startup"],
    assetMeta: {
      a: (over.kinds ?? ["player"]).map((kind) => ({ kind })),
      b: [{ kind: "pick" }],
    } as unknown as Result["assetMeta"],
    view: { hasMissingValues: over.hasMissingValues ?? false } as Result["view"],
  };
}

const SETTINGS = { include_startup_trades: true, require_player_asset: true };

describe("admitGradedTrade (IDP-130)", () => {
  it("admits an ordinary, fully priced trade", () => {
    expect(admitGradedTrade(result(), SETTINGS)).toBe(true);
  });

  it("refuses a trade with any unpriced asset, such as a defender", () => {
    expect(admitGradedTrade(result({ hasMissingValues: true }), SETTINGS)).toBe(false);
  });

  it("keeps the existing startup and player-asset rules", () => {
    expect(admitGradedTrade(result({ startup: {} }), { ...SETTINGS, include_startup_trades: false })).toBe(false);
    expect(admitGradedTrade(result({ kinds: ["pick"] }), SETTINGS)).toBe(false);
  });
});
