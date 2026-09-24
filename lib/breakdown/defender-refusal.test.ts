/**
 * IDP-127: the three direct-slug leaks refuse a defender with a sentence.
 * The Who Should I Start board already refused one (lib/start-sit/load.ts);
 * these hold the picker chip, the Beacon Breakdown core and its OG route.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defenderSlugs } from "@/lib/beacon-breakdown";
import { normalizeCandidatePosition } from "@/lib/start-sit/load";

const ROOT = path.resolve(__dirname, "..", "..");

describe("the breakdown core refuses defenders", () => {
  it("lists a DB slug as refused and leaves offensive slugs alone", () => {
    const bySlug = new Map([
      ["kyle-hamilton-8136", { position: "DB" }],
      ["puka-nacua-9493", { position: "WR" }],
      ["some-defense-def", { position: "DEF" }],
    ]);
    expect(defenderSlugs(["puka-nacua-9493", "kyle-hamilton-8136", "some-defense-def"], bySlug)).toEqual([
      "kyle-hamilton-8136",
    ]);
  });

  it("the start/sit board maps no defender to a position", () => {
    expect(normalizeCandidatePosition("LB")).toBeNull();
    expect(normalizeCandidatePosition("DST")).toBe("DEF");
  });

  it("the breakdown OG image says so in words", () => {
    const source = readFileSync(path.join(ROOT, "app/api/og/breakdown/[a]/[b]/route.tsx"), "utf8");
    expect(source).toContain("Defensive players are not compared here");
    expect(source).toContain("refusedSlugs");
  });

  it("the picker gives a defender no chip, and the refusal names the position in words", () => {
    const page = readFileSync(path.join(ROOT, "app/tools/who-should-i-start/page.tsx"), "utf8");
    expect(page).toContain("!isDefender(p.position)");
    const board = readFileSync(path.join(ROOT, "app/tools/who-should-i-start/start-sit-board.tsx"), "utf8");
    expect(board).toContain("positionNoun(p.position)");
  });
});
