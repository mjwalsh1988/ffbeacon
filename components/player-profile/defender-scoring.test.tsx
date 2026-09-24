import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFENDER_COLUMNS,
  DefenderCareerTable,
  DefenderGameLog,
  DefenderScoringProvider,
  DefenderThisWeek,
  pointsFor,
  scoringOptions,
  scoresUnprojectedKeys,
  totalTackles,
} from "./defender-scoring";
import { statColumns } from "./stat-shaping";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";
import type { DefenderWeek } from "@/lib/player-profile/defender";

const ROQUAN_WEEK = {
  idp_tkl: 15,
  idp_tkl_solo: 8,
  idp_tkl_ast: 7,
  idp_tkl_loss: 3,
  idp_qb_hit: 2,
  idp_fum_rec: 1,
  idp_def_td: 1,
};

const weeks: DefenderWeek[] = [
  {
    week: 1,
    opponent: "IND",
    status: "played",
    snaps: 54,
    teamSnaps: 58,
    snapPct: 0.93,
    line: ROQUAN_WEEK,
    projected: { idp_tkl_solo: 6, idp_tkl_ast: 3, idp_tkl: 9 },
  },
  {
    week: 2,
    opponent: null,
    status: "bye",
    snaps: null,
    teamSnaps: null,
    snapPct: null,
    line: {},
    projected: null,
  },
  {
    week: 3,
    opponent: "DAL",
    status: "upcoming",
    snaps: null,
    teamSnaps: null,
    snapPct: null,
    line: {},
    projected: { idp_tkl_solo: 5, idp_tkl_ast: 3, idp_sack: 0.25 },
  },
];

describe("scoring", () => {
  it("scores the real Roquan Smith week at 40 in Sleeper default and 37.25 in Big 3", () => {
    expect(pointsFor(ROQUAN_WEEK, IDP_PRESETS.idp123)).toBe(40);
    expect(pointsFor(ROQUAN_WEEK, IDP_PRESETS.big3)).toBe(37.25);
  });

  it("offers the four presets first, then the reader's leagues", () => {
    const options = scoringOptions([{ id: "L1", sleeperLeagueId: "123", name: "Dynasty Gurus", scoring: { idp_tkl: 1 } }]);
    expect(options.map((o) => o.id)).toEqual(["idp123", "big3", "fantasypros", "espn", "league:L1"]);
    expect(options[4].label).toBe("your league's scoring (Dynasty Gurus)");
  });

  it("flags scoring that rewards what nobody projects", () => {
    expect(scoresUnprojectedKeys(IDP_PRESETS.idp123)).toBe(true); // blocked kicks
    expect(scoresUnprojectedKeys({ idp_tkl: 1 })).toBe(false);
  });

  it("falls back to solo plus assisted for combined tackles", () => {
    expect(totalTackles({ idp_tkl_solo: 4, idp_tkl_ast: 2 })).toBe(6);
    expect(totalTackles({ idp_tkl: 9, idp_tkl_solo: 4 })).toBe(9);
  });
});

describe("columns (plan IDP-206)", () => {
  it("carry no offensive stat", () => {
    const line = { rec: 5, rec_yd: 50, rush_yd: 30, rush_att: 4, pass_yd: 200 };
    for (const col of DEFENDER_COLUMNS) {
      expect(col.get(line)).toBe("0");
      expect(col.label).not.toMatch(/rec|rush|pass|tgt|car/i);
    }
  });

  it("leave the offensive columns untouched", () => {
    expect(statColumns("WR").map((c) => c.label)).toEqual([
      "Tgt",
      "Rec",
      "Rec Yd",
      "Rec TD",
      "Rush Yd",
    ]);
  });
});

describe("initial render (Sleeper default, no storage)", () => {
  const html = renderToStaticMarkup(
    <DefenderScoringProvider leagues={[]} seasonTotal={{ season: 2026, line: ROQUAN_WEEK, games: 1 }}>
      <DefenderGameLog season={2026} weeks={weeks} playerName="Roquan Smith" />
      <DefenderCareerTable seasons={[]} playerName="Roquan Smith" />
      <DefenderThisWeek
        next={weeks[2]}
        accuracy={{ season: null, weeksPlayed: 97, weeksBeat: 42, beatRate: 0.4272 }}
        playerName="Roquan Smith"
        engineDisplay="Sleeper"
      />
    </DefenderScoringProvider>,
  );

  it("is a labelled radio group with Sleeper default checked", () => {
    expect(html).toContain("<fieldset");
    expect(html).toContain("Score this player as");
    expect(html).toMatch(/checked="" value="idp123"/);
    expect(html).toContain('aria-live="polite"');
  });

  it("scores the played week and names the scoring in the table caption", () => {
    expect(html).toContain("40.0");
    expect(html).toContain("Points are in Sleeper default IDP scoring");
    expect(html).toContain("8 solo, 7 asst");
  });

  it("says bye in words and keeps the week", () => {
    expect(html).toContain("Bye week");
    expect(html).toContain("Not played yet");
  });

  it("projects next week with scoring and engine named, and the beat rate", () => {
    // 5*2 + 3*1 + 0.25*6 = 14.5
    expect(html).toContain("14.5");
    expect(html).toContain("Sleeper projection, Sleeper default IDP scoring");
    expect(html).toContain("Beat the Sleeper projection in 42 of 97 games (43%)");
    expect(html).toContain("Week 3 against DAL");
  });

  it("never prints an offensive column", () => {
    expect(html).not.toMatch(/Rec Yd|Rush Yd|Tgt|PPR/);
  });
});
