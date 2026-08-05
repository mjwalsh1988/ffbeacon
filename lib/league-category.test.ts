import { describe, it, expect } from "vitest";
import type { SleeperLeague } from "@/lib/sleeper";
import { categorizeLeague, groupLeaguesByCategory } from "./league-category";

function league(over: Partial<SleeperLeague>): SleeperLeague {
  return {
    league_id: over.league_id ?? "1",
    name: over.name ?? "League",
    season: "2026",
    sport: "nfl",
    status: "in_season",
    total_rosters: 12,
    ...over,
  };
}

describe("categorizeLeague", () => {
  it("classifies dynasty via settings.type === 2", () => {
    expect(categorizeLeague(league({ settings: { type: 2 } }))).toBe("dynasty");
  });

  it("keeps a continued redraft league (type 0 + previous_league_id) as redraft", () => {
    // Sleeper carries previous_league_id on any season-to-season league, redraft
    // included, so it must NOT be read as a dynasty signal for grouping.
    expect(
      categorizeLeague(
        league({ settings: { type: 0 }, previous_league_id: "999" }),
      ),
    ).toBe("redraft");
  });

  it("classifies redraft when type is 0", () => {
    expect(
      categorizeLeague(
        league({ settings: { type: 0 }, previous_league_id: "" }),
      ),
    ).toBe("redraft");
  });

  it("groups keeper (type 1) and chopped (type 3) leagues into redraft", () => {
    expect(categorizeLeague(league({ settings: { type: 1 } }))).toBe("redraft");
    expect(categorizeLeague(league({ settings: { type: 3 } }))).toBe("redraft");
  });

  it("classifies best ball dynasty (best_ball=1 + dynasty)", () => {
    expect(
      categorizeLeague(league({ settings: { type: 2, best_ball: 1 } })),
    ).toBe("best-ball-dynasty");
  });

  it("classifies best ball redraft (best_ball=1 + redraft)", () => {
    expect(
      categorizeLeague(league({ settings: { type: 0, best_ball: 1 } })),
    ).toBe("best-ball-redraft");
  });
});

describe("groupLeaguesByCategory", () => {
  it("orders buckets Dynasty, Redraft, Best Ball Dynasty, Best Ball Redraft and drops empty ones", () => {
    const groups = groupLeaguesByCategory([
      league({
        league_id: "a",
        name: "Zeta",
        settings: { type: 0, best_ball: 1 },
      }), // BB redraft
      league({ league_id: "b", name: "Alpha", settings: { type: 2 } }), // dynasty
      league({ league_id: "c", name: "Bravo", settings: { type: 0 } }), // redraft
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "dynasty",
      "redraft",
      "best-ball-redraft",
    ]);
    // best-ball-dynasty had no leagues, so it isn't emitted.
    expect(groups.some((g) => g.key === "best-ball-dynasty")).toBe(false);
  });

  it("alphabetizes leagues case-insensitively within a bucket", () => {
    const groups = groupLeaguesByCategory([
      league({ league_id: "1", name: "charlie", settings: { type: 2 } }),
      league({ league_id: "2", name: "Alpha", settings: { type: 2 } }),
      league({ league_id: "3", name: "bravo", settings: { type: 2 } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].leagues.map((l) => l.name)).toEqual([
      "Alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("orders a bucket Competitor, Mid Tier, Rebuilder, then unsynced", () => {
    const groups = groupLeaguesByCategory(
      [
        league({ league_id: "reb", name: "Alpha", settings: { type: 2 } }),
        league({ league_id: "none", name: "Bravo", settings: { type: 2 } }),
        league({ league_id: "mid", name: "Charlie", settings: { type: 2 } }),
        league({ league_id: "comp", name: "Delta", settings: { type: 2 } }),
      ],
      {
        reb: "rebuilder",
        mid: "middle",
        comp: "competitor",
        // "none" is deliberately absent: a league we have never pulsed.
      },
    );
    expect(groups[0].leagues.map((l) => l.league_id)).toEqual([
      "comp",
      "mid",
      "reb",
      "none",
    ]);
  });

  it("alphabetizes within a standing band", () => {
    const groups = groupLeaguesByCategory(
      [
        league({ league_id: "1", name: "Zeta", settings: { type: 2 } }),
        league({ league_id: "2", name: "alpha", settings: { type: 2 } }),
        league({ league_id: "3", name: "Mid", settings: { type: 2 } }),
      ],
      { 1: "competitor", 2: "competitor", 3: "middle" },
    );
    expect(groups[0].leagues.map((l) => l.name)).toEqual([
      "alpha",
      "Zeta",
      "Mid",
    ]);
  });

  it("treats a cached row with no standing as unsynced", () => {
    const groups = groupLeaguesByCategory(
      [
        league({ league_id: "known", name: "Zeta", settings: { type: 2 } }),
        league({ league_id: "blank", name: "Alpha", settings: { type: 2 } }),
      ],
      // A pulsed league with no Power Pulse row arrives as an explicit null. It
      // must sort with the unsynced ones, not ahead of a real rebuilder.
      { known: "rebuilder", blank: null },
    );
    expect(groups[0].leagues.map((l) => l.league_id)).toEqual([
      "known",
      "blank",
    ]);
  });

  it("sorts each category independently", () => {
    const groups = groupLeaguesByCategory(
      [
        league({ league_id: "d1", name: "Zeta", settings: { type: 2 } }),
        league({ league_id: "d2", name: "Alpha", settings: { type: 2 } }),
        league({ league_id: "r1", name: "Zulu", settings: { type: 0 } }),
        league({ league_id: "r2", name: "Bravo", settings: { type: 0 } }),
      ],
      { d1: "competitor", d2: "rebuilder", r1: "competitor", r2: "rebuilder" },
    );
    expect(groups.map((g) => g.leagues.map((l) => l.league_id))).toEqual([
      ["d1", "d2"],
      ["r1", "r2"],
    ]);
  });

  it("falls back to pure alphabetical when no standings are supplied", () => {
    const groups = groupLeaguesByCategory([
      league({ league_id: "1", name: "charlie", settings: { type: 2 } }),
      league({ league_id: "2", name: "Alpha", settings: { type: 2 } }),
    ]);
    expect(groups[0].leagues.map((l) => l.name)).toEqual(["Alpha", "charlie"]);
  });

  it("does not mutate the input array order", () => {
    const input = [
      league({ league_id: "1", name: "Bravo", settings: { type: 2 } }),
      league({ league_id: "2", name: "Alpha", settings: { type: 2 } }),
    ];
    groupLeaguesByCategory(input);
    expect(input.map((l) => l.name)).toEqual(["Bravo", "Alpha"]);
  });
});
