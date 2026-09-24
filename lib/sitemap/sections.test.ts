import { describe, expect, it } from "vitest";
import { idpPlayerSlugs } from "./sections";
import { bustMemo } from "@/lib/memo-ttl";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plan IDP-215 (R-17): a defender who passes the relevance gate is in the
 * players sitemap; one who does not is left out (and noindexed on the page).
 */
function fakeAdmin(opts: { players: Array<{ id: string; slug: string }>; seasons: string[]; depth: string[] }) {
  return {
    from(table: string) {
      let columns = "";
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const api: Record<string, unknown> = {
        select(c: string) {
          columns = c;
          return api;
        },
        range(f: number, t: number) {
          from = f;
          to = t;
          return api;
        },
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          let rows: unknown[] = [];
          if (table === "player_idp_seasons") rows = opts.seasons.map((id) => ({ player_id: id }));
          else if (table === "players" && columns === "id") rows = opts.depth.map((id) => ({ id }));
          else if (table === "players") rows = opts.players;
          return Promise.resolve(resolve({ data: rows.slice(from, to + 1), error: null }));
        },
      };
      for (const op of ["in", "gte", "not", "order", "eq"]) api[op] = () => api;
      return api;
    },
  } as never;
}

describe("idpPlayerSlugs", () => {
  it("lists gated defenders and leaves the rest out", async () => {
    bustMemo("ref:idp-relevant-ids");
    const slugs = await idpPlayerSlugs(
      fakeAdmin({
        players: [
          { id: "a", slug: "myles-garrett-3973" },
          { id: "b", slug: "rookie-lb-1" },
          { id: "c", slug: "practice-squad-db-2" },
        ],
        seasons: ["a"],
        depth: ["b"],
      }),
    );
    expect(slugs.sort()).toEqual(["myles-garrett-3973", "rookie-lb-1"]);
  });
});

describe("llms-full.txt player paragraph", () => {
  it("describes a defender profile without promising trade value", () => {
    const src = readFileSync(join(process.cwd(), "lib/llms/llms-full-txt.ts"), "utf8");
    expect(src).toContain("has no trade value, because no value source prices defenders");
    expect(src).toContain("snap share");
  });
});
