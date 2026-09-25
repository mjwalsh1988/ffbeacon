import { describe, expect, it } from "vitest";
import {
  buildDefenderWeeks,
  idpPartOfScoring,
  lineFromColumns,
  loadReaderIdpLeagues,
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

/**
 * A fake client that honours eq, in and range the way PostgREST does, with
 * the 1000-row cap, so a read that forgot to page would come back short.
 */
function fakeLeagueClient(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let window: [number, number] = [0, 999];
      const builder = {
        select: () => builder,
        eq: (col: string, v: unknown) => {
          filters.push((r) => r[col] === v);
          return builder;
        },
        in: (col: string, vs: unknown[]) => {
          const set = new Set(vs);
          filters.push((r) => set.has(r[col]));
          return builder;
        },
        order: () => builder,
        range: (from: number, to: number) => {
          window = [from, Math.min(to, from + 999)];
          return builder;
        },
        then: (resolve: (v: unknown) => void) => {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          resolve({ data: rows.slice(window[0], window[1] + 1), error: null });
        },
      };
      return builder;
    },
  };
}

describe("loadReaderIdpLeagues", () => {
  it("reads every membership past the 1000-row cap, so this season's IDP league is not dropped", async () => {
    // 1,200 older memberships first, then the one that matters last.
    const leagueUsers: Array<Record<string, unknown>> = [];
    const leagues: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1200; i++) {
      leagueUsers.push({ id: i, league_id: `old-${i}`, sleeper_user_id: "u1" });
      leagues.push({
        id: `old-${i}`,
        sleeper_league_id: `s-old-${i}`,
        name: `Old ${i}`,
        season: 2024,
        roster_positions: ["QB", "LB"],
        scoring_settings: { idp_tkl_solo: 1 },
      });
    }
    leagueUsers.push({ id: 5000, league_id: "now", sleeper_user_id: "u1" });
    leagues.push({
      id: "now",
      sleeper_league_id: "s-now",
      name: "This season",
      season: 2026,
      roster_positions: ["QB", "IDP_FLEX"],
      scoring_settings: { idp_sack: 4, pass_td: 4 },
    });
    const client = fakeLeagueClient({ league_users: leagueUsers, leagues });
    const out = await loadReaderIdpLeagues(client as never, "u1", 2026);
    expect(out).toEqual([
      { id: "now", sleeperLeagueId: "s-now", name: "This season", scoring: { idp_sack: 4 } },
    ]);
  });
});
