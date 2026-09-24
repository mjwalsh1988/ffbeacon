import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plan R-15: only the header palette and the Free Agent Finder search the IDP
 * pool. These surfaces must stay on the default "ranked" pool, because each
 * has nothing to say about a defender once he is picked: Beacon Breakdown and
 * Who Should I Start refuse defenders (R-23), Signal Scout's answers are
 * ranked players, and Signal Check prices assets no source prices for IDP.
 *
 * Source-level on purpose: each route builds its own Supabase client, and the
 * property under test is the argument list it passes, which a grep states
 * exactly.
 */
const STAY_OUT = [
  "app/api/breakdown/search/route.ts",
  "app/api/games/signal-scout/search/route.ts",
  "app/api/signal-check/search/route.ts",
  "app/tools/who-should-i-start/page.tsx",
];

const OPT_IN = ["app/api/search/route.ts"];

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("search pool by surface", () => {
  for (const file of STAY_OUT) {
    it(`${file} searches the default pool`, () => {
      const src = read(file);
      expect(src).toContain("searchFantasyPlayers(");
      expect(src).not.toContain("ranked+idp");
      expect(src).not.toMatch(/pool\s*:/);
    });
  }

  for (const file of OPT_IN) {
    it(`${file} opts into the IDP pool`, () => {
      expect(read(file)).toContain('pool: "ranked+idp"');
    });
  }

  it("the players search route defaults to ranked and only the Free Agent Finder asks for more", () => {
    const route = read("app/api/players/search/route.ts");
    expect(route).toMatch(/=== "ranked\+idp" \? "ranked\+idp" : "ranked"/);
    expect(read("components/free-agent-finder-panel.tsx")).toContain('pool: "ranked+idp"');
    expect(read("app/my-beacon/rankings/[boardId]/board-editor.tsx")).not.toContain("ranked+idp");
  });
});
