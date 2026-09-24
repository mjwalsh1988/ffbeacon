/**
 * Golden output for computeLedger (plan IDP-101). Captured on untouched code;
 * must hold unchanged while the IDP switch is off.
 */

import { describe, expect, it } from "vitest";
import { readGolden } from "@/lib/power-pulse/test-fixtures";
import { computeLedger, type EngineInput } from "./engine";
import type { LedgerPlayer } from "./lineup";

function players(idp: boolean): Map<string, LedgerPlayer> {
  const list: [string, string][] = [
    ["qb", "QB"], ["rb1", "RB"], ["rb2", "RB"], ["wr1", "WR"], ["wr2", "WR"],
  ];
  if (idp) list.push(["dl1", "DL"], ["lb1", "LB"], ["lb2", "LB"], ["db1", "DB"]);
  return new Map(
    list.map(([id, position]) => [id, { sleeperId: id, name: id.toUpperCase(), position } as LedgerPlayer]),
  );
}

function input(idp: boolean): EngineInput {
  const rosterPositions = idp
    ? ["QB", "RB", "WR", "FLEX", "DL", "LB", "DB", "IDP_FLEX", "BN", "BN"]
    : ["QB", "RB", "WR", "FLEX", "BN"];
  const weeks: EngineInput["weeks"] = [];
  for (let week = 1; week <= 6; week += 1) {
    const points = new Map<string, number>([
      ["qb", 18 + week], ["rb1", 14], ["rb2", 6 + week], ["wr1", 12], ["wr2", 10 - week / 2],
      ...(idp ? ([["dl1", 7], ["lb1", 9 + week], ["lb2", 4], ["db1", 6]] as [string, number][]) : []),
    ]);
    const offense1 = ["qb", "rb1", "wr1", "rb2"];
    const offense2 = ["qb", "rb2", "wr2", "rb1"];
    const def1 = idp ? ["dl1", "lb1", "db1", "lb2"] : [];
    const def2 = idp ? ["dl1", "lb2", "db1", "lb1"] : [];
    const sum = (ids: string[]) => ids.reduce((acc, id) => acc + (points.get(id) ?? 0), 0);
    const s1 = [...offense1, ...def1];
    const s2 = [...offense2, ...def2];
    weeks.push({
      week, sleeperRosterId: 1, officialPoints: sum(s1), starterIds: s1, playerPoints: points,
      opponentPoints: sum(s2), ineligibleIds: new Set(), startedIds: new Set(s1),
    });
    weeks.push({
      week, sleeperRosterId: 2, officialPoints: sum(s2), starterIds: s2, playerPoints: points,
      opponentPoints: sum(s1), ineligibleIds: new Set(), startedIds: new Set(s2),
    });
  }
  return {
    season: 2025,
    rosterPositions,
    rosters: [
      { sleeperRosterId: 1, teamName: "One", ownerHandle: "one" },
      { sleeperRosterId: 2, teamName: "Two", ownerHandle: "two" },
    ],
    weeks,
    transactions: [],
    draftPicks: [],
    players: players(idp),
    leagueHasFaab: false,
  };
}

describe("computeLedger golden output", () => {
  it("matches the golden for the ordinary league", () => {
    const { actual, expected } = readGolden(__dirname, "ledger-offense", computeLedger(input(false)));
    expect(actual).toEqual(expected);
  });

  it("matches the golden for the IDP league", () => {
    const { actual, expected } = readGolden(__dirname, "ledger-idp", computeLedger(input(true)));
    expect(actual).toEqual(expected);
  });
});
