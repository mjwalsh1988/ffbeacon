import { describe, it, expect } from "vitest";
import {
  digestsMatch,
  normalizedScoring,
  warFingerprint,
  warInputsDigest,
  type WarFingerprintInput,
  type WarInputsDigest,
} from "./fingerprint";
import type { ScoringSettings } from "@/lib/league-scoring";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  type PowerPulseSettings,
} from "@/lib/power-pulse/default-settings";
import { DEFAULT_WAR_SETTINGS } from "./default-settings";

// A real-shaped scoring map, trimmed to the keys that matter for these tests.
const BASE_SCORING: ScoringSettings = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rush_yd: 0.1,
  rush_td: 6,
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  fum_lost: -2,
};

const BASE_ROSTER_POSITIONS = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "K",
  "DEF",
  "BN",
  "BN",
];

function pickPulseSettings(s: PowerPulseSettings) {
  return {
    reliability: s.reliability,
    availability: s.availability,
    injury: s.injury,
    opponent: s.opponent,
    variance: s.variance,
    recency: s.recency,
  };
}

const BASE_PULSE_SETTINGS = pickPulseSettings(DEFAULT_POWER_PULSE_SETTINGS);

const BASE_WAR_SETTINGS = {
  displayDepthMultiple: DEFAULT_WAR_SETTINGS.displayDepthMultiple,
  minDisplayDepth: DEFAULT_WAR_SETTINGS.minDisplayDepth,
  cliffThreshold: DEFAULT_WAR_SETTINGS.cliffThreshold,
  clampBelowReplacement: DEFAULT_WAR_SETTINGS.clampBelowReplacement,
};

function baseInput(overrides: Partial<WarFingerprintInput> = {}): WarFingerprintInput {
  return {
    season: 2026,
    fromWeek: 9,
    toWeek: 14,
    teamCount: 12,
    rosterPositions: [...BASE_ROSTER_POSITIONS],
    scoringSettings: BASE_SCORING,
    pulseSettings: BASE_PULSE_SETTINGS,
    warSettings: BASE_WAR_SETTINGS,
    modelVersion: DEFAULT_WAR_SETTINGS.modelVersion,
    projectionsSnapshot: "2026-08-26T14:00:00.000Z",
    accuracySnapshot: "2026-08-26T09:00:00.000Z",
    projectionSource: "sleeper",
    ...overrides,
  };
}

// Compile-time guard: source (and format_config_id) is not an input, by
// contract (plan section 7, "Positional WAR does not vary by value source").
// If a future change ever adds a `source` field to WarFingerprintInput, this
// line stops compiling rather than the behavior silently drifting.
type _AssertNoSourceField = "source" extends keyof WarFingerprintInput ? never : true;
const _noSourceField: _AssertNoSourceField = true;
void _noSourceField;

describe("normalizedScoring", () => {
  it("drops a zero-valued key, a non-finite value, and every non-scoring key, and keeps real scoring keys", () => {
    const result = normalizedScoring({
      rec: 1,
      rush_yd: 0,
      bonus_rec_te: Number.NaN,
      adp_ppr: 5,
      pos_rank_ppr: 3,
      pts_ppr: 20,
      pass_yd: 0.04,
    });
    expect(result).toEqual([
      ["pass_yd", 0.04],
      ["rec", 1],
    ]);
  });

  it("returns an empty array for a null scoring map", () => {
    expect(normalizedScoring(null)).toEqual([]);
  });
});

