import { describe, expect, it } from "vitest";
import {
  statSharedWithDefenders,
  BEAM_STATS,
  bareUnitCandidates,
  getStat,
  statForPosition,
  statLineFor,
} from "@/lib/beam/stats/registry";
import { computeStat, type SeasonAggregate } from "@/lib/beam/stats/query";
import { extractEntities } from "@/lib/beam/interpret/entities";
import { resolvePlayer } from "@/lib/beam/resolve/player";
import { DEFAULT_BEAM_SETTINGS } from "@/lib/beam/default-settings";
import { DeterministicInterpreter } from "@/lib/beam/interpret";

/**
 * BEAM's full IDP support (plan IDP-214, R-20). Replaces the phase 1 gate
 * test: a defender now gets a real defensive stat line.
 */

describe("the stat registry for a defender", () => {
  it("builds a defensive stat line with no offensive stat in it", () => {
    for (const pos of ["DL", "LB", "DB"]) {
      const ids = statLineFor(pos).map((s) => s.id);
      expect(ids).toContain("idp_tkl");
      expect(ids).toContain("idp_points");
      expect(ids.some((id) => /^(pass|rush|rec)_/.test(id))).toBe(false);
      expect(ids).not.toContain("fantasy_points");
    }
  });

  it("swaps the shared words to the defensive reading once the player is a defender", () => {
    expect(statForPosition("def_sack", "LB")).toBe("idp_sack");
    expect(statForPosition("pass_int", "DB")).toBe("idp_int");
    expect(statForPosition("total_td", "DL")).toBe("idp_def_td");
    expect(statForPosition("fantasy_points", "LB")).toBe("idp_points");
    expect(statForPosition("snap_pct", "LB")).toBe("def_snap_pct");
    // Offense and team defense are untouched.
    expect(statForPosition("pass_int", "QB")).toBe("pass_int");
    expect(statForPosition("def_sack", "DEF")).toBe("def_sack");
    expect(statForPosition("fantasy_points", "WR")).toBe("fantasy_points");
  });

  it("reads a bare touchdowns as defensive touchdowns for a defender", () => {
    expect(bareUnitCandidates("touchdowns", "LB").map((s) => s.id)).toEqual([
      "idp_def_td",
    ]);
  });

  it("keeps every phrase owned by exactly one stat", () => {
    const seen = new Map<string, string>();
    for (const stat of BEAM_STATS) {
      for (const phrase of stat.phrasings) {
        expect(
          seen.get(phrase),
          `phrase "${phrase}" owned twice`,
        ).toBeUndefined();
        seen.set(phrase, stat.id);
      }
    }
  });
});

describe("IDP points from the typed columns", () => {
  function agg(overrides: Partial<SeasonAggregate> = {}): SeasonAggregate {
    return {
      playerId: "lb",
      season: 2025,
      window: null,
      weeks: 1,
      gamesPlayed: 1,
      sums: {} as SeasonAggregate["sums"],
      maxes: {} as SeasonAggregate["maxes"],
      present: {} as SeasonAggregate["present"],
      fantasy: { total: 0, weeksWithPoints: 0 },
      idp: { total: 40, weeks: 1 },
      ...overrides,
    };
  }

  it("totals and per-game come from the idp aggregate", () => {
    expect(computeStat(getStat("idp_points"), agg()).value).toBe(40);
    expect(
      computeStat(
        getStat("idp_points_per_game"),
        agg({ gamesPlayed: 2, idp: { total: 30, weeks: 2 } }),
      ).value,
    ).toBe(15);
  });

  it("is null, never zero, for a player with no defensive week", () => {
    expect(
      computeStat(getStat("idp_points"), agg({ idp: { total: 0, weeks: 0 } }))
        .value,
    ).toBeNull();
  });
});

describe("interpretation", () => {
  it("reads tackles and a linebacker from a question", () => {
    const e = extractEntities("how many tackles did roquan smith have in 2025");
    expect(e.statIds).toContain("idp_tkl");
    expect(extractEntities("best linebackers this week").positions).toContain(
      "LB",
    );
    expect(extractEntities("top cornerbacks").positions).toContain("DB");
  });
});

/* A minimal PostgREST stand-in for the resolver's three lookups. */
function fakeDb(players: Array<Record<string, unknown>>) {
  const builder = (rows: unknown[]) => {
    const api: Record<string, unknown> = {};
    for (const op of [
      "select",
      "in",
      "or",
      "order",
      "limit",
      "eq",
      "is",
      "gt",
      "gte",
      "lte",
      "not",
      "ilike",
      "neq",
    ]) {
      api[op] = () => api;
    }
    api.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: rows, error: null }));
    return api;
  };
  return {
    from: (table: string) => builder(table === "players" ? players : []),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as never;
}

