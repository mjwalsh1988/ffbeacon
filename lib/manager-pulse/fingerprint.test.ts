import { describe, it, expect, vi, afterEach } from "vitest";
import {
  managerPulseFingerprint,
  type ManagerPulseFingerprintInput,
} from "./fingerprint";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";

function baseInput(): ManagerPulseFingerprintInput {
  return {
    seasonFrom: 2023,
    seasonTo: 2026,
    leagueSeasons: [
      { leagueId: "league-a", season: 2023 },
      { leagueId: "league-b", season: 2024 },
      { leagueId: "league-a", season: 2024 },
    ],
    modelVersion: "mp-1",
    counts: { transactions: 120, drafts: 4, settledMatchups: 58 },
    settings: {
      samples: DEFAULT_MANAGER_PULSE_SETTINGS.samples,
      draft: DEFAULT_MANAGER_PULSE_SETTINGS.draft,
      display: DEFAULT_MANAGER_PULSE_SETTINGS.display,
    },
  };
}

describe("managerPulseFingerprint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is stable across calls with identical input", () => {
    const a = managerPulseFingerprint(baseInput());
    const b = managerPulseFingerprint(baseInput());
    expect(a).toBe(b);
  });

  it("does not depend on league-season array order, since it is a set", () => {
    const input = baseInput();
    const reordered: ManagerPulseFingerprintInput = {
      ...input,
      leagueSeasons: [...input.leagueSeasons].reverse(),
    };
    expect(managerPulseFingerprint(input)).toBe(managerPulseFingerprint(reordered));
  });

  it("changes when the season window changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const changed = managerPulseFingerprint({ ...baseInput(), seasonFrom: 2022 });
    expect(changed).not.toBe(base);
  });

  it("changes when the set of league-seasons changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const input = baseInput();
    const changed = managerPulseFingerprint({
      ...input,
      leagueSeasons: [...input.leagueSeasons, { leagueId: "league-c", season: 2025 }],
    });
    expect(changed).not.toBe(base);
  });

  it("changes when the model version changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const changed = managerPulseFingerprint({ ...baseInput(), modelVersion: "mp-2" });
    expect(changed).not.toBe(base);
  });

  it("changes when the transaction count changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const input = baseInput();
    const changed = managerPulseFingerprint({
      ...input,
      counts: { ...input.counts, transactions: input.counts.transactions + 1 },
    });
    expect(changed).not.toBe(base);
  });

  it("changes when the draft count changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const input = baseInput();
    const changed = managerPulseFingerprint({
      ...input,
      counts: { ...input.counts, drafts: input.counts.drafts + 1 },
    });
    expect(changed).not.toBe(base);
  });

  it("changes when the settled matchup count changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const input = baseInput();
    const changed = managerPulseFingerprint({
      ...input,
      counts: { ...input.counts, settledMatchups: input.counts.settledMatchups + 1 },
    });
    expect(changed).not.toBe(base);
  });

  it("changes when an output-affecting samples setting changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const input = baseInput();
    const changed = managerPulseFingerprint({
      ...input,
      settings: {
        ...input.settings,
        samples: { ...input.settings.samples, minTradesForMargin: 99 },
      },
    });
    expect(changed).not.toBe(base);
  });

  it("changes when an output-affecting draft setting changes", () => {
    const base = managerPulseFingerprint(baseInput());
    const input = baseInput();
    const changed = managerPulseFingerprint({
      ...input,
      settings: {
        ...input.settings,
        draft: { ...input.settings.draft, reachRoundsThreshold: 0.5 },
      },
    });
    expect(changed).not.toBe(base);
  });

  // This test used to assert the opposite: that a display-setting change left
  // the fingerprint untouched, on the theory that display only changes how
  // much of a report is RENDERED. That theory was wrong. affinity.ts,
  // results.ts and narrative.ts all slice their lists inside computeFootprint,
  // and the sliced result is what lands in manager_pulse_cache, so a display
  // change genuinely produces a different stored report and has to
  // invalidate it. See the header comment in fingerprint.ts, "INCLUDED,
  // though it looks like a render-time concern: display".
  it("changes when a display setting changes, because display is applied during compute, not at render", () => {
    const settingsA = DEFAULT_MANAGER_PULSE_SETTINGS;
    const settingsB = {
      ...DEFAULT_MANAGER_PULSE_SETTINGS,
      display: {
        ...DEFAULT_MANAGER_PULSE_SETTINGS.display,
        favouritesShown: 40,
        tradesShown: 5,
      },
    };

    const inputA: ManagerPulseFingerprintInput = {
      ...baseInput(),
      settings: { samples: settingsA.samples, draft: settingsA.draft, display: settingsA.display },
    };
    const inputB: ManagerPulseFingerprintInput = {
      ...baseInput(),
      settings: { samples: settingsB.samples, draft: settingsB.draft, display: settingsB.display },
    };

    expect(managerPulseFingerprint(inputA)).not.toBe(managerPulseFingerprint(inputB));
  });

  it("never calls Date.now", () => {
    const spy = vi.spyOn(Date, "now");
    managerPulseFingerprint(baseInput());
    expect(spy).not.toHaveBeenCalled();
  });
});
