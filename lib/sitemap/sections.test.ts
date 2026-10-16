import { describe, expect, it } from "vitest";
import {
  communityRankingPaths,
  idpPlayerSlugs,
  newestWeatherQuery,
  seasonPulseSitemapUrls,
  staticSitemapPaths,
} from "./sections";
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

describe("staticSitemapPaths", () => {
  it("lists the guillotine calculator beside the FAAB calculator", () => {
    const paths = staticSitemapPaths().map((entry) => entry.path);
    expect(paths).toContain("/tools/faab/guillotine");
    expect(paths.indexOf("/tools/faab/guillotine")).toBe(paths.indexOf("/tools/faab") + 1);
  });

  it("lists the IDP rankings at the format boards' priority", () => {
    expect(staticSitemapPaths()).toContainEqual({ path: "/rankings/idp", priority: 0.8 });
  });
});

/** A client whose nfl_game_weather read returns the given fetched_at values, newest first. */
function fakeWeatherAdmin(fetchedAt: string[]) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      let limit = Number.MAX_SAFE_INTEGER;
      const api: Record<string, unknown> = {
        select(c: string) {
          calls.push(`select:${c}`);
          return api;
        },
        order(c: string, o: { ascending: boolean }) {
          calls.push(`order:${c}:${o.ascending ? "asc" : "desc"}`);
          return api;
        },
        limit(n: number) {
          calls.push(`limit:${n}`);
          limit = n;
          return api;
        },
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          const rows = table === "nfl_game_weather" ? fetchedAt.map((f) => ({ fetched_at: f })) : [];
          return Promise.resolve(resolve({ data: rows.slice(0, limit), error: null }));
        },
      };
      return api;
    },
  };
  return { client: client as never, calls };
}

describe("weather lastmod", () => {
  it("dates the weather page from the newest forecast read and no other Season Pulse page", async () => {
    const { client, calls } = fakeWeatherAdmin([
      "2026-10-15T13:45:12.000Z",
      "2026-10-14T13:45:09.000Z",
    ]);
    const { data } = await newestWeatherQuery(client);
    expect(calls).toEqual([
      "from:nfl_game_weather",
      "select:fetched_at",
      "order:fetched_at:desc",
      "limit:1",
    ]);

    const urls = seasonPulseSitemapUrls(6, (data as Array<{ fetched_at: string }>)[0]?.fetched_at);
    const weather = urls.find((u) => u.loc.endsWith("/season/weather"));
    expect(weather?.lastModified?.toISOString()).toBe("2026-10-15T13:45:12.000Z");

    const others = urls.filter((u) => !u.loc.endsWith("/season/weather"));
    expect(others.map((u) => u.loc)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/season$/),
        expect.stringMatching(/\/season\/leaders$/),
        expect.stringMatching(/\/season\/stats$/),
      ]),
    );
    for (const url of others) expect(url.lastModified).toBeUndefined();
  });

  it("is wired into the core section with the newest read's fetched_at", () => {
    // coreSection needs a dozen other reads to run, so its wiring is checked in
    // the source rather than by faking every one of them.
    const src = readFileSync(join(process.cwd(), "lib/sitemap/sections.ts"), "utf8");
    expect(src).toContain("newestWeatherQuery(supabase),");
    expect(src).toContain("seasonPulseSitemapUrls(clock.currentWeek, newestWeather?.[0]?.fetched_at)");
  });

  it("leaves the weather page undated when no forecast has been read", () => {
    const weather = seasonPulseSitemapUrls(6, undefined).find((u) =>
      u.loc.endsWith("/season/weather"),
    );
    expect(weather).toBeDefined();
    expect(weather?.lastModified).toBeUndefined();
  });
});

describe("communityRankingPaths", () => {
  it("lists nothing while no format has published, since the page is noindex", () => {
    expect(communityRankingPaths(["a", "b"], [])).toEqual([]);
  });
  it("lists the bare path for the first published format and ?format= for the rest", () => {
    expect(communityRankingPaths(["a", "b", "c"], ["c", "b"])).toEqual([
      "/rankings/community",
      "/rankings/community?format=c",
    ]);
  });
  it("ignores a published slug that is no longer an active format", () => {
    expect(communityRankingPaths(["a"], ["gone"])).toEqual([]);
  });
});
