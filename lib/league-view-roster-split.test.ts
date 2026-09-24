import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitUnvaluedRoster } from "./league-view-roster-split";

const p = (full_name: string, position: string) => ({ full_name, position });

describe("splitUnvaluedRoster (plan IDP-209, R-27)", () => {
  it("names defenders in DL, LB, DB order, then by name", () => {
    const out = splitUnvaluedRoster([
      p("Zed Safety", "DB"),
      p("Adam Linebacker", "LB"),
      p("Josh Allen", "QB"),
      p("Myles Garrett", "DL"),
      p("Brandon Aubrey", "K"),
      p("Ravens", "DEF"),
    ]);
    expect(out.defenders.map((d) => d.full_name)).toEqual([
      "Myles Garrett",
      "Adam Linebacker",
      "Zed Safety",
    ]);
    expect(out.specialists.map((d) => d.full_name)).toEqual(["Brandon Aubrey", "Ravens"]);
  });

  it("returns nothing for an offense-only roster, so its card renders as before", () => {
    expect(splitUnvaluedRoster([p("Josh Allen", "QB"), p("CeeDee Lamb", "WR")])).toEqual({
      defenders: [],
      specialists: [],
    });
  });
});

describe("team card wiring", () => {
  const card = readFileSync(join(process.cwd(), "components/team-card.tsx"), "utf8");
  it("renders the Defense group only when the roster holds a defender", () => {
    expect(card).toContain("unvalued.defenders.length > 0 && (\n              <DefenseColumn");
    expect(card).toContain("No market value");
  });
  it("says what the value total covers when defenders are listed", () => {
    expect(card).toContain("Values and ranks on this card cover offensive players");
  });
});
