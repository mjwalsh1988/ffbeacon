import { describe, it, expect } from "vitest";
import { readWeather } from "@/lib/nfl-weather-impact";
import {
  buildDefenseGrid,
  buildPreview,
  buildTeamRecords,
  ordinalMost,
  rankTotals,
  teamNickname,
  type PreviewInput,
} from "./games";
import type { DefenseVsPositionRow, TeamSide } from "./types";

function side(code: string, name: string, implied: number | null): TeamSide {
  return { code, name, nickname: teamNickname(name), color: null, score: null, implied };
}

describe("teamNickname", () => {
  it("takes the last word, the one a listener hears as the team", () => {
    expect(teamNickname("Atlanta Falcons")).toBe("Falcons");
    expect(teamNickname("San Francisco 49ers")).toBe("49ers");
  });
});

describe("ordinalMost", () => {
  it("spells the first three and counts the rest", () => {
    expect(ordinalMost(1)).toBe("most");
    expect(ordinalMost(2)).toBe("second most");
    expect(ordinalMost(3)).toBe("third most");
    expect(ordinalMost(4)).toBe("4th most");
    expect(ordinalMost(1, "fewest")).toBe("fewest");
  });
});

describe("buildTeamRecords", () => {
  it("adds up wins, losses, ties and points, best record first", () => {
    const records = buildTeamRecords(
      [
        { week: 1, team: "BUF", opponent: "NE", pointsFor: 30, pointsAgainst: 10 },
        { week: 1, team: "NE", opponent: "BUF", pointsFor: 10, pointsAgainst: 30 },
        { week: 2, team: "BUF", opponent: "MIA", pointsFor: 20, pointsAgainst: 20 },
        { week: 2, team: "MIA", opponent: "BUF", pointsFor: 20, pointsAgainst: 20 },
      ],
      new Map([
        ["BUF", "Buffalo Bills"],
        ["NE", "New England Patriots"],
      ]),
    );
    expect(records.map((r) => r.code)).toEqual(["BUF", "MIA", "NE"]);
    expect(records[0]).toMatchObject({ wins: 1, losses: 0, ties: 1, pointsFor: 50, pointsAgainst: 30, games: 2 });
    // A team with no name on file keeps its code rather than going blank.
    expect(records[1].name).toBe("MIA");
  });
});

describe("buildDefenseGrid", () => {
  it("ranks on the figure it prints, 1 being the most points allowed", () => {
    const grid = buildDefenseGrid(
      [
        { team: "GB", position: "WR", perGame: 35.467, games: 3 },
        { team: "HOU", position: "WR", perGame: 39.967, games: 3 },
        { team: "GB", position: "QB", perGame: 14, games: 3 },
        // A position the grid does not show is left out.
        { team: "GB", position: "K", perGame: 9, games: 3 },
      ],
      new Map([["GB", "Green Bay Packers"]]),
    );
    const gb = grid.find((r) => r.team === "GB");
    expect(gb?.cells.WR).toEqual({ perGame: 35.5, rank: 2, games: 3 });
    expect(gb?.cells.QB?.rank).toBe(1);
    expect(gb?.cells.K).toBeUndefined();
    expect(grid.find((r) => r.team === "HOU")?.cells.WR?.rank).toBe(1);
  });
});

describe("rankTotals", () => {
  it("ranks only the games that have a total", () => {
    const { byHome, ranked } = rankTotals([
      { home: "BUF", total: 48.5 },
      { home: "GB", total: null },
      { home: "KC", total: 51 },
    ]);
    expect(ranked).toBe(2);
    expect(byHome.get("KC")).toBe(1);
    expect(byHome.get("BUF")).toBe(2);
    expect(byHome.has("GB")).toBe(false);
  });
});

