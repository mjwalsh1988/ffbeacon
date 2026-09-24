import { describe, expect, it } from "vitest";
import {
  buildDefenderWeeks,
  idpPartOfScoring,
  lineFromColumns,
  nextProjectedWeek,
} from "./defender";

describe("lineFromColumns", () => {
  it("keeps the typed IDP columns and drops absent ones", () => {
    const line = lineFromColumns({
      idp_tkl_solo: "8",
      idp_tkl_ast: 7,
      idp_sack: null,
      rec_yd: 40,
      def_snp: 60,
    });
    expect(line).toEqual({ idp_tkl_solo: 8, idp_tkl_ast: 7 });
  });
});

describe("buildDefenderWeeks", () => {
  const base = {
    stats: [
      { week: 1, opponent: "DAL", snaps: 60, teamSnaps: 64, snapPct: 0.94, line: { idp_tkl_solo: 5 } },
      { week: 2, opponent: "NYG", snaps: null, teamSnaps: null, snapPct: null, line: {} as Record<string, number> },
    ],
    projections: [
      { week: 4, opponent: "PHI", line: { idp_tkl_solo: 4.2 } },
      { week: 5, opponent: "WAS", line: { idp_tkl_solo: 4.0 } },
    ],
    teamWeeks: new Map<number, string | null>([
      [1, "DAL"],
      [2, "NYG"],
      [3, "SEA"],
      [4, "PHI"],
      [5, "WAS"],
      [7, "SF"],
    ]),
    slateWeeks: new Set([1, 2, 3, 4, 5, 6, 7]),
    lastPlayedWeek: 3,
    maxWeek: 8,
  };

  it("labels every week honestly", () => {
    const weeks = buildDefenderWeeks(base);
    expect(weeks.map((w) => w.status)).toEqual([
      "played", // a stat row with snaps
      "special", // a stat row with no defensive snap
      "missed", // played league-wide, no row for him
      "upcoming",
      "upcoming",
      "bye", // inside the slate, team absent, no projection
      "upcoming", // week 7: team plays, not projected yet
      "upcoming", // week 8: past the slate's reach, never a bye
    ]);
  });

  it("reads an inactive row (no gp, no snaps) as did not play, not special teams", () => {
    const weeks = buildDefenderWeeks({
      ...base,
      stats: [
        { week: 1, opponent: "DAL", snaps: null, teamSnaps: 64, snapPct: null, line: {}, gamesPlayed: 0 },
        { week: 2, opponent: "NYG", snaps: null, teamSnaps: 60, snapPct: null, line: {}, gamesPlayed: 1 },
      ],
    });
    expect(weeks[0].status).toBe("missed");
    expect(weeks[1].status).toBe("special");
  });

  it("carries the opponent from the stat row, then the projection, then the slate", () => {
    const weeks = buildDefenderWeeks(base);
    expect(weeks[0].opponent).toBe("DAL");
    expect(weeks[2].opponent).toBe("SEA");
    expect(weeks[5].opponent).toBeNull();
    expect(weeks[6].opponent).toBe("SF");
  });

  it("finds the next projected week", () => {
    const next = nextProjectedWeek(buildDefenderWeeks(base));
    expect(next?.week).toBe(4);
    expect(next?.projected).toEqual({ idp_tkl_solo: 4.2 });
  });
});

describe("idpPartOfScoring", () => {
  it("keeps nonzero idp rules and the two bonuses, drops offense", () => {
    expect(
      idpPartOfScoring({
        pass_td: 4,
        rec: 1,
        idp_tkl_solo: 1.5,
        idp_tkl: 0,
        bonus_tkl_10p: 2,
        idp_sack: "4",
      }),
    ).toEqual({ idp_tkl_solo: 1.5, bonus_tkl_10p: 2, idp_sack: 4 });
  });
});
