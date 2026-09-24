import { describe, expect, it } from "vitest";
import { gameLogHelper } from "./game-log-helper";

describe("gameLogHelper (IDP-128)", () => {
  it("does not claim next season is unpublished once it is on the slate", () => {
    const text = gameLogHelper({ season: 2025, isFallback: true, laterSeasonScheduled: true });
    expect(text).toContain("No upcoming games are projected for this player");
    expect(text).not.toContain("schedule has not been published");
  });

  it("keeps the offseason wording when the next schedule really is unpublished", () => {
    expect(gameLogHelper({ season: 2025, isFallback: true, laterSeasonScheduled: false })).toContain(
      "the 2026 schedule has not been published yet",
    );
  });

  it("leaves the live-season wording alone", () => {
    expect(gameLogHelper({ season: 2026, isFallback: false, laterSeasonScheduled: false })).toBe(
      "2026 week by week, with the rest of the schedule and each week's opponent.",
    );
  });
});
