import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { league: unknown; cached: unknown } = { league: null, cached: null };

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: table === "leagues" ? state.league : null, error: null }),
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/league-format-resolution", () => ({
  resolveLeagueContext: async () => ({ coverage: "exact", sourceSlug: "ktc", formatConfigId: "f" }),
}));
vi.mock("@/lib/league-blueprint/cache", () => ({
  readCachedBlueprint: async () => state.cached,
}));
vi.mock("@/lib/og/assets", async (orig) => ({
  ...(await orig<typeof import("@/lib/og/assets")>()),
  loadRemoteImages: async (urls: unknown[]) => urls.map(() => null),
}));

import { GET as preview } from "./route";
import { GET as share } from "./share/route";
import { buildBlueprintView } from "@/lib/league-blueprint/build";
import { buildBlueprintShareCard } from "@/lib/league-blueprint/share";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "@/lib/league-blueprint/default-settings";
import { SLOTS, buildCards, buildLeague } from "@/lib/league-blueprint/__fixtures__/league";

const params = (league: string, roster: string) => ({ params: Promise.resolve({ league_id: league, roster_id: roster }) });

function fixtureView() {
  const teams = buildLeague();
  return buildBlueprintView({
    sleeperLeagueId: "123",
    season: "2026",
    rosterId: 1,
    generatedAt: "2026-10-29T15:00:00.000Z",
    isDynasty: true,
    isSuperflex: false,
    formatTags: [],
    formatDisplay: "Dynasty PPR",
    sourceSlug: "ktc",
    sourceDisplay: "KTC",
    pickSourceDisplay: null,
    cards: buildCards(teams),
    finderTeams: teams,
    startingSlots: SLOTS,
    pulse: null,
    ledger: null,
    signals: new Map(),
    trends: new Map(),
    formatTopValue: 9000,
    alignedSlots: SLOTS.map((t) => ({ token: t, label: t, description: t })),
    rawStarterSleeperIds: teams[0].players.slice(0, 7).map((p) => p.sleeperId!),
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    spotlightWeek: null,
    strategy: { entries: [], playerIds: [], runs: 1 },
    settings: DEFAULT_LEAGUE_BLUEPRINT_SETTINGS,
  });
}

beforeEach(() => {
  state.league = { id: "L", name: "League", season: 2026, status: "in_season", metadata: {} };
  state.cached = null;
});

describe.each([
  ["preview", preview, "http://x/api/og/blueprint/123/1"],
  ["share", share, "http://x/api/og/blueprint/123/1/share"],
] as const)("%s route", (_name, GET, base) => {
  it("rejects a bad id with a plain 400", async () => {
    const res = await GET(new Request(base), params("12a", "1"));
    expect(res.status).toBe(400);
    const res2 = await GET(new Request(base), params("123", "1234"));
    expect(res2.status).toBe(400);
  });

  it("308s an unknown query to the canonical URL", async () => {
    const res = await GET(new Request(`${base}?source=ktc&x=1`), params("123", "1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${base}?source=ktc`);
  });

  it("returns a 404 card with a short cache for a missing league", async () => {
    state.league = null;
    const res = await GET(new Request(base), params("123", "1"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
  });

  it("returns the placeholder with its cache for a missing row", async () => {
    const res = await GET(new Request(base), params("123", "1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("renders the stored view with the success cache", async () => {
    const view = fixtureView();
    state.cached = { view, fingerprint: "f", modelVersion: view.modelVersion, generatedAt: view.generatedAt };
    const res = await GET(new Request(base), params("123", "1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  });
});

describe("brand check", () => {
  // Comments are stripped: the header states the brand rule in words.
  const source = readFileSync(path.join(__dirname, "card.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .toLowerCase();

  it("uses no DPC colors or wording", () => {
    for (const banned of ["#0c0c18", "gold", "#d4af37", "#ffd700", "dynasty domain", "dpc", "exchange"]) {
      expect(source.includes(banned)).toBe(false);
    }
  });

  it("draws the rings from ring-geometry and runs no engine", () => {
    expect(source).toContain("ringrowsvg(");
    for (const engine of ["findtrades", "pulseleague", "loadblueprint(", "rebuildblueprint"]) {
      expect(source.includes(engine)).toBe(false);
    }
  });

  it("puts no banned word in the card text", () => {
    const text = JSON.stringify(buildBlueprintShareCard(fixtureView())).toLowerCase();
    for (const banned of ["domain", "dpc", "exchange", "oversold", "overbought"]) {
      expect(text.includes(banned)).toBe(false);
    }
  });
});
