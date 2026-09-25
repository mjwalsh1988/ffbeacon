import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { favoritePlayerLabel } from "./signal-block";
import { PositionChip } from "@/components/position-chip";

describe("favourite player (plan IDP-212)", () => {
  it("spells the position out in the accessible name", () => {
    expect(favoritePlayerLabel({ name: "Roquan Smith", position: "LB", team: "BAL" })).toBe(
      "Roquan Smith, linebacker, BAL",
    );
    expect(favoritePlayerLabel({ name: "Josh Allen", position: "QB", team: null })).toBe(
      "Josh Allen, quarterback",
    );
  });

  it("draws the defender chip in its own hue with the noun for a screen reader", () => {
    const html = renderToStaticMarkup(<PositionChip position="DB" />);
    expect(html).toContain("text-position-db");
    // The code is a real text node; only the missing words are sr-only, in
    // the same element. No aria-hidden twin (the Lineups rule).
    expect(html).toContain('>DB<span class="sr-only normal-case"> (defensive back)</span>');
    expect(html).not.toContain("aria-hidden");
    expect(html).not.toContain("bg-ink/10");
  });
});
