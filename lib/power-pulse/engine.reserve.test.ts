/**
 * The injured reserve hold in computePowerPulse.
 *
 * An IR-slotted player used to be dropped from every remaining week, so a
 * starter on short IR counted zero for the season. Now he sits out the current
 * week and the next (injury.reserveHoldWeeks) and then counts in the weeks his
 * own projection has him playing. Taxi squad players stay out entirely.
 */

import { describe, expect, it } from "vitest";
import { computePowerPulse } from "./engine";
import { DEFAULT_POWER_PULSE_SETTINGS, DEFAULT_RESERVE_HOLD_WEEKS } from "./default-settings";
import { FIXTURE_CURRENT_WEEK, fixturePowerPulseInput } from "./test-fixtures";
import type { PowerPulseInput } from "./engine";

const RB = "s-1-RB";
const RB_PLAYER = "p-1-RB";

function withRoster1(change: Partial<PowerPulseInput["rosters"][number]>): PowerPulseInput {
  const base = fixturePowerPulseInput();
  return {
    ...base,
    rosters: base.rosters.map((r) => (r.sleeperRosterId === 1 ? { ...r, ...change } : r)),
  };
}

function weeklyMeans(input: PowerPulseInput): Map<number, number> {
  const team = computePowerPulse(input).find((t) => t.sleeperRosterId === 1);
  if (!team) throw new Error("team 1 missing");
  return new Map(team.weekly.map((w) => [w.week, w.mean]));
}

describe("the injured reserve hold", () => {
  const healthy = weeklyMeans(fixturePowerPulseInput());
  const firstEligible = FIXTURE_CURRENT_WEEK + DEFAULT_RESERVE_HOLD_WEEKS;

  it("holds an IR player out of the current week and the next, then counts him", () => {
    const onIr = weeklyMeans(withRoster1({ reserveSleeperIds: [RB] }));
    for (const [week, mean] of onIr) {
      if (week < firstEligible) {
        expect(mean).toBeLessThan(healthy.get(week)!);
      } else {
        expect(mean).toBeCloseTo(healthy.get(week)!, 6);
      }
    }
  });

  it("keeps him out every week his projection marks him out, as a season-ending IR does", () => {
    const base = withRoster1({ reserveSleeperIds: [RB] });
    const projections = base.projections.map((row) =>
      row.playerId === RB_PLAYER ? { ...row, availability: "out", ppr: 0, halfPpr: 0, std: 0 } : row,
    );
    const seasonEnding = weeklyMeans({ ...base, projections });
    const cutAltogether = weeklyMeans({
      ...base,
      rosters: base.rosters.map((r) =>
        r.sleeperRosterId === 1 ? { ...r, playerSleeperIds: r.playerSleeperIds.filter((s) => s !== RB) } : r,
      ),
    });
    expect([...seasonEnding]).toEqual([...cutAltogether]);
  });

  it("follows the configured hold length", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      injury: { ...DEFAULT_POWER_PULSE_SETTINGS.injury, reserveHoldWeeks: 0 },
    };
    const noHold = weeklyMeans({ ...withRoster1({ reserveSleeperIds: [RB] }), settings });
    expect([...noHold]).toEqual([...healthy]);
  });

  it("still keeps a taxi squad player out of every week", () => {
    const onTaxi = weeklyMeans(withRoster1({ taxiSleeperIds: [RB] }));
    for (const [week, mean] of onTaxi) {
      expect(mean).toBeLessThan(healthy.get(week)!);
    }
  });
});
