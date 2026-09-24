/**
 * Power Pulse with the IDP switch (plan IDP-307).
 *
 * The goldens in engine.golden.test.ts pin the OFF path. These pin what the ON
 * path adds: defenders seated in the league's defensive slots, credited by the
 * position they were seated as, counted in depth, and a form ratio that is
 * never measured against a projection missing the players the results include.
 */

import { describe, expect, it } from "vitest";
import { computePowerPulse } from "./engine";
import {
  fixtureLeague,
  fixturePowerPulseInput,
  idpFixtureLeague,
  idpFixturePowerPulseInput,
  readGolden,
} from "./test-fixtures";

/**
 * The golden fixture's offensive map carries yardage and no touchdown key, so
 * the scoring core reads it as a truncated league object and (correctly)
 * trusts it for nobody, defenders included. A real league map has both; so do
 * these.
 */
function completeIdpLeague(overrides: Parameters<typeof idpFixtureLeague>[0] = {}) {
  const base = idpFixtureLeague();
  return idpFixtureLeague({
    scoringSettings: { ...base.scoringSettings, pass_td: 4, rush_td: 6, rec_td: 6 },
    ...overrides,
  });
}

function idpInput(overrides: Parameters<typeof idpFixturePowerPulseInput>[0] = {}) {
  return idpFixturePowerPulseInput({ league: completeIdpLeague(), ...overrides });
}

describe("Power Pulse with the IDP switch on", () => {
  it("seats defenders and scores more than the same league with the switch off", () => {
    const off = computePowerPulse(idpInput());
    const on = computePowerPulse(idpInput({ idpEnabled: true }));
    for (let i = 0; i < on.length; i += 1) {
      expect(on[i].expectedPointsPerWeek).toBeGreaterThan(off[i].expectedPointsPerWeek);
      const starterPositions = on[i].components.starters.map((s) => s.position);
      expect(starterPositions).toEqual(expect.arrayContaining(["DL", "LB", "DB"]));
      expect(Object.keys(on[i].components.positionPoints)).toEqual(
        expect.arrayContaining(["DL", "LB", "DB"]),
      );
      expect(Object.keys(off[i].components.positionPoints)).not.toContain("LB");
    }
  });

  it("matches the switch-on golden for the IDP league", () => {
    const out = computePowerPulse(idpInput({ idpEnabled: true }));
    const { actual, expected } = readGolden(__dirname, "power-pulse-idp-on", out);
    expect(actual).toEqual(expected);
  });

  it("changes nothing for an ordinary league when the switch is on", () => {
    const off = computePowerPulse(fixturePowerPulseInput());
    const on = computePowerPulse(fixturePowerPulseInput({ idpEnabled: true }));
    expect(on).toEqual(off);
  });

  it("counts depth only at defensive positions the league starts", () => {
    // Only DB slots: the DL and LB on each roster can never start, so they are
    // no depth at all, and a zero drop for them must not dilute the average.
    const league = completeIdpLeague({ rosterPositions: ["QB", "RB", "WR", "TE", "DB", "DB", "BN"] });
    const full = idpInput({ league, idpEnabled: true });
    const players = new Map([...full.players].filter(([, p]) => p.position !== "DL" && p.position !== "LB"));
    const withThem = computePowerPulse(full);
    const without = computePowerPulse({ ...full, players });
    expect(withThem.map((t) => t.components.depthDropoffPct)).toEqual(
      without.map((t) => t.components.depthDropoffPct),
    );
  });

  it("a chopped IDP league's weekly mean includes the defensive slots", () => {
    const league = completeIdpLeague({ chopped: true });
    const off = computePowerPulse(idpInput({ league }));
    const on = computePowerPulse(idpInput({ league, idpEnabled: true }));
    expect(on[0].weekly[0].mean).toBeGreaterThan(off[0].weekly[0].mean);
    expect(on[0].chopOddsThisWeek).not.toBeNull();
  });

  it("does not measure form in an IDP league while the switch is off, and says why", () => {
    const results = new Map(
      [1, 2, 3, 4].map((n) => [
        n,
        [
          { week: 3, points: 140 },
          { week: 4, points: 150 },
        ],
      ]),
    );
    const off = computePowerPulse(idpInput({ results }));
    expect(off[0].components.formRatio).toBeNull();
    expect(off[0].components.formUnmeasured).toBe("unprojected-slots");

    const on = computePowerPulse(idpInput({ results, idpEnabled: true }));
    expect(on[0].components.formRatio).not.toBeNull();
    expect(on[0].components.formUnmeasured).toBeUndefined();

    const ordinary = computePowerPulse(
      fixturePowerPulseInput({ league: fixtureLeague(), results }),
    );
    expect(ordinary[0].components.formRatio).not.toBeNull();
    expect(ordinary[0].components.formUnmeasured).toBeUndefined();
  });
});
