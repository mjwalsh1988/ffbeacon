import { describe, it, expect } from "vitest";
import { buildVerdict, categoryLabel } from "./verdict";
import type { ScoredPlayer } from "./engine";

const CTX = { formatLabel: "Dynasty PPR SF", teams: 12 };

function scored(overrides: Partial<ScoredPlayer> = {}): ScoredPlayer {
  return {
    playerId: "p1",
    position: "WR",
    beaconRank: 50,
    beaconValue: 5000,
    positionRank: 20,
    beaconPick: 60,
    projectedPoints: 200,
    pointsAboveReplacement: 40,
    beatRate: 0.53,
    availability: 0.95,
    marketAdp: 96,
    marketAdpKey: "dynasty_2qb",
    marketSource: "sleeper",
    roomAdp: null,
    roomPicksSampled: null,
    valueGap: 36,
    positionAdjustedGap: 30,
    positionGapOffset: 6,
    stealScore: 88,
    confidence: 0.9,
    category: "steal",
    gapRounds: 2.5,
    replacementPoints: 160,
    ...overrides,
  };
}

describe("buildVerdict", () => {
  it("says where he goes and where we would take him", () => {
    const text = buildVerdict(scored(), CTX);
    expect(text).toContain("Goes around pick 96 (round 8) in Dynasty PPR SF.");
    expect(text).toContain("We would take him around 60");
  });

  it("gets the direction of a positive gap right", () => {
    // He lasts to 96 and we would take him at 60, so he lasts LONGER than we
    // would wait. Saying "36 picks later than he lasts" is backwards, and the
    // first shipped draft of this file said exactly that.
    const text = buildVerdict(scored(), CTX);
    expect(text).toContain("he lasts 36 picks longer than that");
    expect(text).not.toContain("later than he actually lasts");
  });

  it("gets the direction of a negative gap right", () => {
    const text = buildVerdict(
      scored({ marketAdp: 40, beaconPick: 80, valueGap: -40, category: "fade" }),
      CTX,
    );
    expect(text).toContain("the room is spending 40 picks too early on him");
  });

  it("explains a row whose raw gap contradicts its bucket", () => {
    // The Brock Purdy shape, which shipped to production before this clause
    // existed: goes at 36, we would take him at 40, so the raw arithmetic says
    // the room is EARLY on him, while the row sat under a Steals heading because
    // the room drafts every quarterback in superflex earlier than our board.
    // Both numbers were right and neither explained the other.
    const text = buildVerdict(
      scored({
        position: "QB",
        marketAdp: 36,
        beaconPick: 40,
        valueGap: -4,
        positionAdjustedGap: 18,
        positionGapOffset: -22,
        category: "steal",
      }),
      CTX,
    );
    expect(text).toContain("the room is spending 4 picks too early on him");
    expect(text).toContain("The room drafts every QB in this format about 22 picks earlier");
    expect(text).toContain("against the rest of the position he is 18 picks of value");
  });

  it("stays quiet when the two gaps agree", () => {
    const text = buildVerdict(
      scored({ valueGap: 36, positionAdjustedGap: 30, positionGapOffset: 6 }),
      CTX,
    );
    expect(text).not.toContain("The room drafts every");
  });

  it("stays quiet when the position was barely centered at all", () => {
    const text = buildVerdict(
      scored({ valueGap: -4, positionAdjustedGap: 1, positionGapOffset: 0.4 }),
      CTX,
    );
    expect(text).not.toContain("The room drafts every");
  });

  it("takes its thresholds from the settings it is handed", () => {
    // roomMinPicks 20 should silence a clause that fires at the default of 5.
    const player = scored({ roomAdp: 140, roomPicksSampled: 10 });
    expect(buildVerdict(player, CTX)).toContain("Our own synced drafts");
    expect(buildVerdict(player, { ...CTX, roomMinPicks: 20 })).not.toContain(
      "Our own synced drafts",
    );

    const thin = scored({ confidence: 0.45 });
    expect(buildVerdict(thin, CTX)).toContain("Thin data");
    expect(buildVerdict(thin, { ...CTX, thinConfidence: 0.3 })).not.toContain("Thin data");
  });

  it("calls a near-zero gap about right", () => {
    const text = buildVerdict(scored({ valueGap: 0.4 }), CTX);
    expect(text).toContain("right about where he goes");
  });

  it("quotes points above a replacement starter at his own position", () => {
    expect(buildVerdict(scored({ position: "TE", pointsAboveReplacement: 13 }), CTX)).toContain(
      "13 points above a replacement TE",
    );
  });

  it("says so plainly when he projects below replacement", () => {
    const text = buildVerdict(scored({ pointsAboveReplacement: -22 }), CTX);
    expect(text).toContain("22 points below a replacement WR");
    expect(text).toContain("the case is the asset rather than the lineup");
  });

  it("reports the beat rate as a whole percentage", () => {
    expect(buildVerdict(scored({ beatRate: 0.526 }), CTX)).toContain(
      "Beats his weekly projection 53% of the time",
    );
  });

  it("drops every clause whose input is missing rather than inventing one", () => {
    const rookie = scored({
      beatRate: null,
      availability: null,
      pointsAboveReplacement: null,
      projectedPoints: null,
    });
    const text = buildVerdict(rookie, CTX);
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("Beats his weekly projection");
    expect(text).not.toContain("replacement");
    expect(text).toContain("Goes around pick 96");
  });

  it("mentions availability only when it is actually a concern", () => {
    expect(buildVerdict(scored({ availability: 0.95 }), CTX)).not.toContain("Available for");
    expect(buildVerdict(scored({ availability: 0.6 }), CTX)).toContain("Available for 60%");
  });

  it("labels a swing as a dart and does not also call it thin", () => {
    const text = buildVerdict(scored({ category: "swing", confidence: 0.3 }), CTX);
    expect(text).toContain("A dart throw, not a plan.");
    expect(text).not.toContain("Thin data");
  });

  it("discloses thin data on a low-confidence non-swing", () => {
    expect(buildVerdict(scored({ confidence: 0.4 }), CTX)).toContain("Thin data");
  });

  it("mentions our own rooms only with a real sample and a real difference", () => {
    const noSample = buildVerdict(scored({ roomAdp: 140, roomPicksSampled: 2 }), CTX);
    expect(noSample).not.toContain("Our own synced drafts");

    const tooClose = buildVerdict(scored({ roomAdp: 98, roomPicksSampled: 20 }), CTX);
    expect(tooClose).not.toContain("Our own synced drafts");

    const real = buildVerdict(scored({ roomAdp: 140, roomPicksSampled: 20 }), CTX);
    expect(real).toContain("Our own synced drafts let him fall even further, to about 140");
  });

  it("handles a player the market does not rank", () => {
    const text = buildVerdict(
      scored({ marketAdp: null, valueGap: null, stealScore: null, category: "fair" }),
      CTX,
    );
    expect(text).toContain("Undrafted in the Dynasty PPR SF market we track.");
    expect(text).toContain("We would take him around 60.");
  });

  it("never emits a banned typographic character", () => {
    const text = buildVerdict(scored({ roomAdp: 140, roomPicksSampled: 20 }), CTX);
    // Em dash, en dash, curly quotes, ellipsis, middle dot.
    expect(text).not.toMatch(/[—–‘’“”…· ]/);
  });
});

describe("categoryLabel", () => {
  it("names each bucket in plain language", () => {
    expect(categoryLabel("steal")).toBe("Steal");
    expect(categoryLabel("swing")).toBe("Late-round swing");
    expect(categoryLabel("fade")).toBe("Fade");
    expect(categoryLabel("fair")).toBe("Priced about right");
  });
});
