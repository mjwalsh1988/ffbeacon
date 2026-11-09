import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { careerMarks } from "./career-marks";
import { careerSpan } from "./career-span";
import { collegePath } from "./college-path";
import { draftClass } from "./draft-class";
import { franchiseEra } from "./franchise-era";
import { historyFinish } from "./history-finish";
import { decadeWindows, eraPositions } from "./history-shared";
import { historyStatLine, statWindows } from "./history-stat-line";
import { fakeCtx } from "./test-context";

const ASCII = /^[\x20-\x7E]+$/;
const ALL = [franchiseEra, careerSpan, draftClass, collegePath, careerMarks, historyStatLine, historyFinish];

describe("history families", () => {
  it("all skip when the pool is not synced", () => {
    for (const f of ALL) expect(f.draws(mulberry32(1), fakeCtx({ historyReady: false }))).toEqual([]);
  });

  it("every draw renders ASCII text and names its position when it has one", () => {
    const ctx = fakeCtx();
    for (const f of ALL) {
      const draws = f.draws(mulberry32(7), ctx);
      expect(draws.length).toBeGreaterThan(0);
      for (const p of draws) {
        const text = f.text(p, ctx);
        expect(text).toMatch(ASCII);
        expect(text.startsWith("Name a ")).toBe(true);
        if (p.position) expect(f.position!(p)).toBe(p.position);
      }
    }
  });

  it("asks positions the rosters of the era hold and never a window the floor excludes", () => {
    expect(eraPositions(1940)).toEqual(["QB", "RB"]);
    expect(eraPositions(1950)).toEqual(["QB", "RB", "WR"]);
    expect(eraPositions(1960)).toHaveLength(4);
    expect(decadeWindows(1950, 2026)).toEqual([
      { from: 1950, to: 1959 },
      { from: 1960, to: 1969 },
      { from: 1970, to: 1979 },
      { from: 1980, to: 1989 },
      { from: 1990, to: 1999 },
      { from: 2000, to: 2009 },
      { from: 2010, to: 2019 },
    ]);
    expect(decadeWindows(1985, 2026)[0]).toEqual({ from: 1990, to: 1999 });
    for (const p of franchiseEra.draws(mulberry32(2), fakeCtx({ historyFloorSeason: 1990 }))) {
      expect(Number(p.from)).toBeGreaterThanOrEqual(1990);
    }
  });

  it("stat windows start at 1999 and stop before the current season", () => {
    expect(statWindows(1950, 2026)).toEqual([
      { from: 1999, to: 2009 },
      { from: 2010, to: 2019 },
    ]);
    expect(statWindows(2005, 2026)).toEqual([{ from: 2010, to: 2019 }]);
  });

  it("phrases each form to the data that proves it", () => {
    const ctx = fakeCtx();
    expect(franchiseEra.text({ franchise: "raiders", from: 1970, to: 1979, position: "QB" }, ctx)).toBe(
      "Name a quarterback who played for the Raiders between 1970 and 1979.",
    );
    expect(franchiseEra.text({ franchise: "titans", from: 1980, to: 1989, position: "RB" }, ctx)).toContain("the Oilers between");
    expect(franchiseEra.text({ franchise: "titans", from: 1990, to: 1999, position: "RB" }, ctx)).toContain("the Oilers or Titans");
    expect(franchiseEra.text({ franchise: "titans", from: 2000, to: 2009, position: "RB" }, ctx)).toContain("the Titans");
    expect(franchiseEra.text({ franchise: "commanders", from: 1980, to: 1989, position: "RB" }, ctx)).toContain("for Washington");
    expect(careerSpan.text({ from: 1970, to: 1979, position: "QB", minSeasons: 10 }, ctx)).toBe(
      "Name a quarterback whose first NFL season was between 1970 and 1979 and who played at least 10 seasons.",
    );
    expect(draftClass.text({ form: "position", position: "WR", round: 1, from: 1990, to: 1999 }, ctx)).toBe(
      "Name a wide receiver drafted in the first round between 1990 and 1999.",
    );
    expect(draftClass.text({ form: "team", franchise: "packers", round: 1, since: 1980 }, ctx)).toBe(
      "Name a quarterback, running back, receiver or tight end drafted in the first round by the Packers in 1980 or later.",
    );
    expect(draftClass.position!({ form: "team", franchise: "packers", round: 1, since: 1980 })).toBeNull();
    expect(collegePath.text({ college: "Ohio State", position: "RB", since: 1990 }, ctx)).toBe(
      "Name a running back from Ohio State who played in the NFL in 1990 or later.",
    );
    expect(careerMarks.text({ form: "hof", position: "TE" }, ctx)).toBe("Name a Hall of Fame tight end drafted in 1980 or later.");
    expect(careerMarks.text({ form: "pro_bowls", position: "WR", n: 5 }, ctx)).toBe(
      "Name a wide receiver drafted in 1980 or later with 5 or more Pro Bowl selections.",
    );
    expect(careerMarks.text({ form: "total", position: "QB", stat: "pass_yd", n: 40000 }, ctx)).toBe(
      "Name a quarterback with 40,000 or more passing yards since 1999.",
    );
    expect(historyStatLine.text({ position: "RB", line: "game_rush_yd", n: 200, from: 2000, to: 2009 }, ctx)).toBe(
      "Name a running back who had a 200-yard rushing game between 2000 and 2009.",
    );
    expect(historyFinish.text({ position: "TE", cutoff: 5, from: 1999, to: 2009 }, ctx)).toBe(
      "Name a tight end who finished top 5 in PPR scoring in a season between 1999 and 2009.",
    );
  });

  it("drops the honors forms when the floor is after the draft data begins", () => {
    const draws = careerMarks.draws(mulberry32(1), fakeCtx({ historyFloorSeason: 1990 }));
    expect(draws.every((p) => p.form === "total")).toBe(true);
  });
});
