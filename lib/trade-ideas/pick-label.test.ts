import { describe, it, expect } from "vitest";
import {
  describePick,
  formatPickLabel,
  pickRoundLabel,
  pickViaLabel,
  type PickLike,
} from "./pick-label";

const pick = (overrides: Partial<PickLike> = {}): PickLike => ({
  season: 2027,
  round: 1,
  pickPosition: "early",
  isOwnPick: false,
  originalOwnerHandle: "dynastyDan",
  originalTeamName: "Regret Machine",
  originalRosterId: 7,
  ...overrides,
});

describe("pickRoundLabel", () => {
  it("names the pick and nothing else", () => {
    expect(pickRoundLabel(2027, 1)).toBe("2027 R1");
    expect(pickRoundLabel(2028, 4)).toBe("2028 R4");
  });
});

describe("pickViaLabel", () => {
  it("prefers the Sleeper handle, which is what managers recognise", () => {
    expect(pickViaLabel(pick())).toBe("via @dynastyDan");
  });

  it("falls back to the team name when there is no handle", () => {
    expect(pickViaLabel(pick({ originalOwnerHandle: null }))).toBe("via Regret Machine");
  });

  it("falls back to the roster id rather than saying nothing", () => {
    expect(
      pickViaLabel(pick({ originalOwnerHandle: null, originalTeamName: null })),
    ).toBe("via team 7");
  });

  it("says own pick, which is an answer rather than a gap", () => {
    expect(pickViaLabel(pick({ isOwnPick: true }))).toBe("own pick");
  });

  it("clamps a long team name so a bookmark still validates", () => {
    // Sleeper caps a username but not a team name, and the saved-suggestion
    // schema caps an asset label at 80 characters.
    const long = pickViaLabel(
      pick({
        originalOwnerHandle: null,
        originalTeamName: "The Absolutely Enormous Team Name That Somebody Really Did Use",
      }),
    );
    // "via " plus the clamped name, which is capped ellipsis included.
    expect(long.length).toBeLessThanOrEqual("via ".length + 28);
    expect(long.endsWith("...")).toBe(true);
  });

  it("keeps the whole label inside the bookmark schema's limit", () => {
    const label = formatPickLabel(
      pick({
        originalOwnerHandle: null,
        originalTeamName: "The Absolutely Enormous Team Name That Somebody Really Did Use",
      }),
    );
    expect(label.length).toBeLessThanOrEqual(80);
  });
});

describe("describePick", () => {
  it("splits the three facts a pick carries", () => {
    const parts = describePick(pick(), true);
    expect(parts.round).toBe("2027 R1");
    expect(parts.pool).toBe("Early");
    expect(parts.via).toBe("via @dynastyDan");
  });

  it("has no pool when the pick cannot be placed", () => {
    const parts = describePick(pick({ pickPosition: "unknown" }), true);
    expect(parts.pool).toBeNull();
    expect(parts.poolWord).toBeNull();
    expect(parts.plainLabel).not.toContain("in the round");
  });

  it("says the pool is projected when it is, and not when it is not", () => {
    expect(describePick(pick(), true).plainLabel).toContain("projected early in the round");
    expect(describePick(pick(), false).plainLabel).toContain(", early in the round");
    expect(describePick(pick(), false).plainLabel).not.toContain("projected");
  });

  it("spells the round out loud rather than leaving R1 to be read as letters", () => {
    expect(describePick(pick(), false).plainLabel).toContain("2027 first round pick");
    expect(describePick(pick({ round: 7 }), false).plainLabel).toContain(
      "2027 round 7 pick",
    );
  });

  it("names the original owner in the spoken form, which is the whole point", () => {
    expect(describePick(pick(), true).plainLabel).toContain("via @dynastyDan");
  });
});

describe("formatPickLabel", () => {
  it("puts the three facts in one line, in the same order as the rendered form", () => {
    expect(formatPickLabel(pick())).toBe("2027 R1 Early (via @dynastyDan)");
  });

  it("drops the pool when there is none, without leaving a gap", () => {
    expect(formatPickLabel(pick({ pickPosition: "unknown" }))).toBe(
      "2027 R1 (via @dynastyDan)",
    );
  });

  it("distinguishes two picks that used to be the same string", () => {
    // The bug this whole change exists for. One roster in a real league holds
    // nine 2027 1sts; every one of them used to render as "2027 1st (early)".
    const mine = formatPickLabel(pick({ isOwnPick: true, originalRosterId: 3 }));
    const theirs = formatPickLabel(pick({ originalRosterId: 7 }));
    expect(mine).not.toBe(theirs);
  });
});
