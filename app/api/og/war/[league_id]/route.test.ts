import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildChartGeometry } from "@/lib/positional-war/chart-geometry";
import { POSITION_SERIES } from "@/components/chart-kit";
import type { PositionCurve, PulsePosition, WarCurvePoint } from "@/lib/positional-war/types";

const { getClient, setClient } = vi.hoisted(() => {
  let client: unknown = null;
  return {
    getClient: () => client,
    setClient: (c: unknown) => {
      client = c;
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => getClient(),
}));

import { GET } from "./route";
import {
  BRAND,
  isValidLeagueId,
  toPositionCurves,
  buildLegendRows,
  buildWarSvg,
  svgToDataUri,
  buildHeadline,
} from "./card";

/* -----------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------- */

type LeagueFixture = { id: string; name: string; season: number; total_rosters: number | null };

type CacheRowFixture = {
  position: string;
  structural_demand: number;
  war_rank_1: number | null;
  war_at_demand: number | null;
  cliff_rank: number | null;
  curve: unknown;
};

function makeCurvePoint(position: string, rank: number, war: number): WarCurvePoint {
  return {
    playerId: `${position}-${rank}`,
    sleeperId: `${position}-${rank}`,
    slug: `${position.toLowerCase()}-${rank}`,
    name: `${position} Player ${rank}`,
    team: null,
    injuryStatus: null,
    positionRank: rank,
    war,
    pointsAboveReplacement: Math.max(0, war * 10),
    projectedPointsPerWeek: 10 + war,
    replacementPointsPerWeek: 10,
    weeksProjected: 14,
  };
}

function makeCacheRow(
  position: string,
  demand: number,
  warRank1: number,
  cliffRank: number | null = null,
  pointCount = 6,
): CacheRowFixture {
  const curve = Array.from({ length: pointCount }, (_, i) =>
    makeCurvePoint(position, i + 1, warRank1 - i * (warRank1 / (pointCount + 1))),
  );
  return {
    position,
    structural_demand: demand,
    war_rank_1: warRank1,
    war_at_demand: curve[Math.min(demand, curve.length) - 1]?.war ?? null,
    cliff_rank: cliffRank,
    curve,
  };
}

const SIX_POSITION_ROWS: CacheRowFixture[] = [
  makeCacheRow("QB", 2, 0.65, 10),
  makeCacheRow("RB", 24, 1.73, 30),
  makeCacheRow("WR", 30, 1.44, 35),
  makeCacheRow("TE", 12, 0.9, 18),
  makeCacheRow("K", 12, 0.11, 15),
  makeCacheRow("DEF", 12, 0.32, 16),
];

function makeSupabaseMock(opts: { league: LeagueFixture | null; cacheRows: CacheRowFixture[] }) {
  function chainable(result: unknown) {
    const node: {
      eq: (...args: unknown[]) => unknown;
      maybeSingle: () => Promise<unknown>;
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => unknown;
    } = {
      eq: () => chainable(result),
      maybeSingle: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return node;
  }
  return {
    from(table: string) {
      if (table === "leagues") {
        return { select: () => chainable({ data: opts.league, error: null }) };
      }
      if (table === "league_positional_war_cache") {
        return { select: () => chainable({ data: opts.cacheRows, error: null }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  };
}

function req(leagueId: string, qs = "") {
  return {
    request: new Request(`http://test/api/og/war/${leagueId}${qs}`),
    ctx: { params: Promise.resolve({ league_id: leagueId }) },
  };
}

beforeEach(() => {
  setClient(null);
});

/* -----------------------------------------------------------------------
 * isValidLeagueId (E5-5)
 * -------------------------------------------------------------------- */

describe("isValidLeagueId", () => {
  it("accepts a normal Sleeper league id", () => {
    expect(isValidLeagueId("918398921563984384")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidLeagueId("")).toBe(false);
  });

  it("rejects an id over 64 characters", () => {
    expect(isValidLeagueId("a".repeat(65))).toBe(false);
  });

  it("accepts an id at exactly 64 characters", () => {
    expect(isValidLeagueId("a".repeat(64))).toBe(true);
  });
});

/* -----------------------------------------------------------------------
 * GET, response-shape tests
 * -------------------------------------------------------------------- */

describe("GET /api/og/war/[league_id]", () => {
  it("returns 400 for a league id over 64 characters, without touching the database (E5-5)", async () => {
    const { request, ctx } = req("a".repeat(65));
    const res = await GET(request, ctx);
    expect(res.status).toBe(400);
    // setClient(null) in beforeEach: if the route reached createAdminClient()
    // and tried to call .from() on null, this would throw instead of 400ing.
  });

  it("returns the branded not-found image (404) when the league does not exist", async () => {
    setClient(makeSupabaseMock({ league: null, cacheRows: [] }));
    const { request, ctx } = req("999999999999999999");
    const res = await GET(request, ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("returns the branded not-ready image (200) when no curve is cached yet (E5-6)", async () => {
    setClient(
      makeSupabaseMock({
        league: { id: "lg-1", name: "Test League", season: 2026, total_rosters: 12 },
        cacheRows: [],
      }),
    );
    const { request, ctx } = req("111111111111111111");
    const res = await GET(request, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("returns 200 with the documented cache header when a curve is cached (E5-1)", async () => {
    setClient(
      makeSupabaseMock({
        league: { id: "lg-1", name: "Test League", season: 2026, total_rosters: 12 },
        cacheRows: SIX_POSITION_ROWS,
      }),
    );
    const { request, ctx } = req("111111111111111111");
    const res = await GET(request, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders a league with only three positions (no K, no DEF) without crashing", async () => {
    setClient(
      makeSupabaseMock({
        league: { id: "lg-2", name: "IDP League", season: 2026, total_rosters: 10 },
        cacheRows: [
          makeCacheRow("QB", 2, 0.6, 10),
          makeCacheRow("RB", 20, 1.5, 25),
          makeCacheRow("WR", 24, 1.2, 28),
        ],
      }),
    );
    const { request, ctx } = req("222222222222222222");
    const res = await GET(request, ctx);
    expect(res.status).toBe(200);
  });

  describe("?source= is ignored (E5-4)", () => {
    it("produces byte-identical responses with and without ?source=", async () => {
      const mock = () =>
        makeSupabaseMock({
          league: { id: "lg-1", name: "Test League", season: 2026, total_rosters: 12 },
          cacheRows: SIX_POSITION_ROWS,
        });

      setClient(mock());
      const plain = req("111111111111111111");
      const resPlain = await GET(plain.request, plain.ctx);
      const bufPlain = Buffer.from(await resPlain.arrayBuffer());

      setClient(mock());
      const withSource = req("111111111111111111", "?source=fantasycalc");
      const resWithSource = await GET(withSource.request, withSource.ctx);
      const bufWithSource = Buffer.from(await resWithSource.arrayBuffer());

      expect(resPlain.status).toBe(resWithSource.status);
      expect(Buffer.compare(bufPlain, bufWithSource)).toBe(0);
    });

    it("the route source never reads the source query param at all", () => {
      const source = readFileSync(join(__dirname, "route.tsx"), "utf8");
      expect(source).not.toMatch(/searchParams\.get\(\s*["']source["']\s*\)/);
      expect(source).not.toContain("new URL(");
    });
  });
});

/* -----------------------------------------------------------------------
 * toPositionCurves
 * -------------------------------------------------------------------- */

describe("toPositionCurves", () => {
  it("maps cache rows into PositionCurve shape", () => {
    const curves = toPositionCurves([makeCacheRow("RB", 24, 1.73, 30)]);
    expect(curves).toHaveLength(1);
    expect(curves[0]).toMatchObject({
      position: "RB",
      structuralDemand: 24,
      warRank1: 1.73,
      cliffRank: 30,
    });
    expect(curves[0].curve.length).toBe(6);
  });

  it("drops rows whose position is not a recognized PulsePosition", () => {
    const curves = toPositionCurves([
      { position: "BOGUS", structural_demand: 1, war_rank_1: 1, war_at_demand: 1, cliff_rank: null, curve: [] },
      makeCacheRow("QB", 2, 0.65),
    ]);
    expect(curves).toHaveLength(1);
    expect(curves[0].position).toBe("QB");
  });

  it("defaults curve to an empty array when the stored value is not an array", () => {
    const curves = toPositionCurves([
      { position: "QB", structural_demand: 2, war_rank_1: null, war_at_demand: null, cliff_rank: null, curve: null },
    ]);
    expect(curves[0].curve).toEqual([]);
  });
});

/* -----------------------------------------------------------------------
 * buildLegendRows
 * -------------------------------------------------------------------- */

describe("buildLegendRows", () => {
  it("orders rows in canonical QB/RB/WR/TE/K/DEF order regardless of input order", () => {
    const curves = toPositionCurves([
      makeCacheRow("DEF", 12, 0.32),
      makeCacheRow("QB", 2, 0.65),
      makeCacheRow("K", 12, 0.11),
    ]);
    const rows = buildLegendRows(curves);
    expect(rows.map((r) => r.position)).toEqual(["QB", "K", "DEF"]);
  });

  it("skips positions with no plotted curve", () => {
    const curves = toPositionCurves([makeCacheRow("QB", 2, 0.65)]);
    curves.push({
      position: "RB",
      structuralDemand: 24,
      replacementPoints: null,
      avgSeatedPoints: null,
      deficit: null,
      shallowPool: false,
      warRank1: null,
      warAtDemand: null,
      cliffRank: null,
      curve: [],
      weeklyDiagnostics: [],
    });
    const rows = buildLegendRows(curves);
    expect(rows.map((r) => r.position)).toEqual(["QB"]);
  });

  it("renders a dash when war_at_demand is null", () => {
    const curves: PositionCurve[] = [
      {
        position: "QB",
        structuralDemand: 2,
        replacementPoints: null,
        avgSeatedPoints: null,
        deficit: null,
        shallowPool: true,
        warRank1: 0.5,
        warAtDemand: null,
        cliffRank: null,
        curve: [makeCurvePoint("QB", 1, 0.5)],
        weeklyDiagnostics: [],
      },
    ];
    const rows = buildLegendRows(curves);
    expect(rows[0].label).toBe("QB - (2 start)");
  });

  it("formats the label with two decimal places and the structural demand count", () => {
    const curves = toPositionCurves([
      {
        position: "RB",
        structural_demand: 24,
        war_rank_1: 1.73,
        war_at_demand: 1.73,
        cliff_rank: 30,
        curve: [makeCurvePoint("RB", 1, 1.73)],
      },
    ]);
    const rows = buildLegendRows(curves);
    expect(rows[0].label).toBe("RB 1.73 (24 start)");
  });

  it("uses the exact POSITION_SERIES color for each row", () => {
    const curves = toPositionCurves(SIX_POSITION_ROWS);
    const rows = buildLegendRows(curves);
    for (const row of rows) {
      expect(row.color).toBe(POSITION_SERIES[row.position as PulsePosition].color);
    }
  });
});

/* -----------------------------------------------------------------------
 * buildWarSvg: geometry parity (E5-2) and brand safety (E5-3)
 * -------------------------------------------------------------------- */

describe("buildWarSvg", () => {
  const WIDTH = 1040;
  const HEIGHT = 380;
  const PADDING = { t: 16, r: 16, b: 16, l: 16 };

  it("draws each series' path exactly as buildChartGeometry computed it (E5-2)", () => {
    const curves = toPositionCurves(SIX_POSITION_ROWS);
    const geometry = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const svg = buildWarSvg(curves, geometry, WIDTH, HEIGHT);

    expect(geometry.series.length).toBeGreaterThan(0);
    for (const series of geometry.series) {
      // The exact path string from the geometry module appears verbatim in
      // the SVG: the route never recomputes an x, y, or path of its own.
      expect(svg).toContain(series.d);
    }
  });

  it("computes the same geometry the page's own depth-mode call would produce for identical curves", () => {
    const curves = toPositionCurves(SIX_POSITION_ROWS);
    const fromRoute = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    // Simulates a second caller (the on-page chart) building geometry from
    // the same curves independently. The two must be identical field-for-field.
    const fromPage = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    expect(fromRoute).toEqual(fromPage);
  });

  it("contains no gold hex value and no #0c0c18 (E5-3)", () => {
    const curves = toPositionCurves(SIX_POSITION_ROWS);
    const geometry = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const svg = buildWarSvg(curves, geometry, WIDTH, HEIGHT);

    const allowed = new Set(
      [...Object.values(BRAND), ...Object.values(POSITION_SERIES).map((s) => s.color)].map((c) =>
        c.toLowerCase(),
      ),
    );
    const hexMatches = svg.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexMatches.length).toBeGreaterThan(0);
    for (const hex of hexMatches) {
      expect(allowed.has(hex.toLowerCase())).toBe(true);
    }
    expect(svg.toLowerCase()).not.toContain("#0c0c18");
    // A small explicit denylist as a second, independent signal beyond the
    // allow-list scan above.
    for (const gold of ["#d4af37", "#ffd700", "#b8860b", "#c9a227", "#e6b800"]) {
      expect(svg.toLowerCase()).not.toContain(gold);
    }
  });

  it("stays a modest size even at the display cap for a deep league", () => {
    const deepRow = makeCacheRow("RB", 24, 1.73, 30, 105);
    const curves = toPositionCurves([deepRow]);
    const geometry = buildChartGeometry({ curves, mode: "depth", width: WIDTH, height: HEIGHT, padding: PADDING });
    const svg = buildWarSvg(curves, geometry, WIDTH, HEIGHT);
    const dataUri = svgToDataUri(svg);
    // "a few kilobytes" per the plan; assert well under a wasteful threshold.
    expect(dataUri.length).toBeLessThan(50_000);
  });
});

/* -----------------------------------------------------------------------
 * Route source: no gold, no #0c0c18, brand constants match the league route
 * -------------------------------------------------------------------- */

describe("brand constants (E5-3)", () => {
  it("BRAND matches the exact values used by app/api/og/league/[league_id]/route.tsx", () => {
    expect(BRAND).toEqual({
      BG: "#0F0F1A",
      BG_BASE: "#07070D",
      INK: "#F4F4F8",
      INK_MUTED: "#A8A8B8",
      INK_SUBTLE: "#6B6B7D",
      PURPLE: "#A855F7",
      CYAN: "#22D3EE",
      LINE: "#1F1F33",
    });
  });

  it("no hex color literal used in CODE falls outside BRAND plus the series palette", () => {
    // The literal color values live in card.tsx (route.tsx only references
    // BRAND.* by identifier). Comments are allowed to name a forbidden value
    // defensively (the file carries "NEVER reference DPC's gold or violet on
    // #0c0c18", matching the league route's own comment). Only literals
    // reachable at runtime matter for this check, so comments are stripped
    // before scanning, and both files in the route folder are scanned.
    const routeSource = readFileSync(join(__dirname, "route.tsx"), "utf8");
    const cardSource = readFileSync(join(__dirname, "card.tsx"), "utf8");
    const codeOnly = (routeSource + "\n" + cardSource)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const allowed = new Set(
      [...Object.values(BRAND), ...Object.values(POSITION_SERIES).map((s) => s.color)].map((c) =>
        c.toLowerCase(),
      ),
    );
    const hexMatches = codeOnly.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexMatches.length).toBeGreaterThan(0);
    for (const hex of hexMatches) {
      expect(allowed.has(hex.toLowerCase())).toBe(true);
    }
    expect(codeOnly.toLowerCase()).not.toContain("#0c0c18");
  });
});

/* -----------------------------------------------------------------------
 * buildHeadline: deterministic across calls, including tie cases. Reuses
 * selectScarcestAndDeepest() from components/league-war/selection.ts rather
 * than reimplementing the tie-break rule, so this only covers wiring plus
 * the sentence template, not the selection algorithm itself (covered by
 * components/league-war/selection.test.ts and summary.test.ts).
 * -------------------------------------------------------------------- */

describe("buildHeadline", () => {
  it("names the scarcest position by its long name", () => {
    const curves = toPositionCurves(SIX_POSITION_ROWS);
    expect(buildHeadline(curves)).toBe("Running back is the scarcest position in this league.");
  });

  it("is deterministic across repeated calls, including a tie case", () => {
    const curves = toPositionCurves([
      makeCacheRow("QB", 2, 1.0, 20),
      makeCacheRow("RB", 24, 1.0, 8),
      makeCacheRow("WR", 30, 1.0, 15),
    ]);
    const first = buildHeadline(curves);
    const second = buildHeadline(curves);
    const third = buildHeadline([...curves].reverse());
    expect(first).toBe(second);
    expect(first).toBe(third);
    expect(first).toBe("Running back is the scarcest position in this league.");
  });

  it("falls back to null (route renders 'Positional WAR is still calculating.') with no plottable curve", () => {
    expect(buildHeadline([])).toBeNull();
  });
});
