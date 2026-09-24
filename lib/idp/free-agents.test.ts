import { describe, expect, it } from "vitest";
import { rankIdpFreeAgents, startableIdpPositions, type IdpProjectionRow } from "./free-agents";
import { slotEligibility } from "@/lib/power-pulse/types";

const SCORING = {
  pass_yd: 0.04,
  pass_td: 4,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  idp_tkl_solo: 2,
  idp_tkl_ast: 1,
  idp_sack: 6,
};

function row(
  sleeperId: string,
  position: string,
  line: Record<string, number>,
  availability = "projected",
): IdpProjectionRow {
  return {
    player_id: `p-${sleeperId}`,
    stat_line: line,
    availability,
    players: {
      slug: `player-${sleeperId}`,
      full_name: `Player ${sleeperId}`,
      position,
      team: "DAL",
      external_ids: { sleeper: sleeperId },
    },
  };
}

describe("rankIdpFreeAgents (plan R-6)", () => {
  const rows = [
    row("lb-top", "LB", { idp_tkl_solo: 6, idp_tkl_ast: 3 }),
    row("lb-owned", "LB", { idp_tkl_solo: 9, idp_tkl_ast: 3 }),
    row("lb-mid", "LB", { idp_tkl_solo: 4, idp_tkl_ast: 2 }),
    row("dl-sack", "DL", { idp_tkl_solo: 2, idp_sack: 1 }),
    row("db-out", "DB", {}, "out"),
    row("wr", "WR", { rec: 5 }),
  ];

  it("returns the top projected unrostered linebacker under the league's scoring", () => {
    const out = rankIdpFreeAgents(rows, new Set(["lb-owned"]), new Set(["DL", "LB", "DB"]), SCORING);
    const lbs = out.filter((fa) => fa.position === "LB");
    expect(lbs.map((fa) => fa.sleeperId)).toEqual(["lb-top", "lb-mid"]);
    // 6 solo x 2 + 3 assisted x 1.
    expect(lbs[0].projectedPoints).toBe(15);
    expect(lbs[0].positionRank).toBe(1);
  });

  it("leaves out owned, unprojected, offensive and unstartable players", () => {
    const out = rankIdpFreeAgents(rows, new Set(["lb-owned"]), new Set(["LB"]), SCORING);
    const ids = out.map((fa) => fa.sleeperId);
    expect(ids).not.toContain("lb-owned");
    expect(ids).not.toContain("db-out");
    expect(ids).not.toContain("wr");
    expect(ids).not.toContain("dl-sack");
  });

  it("returns nobody under a league with no IDP rule, never a zero", () => {
    const offenseOnly = { pass_yd: 0.04, pass_td: 4, rec: 1, rec_yd: 0.1, rec_td: 6 };
    expect(rankIdpFreeAgents(rows, new Set(), new Set(["LB", "DL"]), offenseOnly)).toEqual([]);
  });

  it("admits a DL eligible at LB in a league that starts only LB, ranked with the linebackers", () => {
    const dual = row("dl-lb", "DL", { idp_tkl_solo: 8, idp_sack: 1 });
    dual.players!.eligible_positions = ["DL", "LB"];
    const out = rankIdpFreeAgents([...rows, dual], new Set(["lb-owned"]), new Set(["LB"]), SCORING);
    const hit = out.find((fa) => fa.sleeperId === "dl-lb")!;
    // Shown with his own primary, ranked first in the group he would play in.
    expect(hit.position).toBe("DL");
    expect(hit.positionRank).toBe(1);
    expect(out.map((fa) => fa.sleeperId)).toEqual(["dl-lb", "lb-top", "lb-mid"]);
  });

  it("caps each position", () => {
    const many = Array.from({ length: 20 }, (_, i) => row(`lb${i}`, "LB", { idp_tkl_solo: 20 - i }));
    const out = rankIdpFreeAgents(many, new Set(), new Set(["LB"]), SCORING, 15);
    expect(out).toHaveLength(15);
    expect(out[14].positionRank).toBe(15);
  });

  it("startableIdpPositions reads the defensive positions off the slot map", () => {
    const on = slotEligibility(true);
    expect([...startableIdpPositions(["QB", "LB", "IDP_FLEX"], on)].sort()).toEqual(["DB", "DL", "LB"]);
    expect([...startableIdpPositions(["QB", "LB"], on)]).toEqual(["LB"]);
    expect(startableIdpPositions(["QB", "LB"], slotEligibility(false)).size).toBe(0);
  });
});
