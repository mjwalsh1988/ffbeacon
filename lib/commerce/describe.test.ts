import { describe, expect, it } from "vitest";
import type { PublicSharePayload } from "@/lib/signal-check/types";
import {
  orderSubjectDetail,
  orderSubjectLabel,
  orderSubjectLine,
  productKindName,
  reorderPlace,
  tradeLine,
  tradeSideName,
} from "./describe";
import type { TeamReviewContext, TradeReviewContext } from "./types";

function payload(a: string[], b: string[], labels?: { a?: string; b?: string }): PublicSharePayload {
  const side = (key: "a" | "b", names: string[]) => ({
    side: key,
    teamLabel: labels?.[key] ?? null,
    assets: names.map((name) => ({ name, detail: null, kind: "player" as const, sleeperId: null, round: null })),
    total: null,
    adjustment: null,
    adjustmentPct: null,
  });
  return {
    featureLabel: "Signal Check",
    resultLabel: "Beacon Verdict",
    verdictLabel: "Side A wins",
    winnerSide: "a",
    marginPct: 12,
    formatDisplay: "Dynasty Superflex",
    tradeShapeLabel: null,
    confidenceLabel: null,
    explanation: "",
    adjustmentLabel: null,
    sides: [side("a", a), side("b", b)],
    valueSnapshotLabel: null,
    createdAtIso: "2026-10-31T12:00:00Z",
  };
}

const TEAM: TeamReviewContext = {
  sleeperLeagueId: "1",
  leagueRowId: "r",
  leagueName: "The League",
  season: "2026",
  totalRosters: 12,
  rosterId: 3,
  teamName: "Night Owls",
  ownerHandle: null,
  formatSlug: null,
  formatDisplay: "Unmatched",
  sourceSlug: "ktc",
  sourceDisplay: "KeepTradeCut",
  blueprint: null,
  links: { blueprint: "", overview: "", lineups: "", tradeIdeas: "" },
};

function trade(p: PublicSharePayload, summary = tradeLine(p)): TradeReviewContext {
  return {
    kind: "trade-review",
    shareId: "s",
    analysisId: "a",
    formatSlug: "dynasty-ppr-sflex",
    isPublic: true,
    summary,
    trade: p,
    links: { share: "/tools/trade-calculator/v/s", calculator: "/tools/trade-calculator" },
  };
}

describe("tradeLine", () => {
  it("joins each side's names with 'and' and the sides with 'for'", () => {
    expect(tradeLine(payload(["Josh Allen"], ["Bijan Robinson", "2027 1st"]))).toBe(
      "Josh Allen for Bijan Robinson and 2027 1st",
    );
    expect(tradeLine(payload(["A", "B", "C"], ["D"]))).toBe("A, B and C for D");
  });

  it("says nothing for an empty side and caps a long line", () => {
    expect(tradeLine(payload([], ["D"]))).toBe("nothing for D");
    const many = Array.from({ length: 12 }, (_, i) => `Player Number ${i + 1}`);
    const line = tradeLine(payload(many, many));
    expect(line.length).toBeLessThanOrEqual(140);
    expect(line.endsWith("...")).toBe(true);
  });
});

describe("the subject line", () => {
  it("names the team and league for a team review", () => {
    expect(orderSubjectLine(TEAM)).toBe("Night Owls in The League");
    expect(orderSubjectLabel(TEAM)).toBe("Team");
    expect(orderSubjectDetail(TEAM)).toBe("Night Owls in The League, 2026");
    expect(productKindName({ context: TEAM })).toBe("Personal Team Review");
    expect(reorderPlace(TEAM)).toBe("your Blueprint");
  });

  it("names the trade for a trade review, from the stored summary", () => {
    const ctx = trade(payload(["Josh Allen"], ["Bijan Robinson"]), "Josh Allen for Bijan Robinson");
    expect(orderSubjectLine(ctx)).toBe("Josh Allen for Bijan Robinson");
    expect(orderSubjectLabel(ctx)).toBe("Trade");
    expect(orderSubjectDetail(ctx)).toBe("Josh Allen for Bijan Robinson, Dynasty Superflex");
    expect(productKindName({ context: ctx })).toBe("Trade Review");
    expect(reorderPlace(ctx)).toBe("the trade calculator");
  });

  it("falls back to the payload when a summary is missing", () => {
    const ctx = trade(payload(["A"], ["B"]), "");
    expect(orderSubjectLine(ctx)).toBe("A for B");
  });

  it("uses the import's team label for a side when there is one", () => {
    const p = payload(["A"], ["B"], { a: "Night Owls" });
    expect(tradeSideName(p, "a")).toBe("Night Owls");
    expect(tradeSideName(p, "b")).toBe("Side B");
  });
});