const row = (id: string, first: string, last: string, position: string) => ({
  id,
  slug: id,
  first_name: first,
  last_name: last,
  full_name: `${first} ${last}`,
  position,
  team: "CLE",
  status: "active",
  search_name: `${first} ${last}`.toLowerCase(),
  search_last_name: last.toLowerCase(),
  search_rank: 10,
});

describe("resolution with defenders in the pool", () => {
  it("'garrett' asks between Myles Garrett and Garrett Wilson rather than guessing", async () => {
    const result = await resolvePlayer(
      fakeDb([
        row("mg", "Myles", "Garrett", "DL"),
        row("gw", "Garrett", "Wilson", "WR"),
      ]),
      "garrett",
      {
        scope: "historical",
        settings: DEFAULT_BEAM_SETTINGS,
        formatConfigId: null,
        sourceSlug: null,
      },
    );
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((c) => c.name).sort()).toEqual([
        "Garrett Wilson",
        "Myles Garrett",
      ]);
    }
  });

  it("an exact name shared with a defender stays with the offensive player", async () => {
    const opts = {
      scope: "historical" as const,
      settings: DEFAULT_BEAM_SETTINGS,
      formatConfigId: null,
      sourceSlug: null,
    };
    const players = [
      row("jj", "Justin", "Jefferson", "WR"),
      row("jjlb", "Justin", "Jefferson", "LB"),
    ];
    const plain = await resolvePlayer(
      fakeDb(players),
      "justin jefferson",
      opts,
    );
    expect(plain.kind).toBe("resolved");
    if (plain.kind === "resolved") expect(plain.player.position).toBe("WR");
    const tackles = await resolvePlayer(fakeDb(players), "justin jefferson", {
      ...opts,
      statPositionHint: getStat("idp_tkl").positions,
    });
    expect(tackles.kind).toBe("resolved");
    if (tackles.kind === "resolved") expect(tackles.player.position).toBe("LB");
  });

  it("a tackles question narrows the same name to the defender", async () => {
    const result = await resolvePlayer(
      fakeDb([
        row("mg", "Myles", "Garrett", "DL"),
        row("gw", "Garrett", "Wilson", "WR"),
      ]),
      "garrett",
      {
        scope: "historical",
        settings: DEFAULT_BEAM_SETTINGS,
        formatConfigId: null,
        sourceSlug: null,
        statPositionHint: getStat("idp_tkl").positions,
      },
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved")
      expect(result.player.name).toBe("Myles Garrett");
  });
});

describe("review round two", () => {
  it("shared defensive words widen the hint; points and snaps do not", () => {
    expect(statSharedWithDefenders("def_sack")).toBe(true);
    expect(statSharedWithDefenders("pass_int")).toBe(true);
    expect(statSharedWithDefenders("fantasy_points")).toBe(false);
    expect(statSharedWithDefenders("snap_pct")).toBe(false);
  });
  it("reads idp as any defensive player", () => {
    expect(extractEntities("top 10 idp players").positions).toContain("IDP");
  });
});

describe("a value question about a defender", () => {
  function ask(question: string) {
    const db = fakeDb([
      {
        ...row("00000000-0000-4000-8000-000000000001", "Roquan", "Smith", "LB"),
        slug: "roquan-smith",
      },
    ]);
    const ctx = {
      supabase: db,
      admin: db,
      formatSlug: "dynasty-ppr-sflex",
      formatConfigId: "fmt",
      formatDisplay: "Dynasty PPR Superflex",
      scoringKey: "ppr",
      isDynasty: true,
      isSuperflex: true,
      sourceSlug: "ktc",
      sourceDisplay: "KeepTradeCut",
      clock: {
        currentSeason: 2026,
        previousSeason: 2025,
        latestStatSeason: 2026,
        currentSeasonHasStats: true,
        earliestStatSeason: 2020,
        phase: "regular",
        week: 3,
      },
      settings: DEFAULT_BEAM_SETTINGS,
    } as never;
    return new DeterministicInterpreter().interpretVerbose(question, ctx);
  }

  it("declines as not ranked rather than answering with his stat line", async () => {
    const result = await ask("what is roquan smith worth");
    expect(result.trace[0]?.capability).toBe("player.value");
    expect(result.interpretation).toEqual({
      kind: "unsupported",
      reason: "not-ranked",
    });
  });

  it("still answers a bio question that only shares the 'what is' head", async () => {
    const result = await ask("what is roquan smith's age");
    expect(result.interpretation.kind).toBe("request");
    if (result.interpretation.kind === "request") {
      expect(result.interpretation.request.capability).toBe("player.bio");
    }
  });

  it("still answers a rank question that names a statistic", async () => {
    const result = await ask("where does roquan smith rank in tackles");
    expect(result.interpretation.kind).toBe("request");
  });
});
