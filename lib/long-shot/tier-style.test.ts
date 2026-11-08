import { describe, expect, it } from "vitest";
import { METAL, MISS_STYLE, TIER_STYLE, tierIcon } from "./tier-style";
import { TIERS } from "./types";

describe("tier style", () => {
  it("every tier has exactly one color and one icon", () => {
    for (const tier of TIERS) {
      expect(TIER_STYLE[tier].hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(tierIcon(tier)).not.toBeNull();
    }
    expect(new Set(TIERS.map((t) => tierIcon(t))).size).toBe(TIERS.length);
    expect(tierIcon(null)).toBeNull();
  });

  it("uses the hex values in plan section 18A", () => {
    expect(TIER_STYLE.chalk.hex).toBe("#8A8A9C");
    expect(TIER_STYLE.field.hex).toBe("#C084FC");
    expect(TIER_STYLE.deep.hex).toBe("#A855F7");
    expect(TIER_STYLE.sleeper.hex).toBe("#22D3EE");
    expect(MISS_STYLE.hex).toBe("#EF4444");
    expect(METAL.gold.hex).toBe("#F5C451");
    expect(METAL.silver.hex).toBe("#C9CDD6");
    expect(METAL.bronze.hex).toBe("#D08A5B");
  });
});
