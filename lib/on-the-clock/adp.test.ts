import { describe, it, expect } from "vitest";
import {
  adpFormatKeyCandidates,
  attachAdpToPlayers,
  classifyPickValue,
  describeBeaconVsAdp,
  describePickValue,
  pickIndicatorLabel,
  pickValueDelta,
} from "./adp";
import { inferPlayerPool, describeInferredPool, ROOKIE_DRAFT_MAX_ROUNDS } from "./draft-derive";
import type { RankedPlayer } from "./board-types";

describe("adpFormatKeyCandidates", () => {
  it("maps superflex to the 2QB markets", () => {
    expect(adpFormatKeyCandidates("dynasty-ppr-sflex", "everyone")[0]).toBe("dynasty_2qb");
    expect(adpFormatKeyCandidates("redraft-ppr-sflex", "everyone")[0]).toBe("2qb");
  });

  it("maps scoring variants for single-QB formats", () => {
    expect(adpFormatKeyCandidates("redraft-ppr-std", "everyone")[0]).toBe("ppr");
    expect(adpFormatKeyCandidates("redraft-half-std", "everyone")[0]).toBe("half_ppr");
    expect(adpFormatKeyCandidates("redraft-std-std", "everyone")[0]).toBe("std");
    expect(adpFormatKeyCandidates("dynasty-ppr-std", "everyone")[0]).toBe("dynasty_ppr");
  });

  it("grades TEP superflex against the base 2QB market (no TEP ADP exists)", () => {
    expect(adpFormatKeyCandidates("dynasty-ppr-tep-sflex", "everyone")[0]).toBe("dynasty_2qb");
  });

  it("leads with rookie ADP for rookie pools, then falls back to the format market", () => {
    const keys = adpFormatKeyCandidates("dynasty-ppr-sflex", "rookies");
    expect(keys[0]).toBe("rookie");
    expect(keys).toContain("dynasty_2qb");
  });

  it("always ends on a broad market fallback", () => {
    expect(adpFormatKeyCandidates("dynasty-ppr-sflex", "everyone")).toContain("dynasty_ppr");
    expect(adpFormatKeyCandidates("redraft-half-std", "everyone")).toContain("ppr");
  });
});

describe("pickValueDelta / classifyPickValue", () => {
  it("is positive when a player is taken after their ADP (value)", () => {
    expect(pickValueDelta(42, 30)).toBe(12);
    expect(classifyPickValue(12, 6)).toBe("value");
  });

  it("is negative when a player is taken before their ADP (reach)", () => {
    expect(pickValueDelta(18, 30)).toBe(-12);
    expect(classifyPickValue(-12, 6)).toBe("reach");
  });

  it("is neutral inside the threshold band", () => {
    expect(classifyPickValue(5, 6)).toBe("neutral");
    expect(classifyPickValue(-5, 6)).toBe("neutral");
    expect(classifyPickValue(6, 6)).toBe("value");
  });

  it("returns null for missing or invalid ADP", () => {
    expect(pickValueDelta(10, null)).toBeNull();
    expect(pickValueDelta(10, 0)).toBeNull();
    expect(pickValueDelta(10, Number.NaN)).toBeNull();
    expect(classifyPickValue(null, 6)).toBeNull();
  });
});

describe("plain-English copy", () => {
  it("describes made picks in layman terms", () => {
    expect(describePickValue(14, "value")).toBe("Great value: taken 14 picks after ADP");
    expect(describePickValue(-11, "reach")).toBe("Reach: taken 11 picks before ADP");
    expect(describePickValue(2, "neutral")).toBe("Near ADP");
    expect(describePickValue(null, null)).toBe("No ADP data");
  });

  it("describes the Beacon-vs-ADP gap for available players", () => {
    const later = describeBeaconVsAdp(30, 42, 6);
    expect(later.lean).toBe("beacon-higher");
    expect(later.label).toBe("Sleeper ADP is 12 picks later. Beacon says value.");
    const earlier = describeBeaconVsAdp(42, 30, 6);
    expect(earlier.lean).toBe("market-higher");
    const even = describeBeaconVsAdp(30, 32, 6);
    expect(even.lean).toBe("even");
    const none = describeBeaconVsAdp(30, null, 6);
    expect(none.lean).toBe("none");
    expect(none.label).toBe("No ADP data");
  });

  it("builds screen-reader indicator labels only for non-neutral verdicts", () => {
    expect(pickIndicatorLabel(12, "value")).toContain("good value");
    expect(pickIndicatorLabel(-9, "reach")).toContain("possible reach");
    expect(pickIndicatorLabel(1, "neutral")).toBeNull();
  });
});

describe("attachAdpToPlayers", () => {
  const player = (id: string, sleeperId: string | null): RankedPlayer => ({
    playerId: id,
    sleeperId,
    name: id,
    position: "WR",
    team: null,
    overallRank: 1,
    positionRank: 1,
    tier: 1,
    value: 100,
    isRookie: false,
  });

  it("attaches by sleeper id and nulls the rest", () => {
    const out = attachAdpToPlayers([player("a", "s1"), player("b", "s2"), player("c", null)], {
      s1: 12.5,
    });
    expect(out[0].adp).toBe(12.5);
    expect(out[1].adp).toBeNull();
    expect(out[2].adp).toBeNull();
  });
});

describe("inferPlayerPool", () => {
  it("always shows everyone for redraft formats regardless of rounds", () => {
    expect(inferPlayerPool({ formatSlug: "redraft-ppr-std", rounds: 5 })).toBe("everyone");
    expect(inferPlayerPool({ formatSlug: "redraft-ppr-sflex", rounds: 15 })).toBe("everyone");
  });

  it("treats short dynasty drafts as rookie drafts", () => {
    expect(inferPlayerPool({ formatSlug: "dynasty-ppr-sflex", rounds: ROOKIE_DRAFT_MAX_ROUNDS })).toBe(
      "rookies",
    );
    expect(inferPlayerPool({ formatSlug: "dynasty-ppr-sflex", rounds: 4 })).toBe("rookies");
  });

  it("treats long dynasty drafts as startups", () => {
    expect(inferPlayerPool({ formatSlug: "dynasty-ppr-sflex", rounds: 7 })).toBe("everyone");
    expect(inferPlayerPool({ formatSlug: "dynasty-ppr-tep-sflex", rounds: 25 })).toBe("everyone");
  });

  it("defaults to everyone for unknown formats or round counts", () => {
    expect(inferPlayerPool({ formatSlug: null, rounds: 4 })).toBe("everyone");
    expect(inferPlayerPool({ formatSlug: "dynasty-ppr-sflex", rounds: 0 })).toBe("everyone");
    expect(inferPlayerPool({ formatSlug: "dynasty-ppr-sflex", rounds: Number.NaN })).toBe("everyone");
  });

  it("explains the inference in plain English", () => {
    expect(
      describeInferredPool({ formatSlug: "dynasty-ppr-sflex", rounds: 5, pool: "rookies" }),
    ).toContain("rookie draft");
    expect(
      describeInferredPool({ formatSlug: "dynasty-ppr-sflex", rounds: 20, pool: "everyone" }),
    ).toContain("startup");
    expect(
      describeInferredPool({ formatSlug: "redraft-ppr-std", rounds: 15, pool: "everyone" }),
    ).toContain("redraft");
  });
});
