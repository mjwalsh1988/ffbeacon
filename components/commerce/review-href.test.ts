import { describe, expect, it } from "vitest";
import { payWays, reviewHref, reviewSectionHref, tradeReviewHref, withinDays } from "./review-href";

describe("review links", () => {
  it("names the league, the roster when known, the tier and the handle", () => {
    expect(reviewHref({ sleeperLeagueId: "1", rosterId: 3, tier: "premium", linkUsername: "sam" })).toBe(
      "/leagues/1/review?roster=3&tier=premium&username=sam",
    );
    expect(reviewHref({ sleeperLeagueId: "1", rosterId: null, tier: "basic", linkUsername: null })).toBe(
      "/leagues/1/review?tier=basic",
    );
  });

  it("puts the hash after the handle on the section link", () => {
    expect(reviewSectionHref({ sleeperLeagueId: "1", rosterId: 2, linkUsername: "sam" })).toBe(
      "/leagues/1/blueprint?roster=2&username=sam#review",
    );
  });

  it("builds the trade checkout link from the share id", () => {
    expect(tradeReviewHref("0b4f2a6e-5c1d-4e8a-9f3b-2d7c8e1a4b5f")).toBe(
      "/tools/trade-calculator/review?trade=0b4f2a6e-5c1d-4e8a-9f3b-2d7c8e1a4b5f",
    );
  });
});

describe("the shared words", () => {
  it("lists the ways to pay from what is switched on", () => {
    expect(payWays(["stripe", "paypal", "venmo"])).toBe("card, Apple Pay, Google Pay, PayPal or Venmo");
    expect(payWays(["venmo"])).toBe("Venmo");
    expect(payWays([])).toBeNull();
  });

  it("spells one day and many days", () => {
    expect(withinDays(1)).toBe("within 1 day");
    expect(withinDays(3)).toBe("within 3 days");
  });
});