describe("buildPreview", () => {
  const defense = new Map<string, DefenseVsPositionRow>(
    Array.from({ length: 32 }, (_, i) => {
      const team = `T${i}`;
      return [team, { team, name: team, cells: { WR: { perGame: 30, rank: i + 1, games: 3 } } }];
    }),
  );
  const base: PreviewInput = {
    week: 4,
    away: side("T10", "New England Patriots", 21),
    home: side("T11", "Buffalo Bills", 27.5),
    homeSpread: -6.5,
    total: 48.5,
    totalRank: 3,
    rankedGames: 16,
    defense,
    weather: readWeather(null),
  };

  it("says who is favoured and what each side is expected to score", () => {
    const [line] = buildPreview(base);
    expect(line).toBe(
      "The Bills are favoured by 6.5 at home. The Patriots are expected to score about 21 and the Bills about 27.5, a combined 48.5, one of the three highest this week.",
    );
  });

  it("names a road favourite as one", () => {
    expect(buildPreview({ ...base, homeSpread: 3 })[0]).toMatch(/The Patriots are favoured by 3 on the road\./);
  });

  it("writes no scoring sentence when there is no line", () => {
    const preview = buildPreview({
      ...base,
      homeSpread: null,
      total: null,
      away: side("T10", "New England Patriots", null),
      home: side("T11", "Buffalo Bills", null),
    });
    expect(preview).toEqual([]);
  });

  it("names the softest matchup when a defense is among the five most generous", () => {
    const preview = buildPreview({
      ...base,
      away: side("T1", "New England Patriots", 21),
    });
    expect(preview[1]).toBe(
      "The Patriots have allowed the second most fantasy points to wide receivers this season, 30 a game, which is the softest matchup here for the Bills.",
    );
  });

  it("says nothing about matchups when neither defense is at an extreme", () => {
    expect(buildPreview(base)).toHaveLength(1);
  });

  it("names a stingy defense when there is no soft one", () => {
    const preview = buildPreview({ ...base, home: side("T31", "Buffalo Bills", 27.5) });
    expect(preview[1]).toBe("The Bills have allowed the fewest fantasy points to wide receivers this season, 30 a game.");
  });

  it("ignores a defense measured over too few games", () => {
    const thin = new Map(defense);
    thin.set("T1", { team: "T1", name: "T1", cells: { WR: { perGame: 50, rank: 1, games: 1 } } });
    expect(buildPreview({ ...base, away: side("T1", "New England Patriots", 21), defense: thin })).toHaveLength(1);
  });

  it("adds the forecast and what it means, and stays silent on an unknown one", () => {
    const windy = readWeather({
      isIndoor: false,
      roof: "outdoors",
      stadium: null,
      city: null,
      provider: "nws",
      fetchedAt: null,
      leadHours: 20,
      tempF: 41,
      feelsLikeF: 41,
      windMph: 18,
      windGustMph: 27,
      windDirDeg: 270,
      windMphMax3h: 18,
      precipProbPct: 10,
      precipIn: 0,
      snowIn: 0,
      humidityPct: 50,
      conditions: null,
    });
    const preview = buildPreview({ ...base, weather: windy });
    expect(preview.at(-1)).toMatch(/^41 degrees, wind 18 mph from the west gusting to 27/);
    expect(preview.at(-1)).toMatch(/think twice about the kicker/);
    expect(buildPreview(base).join(" ")).not.toMatch(/forecast/i);
  });
});

describe("the stingiest defense, with a tie", () => {
  it("calls two defenses tied for the fewest both the fewest", () => {
    const defense = new Map<string, DefenseVsPositionRow>(
      Array.from({ length: 32 }, (_, i) => {
        const team = `T${i}`;
        // The last two allow the same, lowest figure and share rank 31.
        const perGame = i >= 30 ? 10 : 40 - i;
        const rank = i >= 30 ? 31 : i + 1;
        return [team, { team, name: team, cells: { WR: { perGame, rank, games: 3 } } }];
      }),
    );
    const preview = buildPreview({
      week: 4,
      away: side("T10", "New England Patriots", 21),
      home: side("T31", "Buffalo Bills", 27.5),
      homeSpread: null,
      total: null,
      totalRank: null,
      rankedGames: 0,
      defense,
      weather: null,
    });
    expect(preview).toEqual(["The Bills have allowed the fewest fantasy points to wide receivers this season, 10 a game."]);
  });
});
