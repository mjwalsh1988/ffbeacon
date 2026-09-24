/**
 * Golden output for computePowerPulse (plan IDP-101).
 *
 * Captured on untouched code before the IDP build began. Both leagues must
 * produce exactly this output for as long as the IDP switch is off: the
 * ordinary league because nothing about it changes, and the IDP league because
 * with the switch off its defenders are not seated by any engine yet.
 */

import { describe, expect, it } from "vitest";
import { computePowerPulse } from "./engine";
import {
  fixtureLeague,
  fixturePowerPulseInput,
  idpFixturePowerPulseInput,
  readGolden,
} from "./test-fixtures";

describe("computePowerPulse golden output", () => {
  it("matches the golden for the ordinary league", () => {
    const { actual, expected } = readGolden(__dirname, "power-pulse-offense", computePowerPulse(fixturePowerPulseInput()));
    expect(actual).toEqual(expected);
  });

  it("matches the golden for the chopped league", () => {
    const out = computePowerPulse(fixturePowerPulseInput({ league: fixtureLeague({ chopped: true }) }));
    const { actual, expected } = readGolden(__dirname, "power-pulse-chopped", out);
    expect(actual).toEqual(expected);
  });

  it("matches the golden for the IDP league", () => {
    const { actual, expected } = readGolden(__dirname, "power-pulse-idp", computePowerPulse(idpFixturePowerPulseInput()));
    expect(actual).toEqual(expected);
  });
});