describe("warFingerprint: false-hit scenarios from plan section 6.4", () => {
  it("bonus_rec_te changes the fingerprint", () => {
    const a = warFingerprint(baseInput());
    const b = warFingerprint(
      baseInput({ scoringSettings: { ...BASE_SCORING, bonus_rec_te: 0.5 } }),
    );
    expect(a).not.toBe(b);
  });

  it("kicker distance bonuses change the fingerprint", () => {
    const a = warFingerprint(baseInput());
    const b = warFingerprint(
      baseInput({ scoringSettings: { ...BASE_SCORING, fgm_50p: 5, fgm_40_49: 4 } }),
    );
    expect(a).not.toBe(b);
  });

  it("a six-point passing TD league changes the fingerprint", () => {
    const a = warFingerprint(baseInput());
    const b = warFingerprint(baseInput({ scoringSettings: { ...BASE_SCORING, pass_td: 6 } }));
    expect(a).not.toBe(b);
  });

  it("switching the projection source changes the fingerprint", () => {
    // The whole point of carrying projectionSource in the key. Enabling the FF
    // Beacon projection engine changes every projected point the model reads
    // and changes none of the other fields, because the engine's own settings
    // live under `beaconProjections` and this payload does not carry that
    // block. Without this the switch could be flipped and every league inside
    // the 12-hour TTL would keep serving a curve built on Sleeper's numbers.
    const a = warFingerprint(baseInput({ projectionSource: "sleeper" }));
    const b = warFingerprint(baseInput({ projectionSource: "ffbeacon" }));
    expect(a).not.toBe(b);
  });

  it("the inputs digest reports the projection source as the field that moved", () => {
    const a = warInputsDigest(baseInput({ projectionSource: "sleeper" }));
    const b = warInputsDigest(baseInput({ projectionSource: "ffbeacon" }));
    expect(digestsMatch(a, b)).toEqual({ ok: false, field: "projectionSource" });
  });

  it("a different season changes the fingerprint", () => {
    const a = warFingerprint(baseInput({ season: 2026 }));
    const b = warFingerprint(baseInput({ season: 2027 }));
    expect(a).not.toBe(b);
  });

  it("playoffs starting week 14 versus week 15 changes the fingerprint", () => {
    const a = warFingerprint(baseInput({ toWeek: 13 }));
    const b = warFingerprint(baseInput({ toWeek: 14 }));
    expect(a).not.toBe(b);
  });

  it("10 teams versus 12 teams changes the fingerprint", () => {
    const a = warFingerprint(baseInput({ teamCount: 10 }));
    const b = warFingerprint(baseInput({ teamCount: 12 }));
    expect(a).not.toBe(b);
  });

  it("SUPER_FLEX versus a second literal QB token changes the fingerprint", () => {
    const a = warFingerprint(
      baseInput({
        rosterPositions: ["QB", "SUPER_FLEX", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
      }),
    );
    const b = warFingerprint(
      baseInput({
        rosterPositions: ["QB", "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("FLEX versus REC_FLEX changes the fingerprint", () => {
    const a = warFingerprint(
      baseInput({ rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"] }),
    );
    const b = warFingerprint(
      baseInput({
        rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "REC_FLEX", "K", "DEF"],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("a different projectionsSnapshot (before/after the nightly sync) changes the fingerprint", () => {
    const a = warFingerprint(baseInput({ projectionsSnapshot: "2026-08-26T14:00:00.000Z" }));
    const b = warFingerprint(baseInput({ projectionsSnapshot: "2026-08-27T04:00:00.000Z" }));
    expect(a).not.toBe(b);
  });

  it("a different accuracySnapshot (the nightly reliability rebuild) changes the fingerprint", () => {
    // The model multiplies every projection by the player's reliability
    // multiplier, so a rebuild of player_projection_accuracy changes every
    // curve. Before this field existed it changed no fingerprint, and a league
    // viewed inside the 12-hour TTL served a curve built on replaced numbers.
    const a = warFingerprint(baseInput({ accuracySnapshot: "2026-08-26T09:00:00.000Z" }));
    const b = warFingerprint(baseInput({ accuracySnapshot: "2026-08-27T09:00:00.000Z" }));
    expect(a).not.toBe(b);
  });

  it("an empty reliability table is a stable fingerprint, not a crash", () => {
    // Empty is computable: every player scores a neutral 1.0. Unlike the
    // projections, whose absence means there is nothing to compute at all.
    const a = warFingerprint(baseInput({ accuracySnapshot: "" }));
    const b = warFingerprint(baseInput({ accuracySnapshot: "" }));
    expect(a).toBe(b);
    expect(a).not.toBe(warFingerprint(baseInput()));
  });

  it("an admin edit to the reliability weights changes the fingerprint", () => {
    const editedSettings: PowerPulseSettings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      reliability: {
        ...DEFAULT_POWER_PULSE_SETTINGS.reliability,
        priorGames: 20,
      },
    };
    const a = warFingerprint(baseInput());
    const b = warFingerprint(baseInput({ pulseSettings: pickPulseSettings(editedSettings) }));
    expect(a).not.toBe(b);
  });

  it("a displayDepthMultiple change changes the fingerprint", () => {
    const a = warFingerprint(baseInput());
    const b = warFingerprint(
      baseInput({ warSettings: { ...BASE_WAR_SETTINGS, displayDepthMultiple: 3 } }),
    );
    expect(a).not.toBe(b);
  });

  it("reordering roster_positions with the same multiset produces the identical fingerprint (not caught, intentionally)", () => {
    const a = warFingerprint(baseInput({ rosterPositions: [...BASE_ROSTER_POSITIONS] }));
    const b = warFingerprint(
      baseInput({ rosterPositions: [...BASE_ROSTER_POSITIONS].reverse() }),
    );
    expect(a).toBe(b);
  });

  it("IDP slots versus bench slots in their place produce the identical fingerprint (not caught, intentionally)", () => {
    const withIdp = warFingerprint(
      baseInput({
        rosterPositions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "IDP_FLEX", "LB"],
      }),
    );
    const withBench = warFingerprint(
      baseInput({
        rosterPositions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"],
      }),
    );
    expect(withIdp).toBe(withBench);
  });
});

describe("warFingerprint: fields that must NOT affect the hash", () => {
  it("weights, simulation, display, and the Power Pulse modelVersion do not change the fingerprint", () => {
    const editedPowerPulseSettings: PowerPulseSettings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      modelVersion: "pp-99",
      weights: { points: 0.9, schedule: 0.05, depth: 0.03, form: 0.02 },
      simulation: { runs: 100, seed: 1 },
      display: { min: 0, max: 100, sharpness: 2 },
    };

    const a = warFingerprint(baseInput());
    const b = warFingerprint(
      baseInput({ pulseSettings: pickPulseSettings(editedPowerPulseSettings) }),
    );
    expect(a).toBe(b);
  });

  it("flipping the value source is not even an input: identical inputs always hash the same regardless of any source the caller separately tracks", () => {
    // WarFingerprintInput carries no source field (see the compile-time guard
    // above), so there is nothing to vary here. Two calls with the same
    // league-shaped input produce the same hash no matter which source a
    // caller happens to be rendering alongside it.
    const a = warFingerprint(baseInput());
    const b = warFingerprint(baseInput());
    expect(a).toBe(b);
  });
});

describe("warFingerprint: stability", () => {
  it("is stable across two calls with structurally equal but differently key-ordered inputs", () => {
    const a = warFingerprint(baseInput());
    const reordered: WarFingerprintInput = {
      accuracySnapshot: "2026-08-26T09:00:00.000Z",
      projectionSource: "sleeper",
      projectionsSnapshot: "2026-08-26T14:00:00.000Z",
      modelVersion: DEFAULT_WAR_SETTINGS.modelVersion,
      warSettings: BASE_WAR_SETTINGS,
      pulseSettings: BASE_PULSE_SETTINGS,
      scoringSettings: BASE_SCORING,
      rosterPositions: [...BASE_ROSTER_POSITIONS],
      teamCount: 12,
      toWeek: 14,
      fromWeek: 9,
      season: 2026,
    };
    const b = warFingerprint(reordered);
    expect(a).toBe(b);
  });

  it("is stable when the scoring map's own keys are given in a different order", () => {
    const orderedA: ScoringSettings = { rec: 1, pass_td: 4, rush_yd: 0.1, rush_td: 6 };
    const orderedB: ScoringSettings = { rush_td: 6, rush_yd: 0.1, rec: 1, pass_td: 4 };
    const a = warFingerprint(baseInput({ scoringSettings: orderedA }));
    const b = warFingerprint(baseInput({ scoringSettings: orderedB }));
    expect(a).toBe(b);
  });
});

describe("digestsMatch", () => {
  const digest = warInputsDigest(baseInput());

  it("matches an identical digest", () => {
    expect(digestsMatch(digest, { ...digest })).toEqual({ ok: true });
  });

  const mutations: Array<[keyof WarInputsDigest, Partial<WarInputsDigest>]> = [
    ["season", { season: digest.season + 1 }],
    ["fromWeek", { fromWeek: digest.fromWeek + 1 }],
    ["toWeek", { toWeek: digest.toWeek + 1 }],
    ["teamCount", { teamCount: digest.teamCount + 1 }],
    ["slots", { slots: [...digest.slots, "K"] }],
    ["scoringBase", { scoringBase: "pts_std" }],
    ["scoringUsable", { scoringUsable: !digest.scoringUsable }],
    ["scoringKeyCount", { scoringKeyCount: digest.scoringKeyCount + 1 }],
    // A literal that is deliberately not any real DEFAULT_WAR_SETTINGS value,
    // so bumping the model version cannot turn this mutation into a no-op.
    ["modelVersion", { modelVersion: "war-mutated-for-this-test" }],
  ];

  for (const [field, mutation] of mutations) {
    it(`names "${field}" when it is the only field that differs`, () => {
      const mutated: WarInputsDigest = { ...digest, ...mutation };
      expect(digestsMatch(digest, mutated)).toEqual({ ok: false, field });
    });
  }
});

describe("warInputsDigest", () => {
  it("carries scoringKeyCount as the length of normalizedScoring's output, not the raw key count", () => {
    const scoringSettings: ScoringSettings = {
      ...BASE_SCORING,
      pts_ppr: 999, // excluded key, must not inflate the count
      adp_ppr: 1, // excluded key, must not inflate the count
    };
    const digest = warInputsDigest(baseInput({ scoringSettings }));
    expect(digest.scoringKeyCount).toBe(normalizedScoring(scoringSettings).length);
    expect(digest.scoringKeyCount).toBe(Object.keys(BASE_SCORING).length);
  });
});
