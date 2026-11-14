import { describe, it, expect } from "vitest";
import {
  ineligibleDigest,
  ledgerFingerprint,
  officialPointsTotal,
  type LedgerFingerprintInput,
} from "./fingerprint";

const BASE: LedgerFingerprintInput = {
  season: 2025,
  gradedWeekCount: 5,
  latestGradedWeek: 5,
  rosterCount: 12,
  slots: ["QB", "RB", "WR"],
  transactionCount: 40,
  draftPickCount: 180,
  ineligibleDigest: ineligibleDigest([{ rosterId: 1, ids: ["a"] }]),
  officialPointsTotal: 6000.5,
  rules: "redraft:15:nomedian",
  modelVersion: "ledger-7",
};

describe("ledgerFingerprint", () => {
  it("changes when a player moves onto injured reserve", () => {
    const moved = {
      ...BASE,
      ineligibleDigest: ineligibleDigest([{ rosterId: 1, ids: ["a", "b"] }]),
    };
    expect(ledgerFingerprint(moved)).not.toBe(ledgerFingerprint(BASE));
  });

  it("changes when a settled score is corrected", () => {
    expect(ledgerFingerprint({ ...BASE, officialPointsTotal: 6001.1 })).not.toBe(
      ledgerFingerprint(BASE),
    );
  });

  it("changes when the league's rules change", () => {
    expect(ledgerFingerprint({ ...BASE, rules: "redraft:15:median" })).not.toBe(
      ledgerFingerprint(BASE),
    );
  });
});

describe("ineligibleDigest", () => {
  it("ignores order and the empty-slot placeholder", () => {
    const a = ineligibleDigest([
      { rosterId: 2, ids: ["y", "x"] },
      { rosterId: 1, ids: ["0", "a"] },
    ]);
    const b = ineligibleDigest([
      { rosterId: 1, ids: ["a"] },
      { rosterId: 2, ids: ["x", "y", "x"] },
    ]);
    expect(a).toBe(b);
  });
});

describe("officialPointsTotal", () => {
  it("sums to two decimals whatever the order", () => {
    expect(officialPointsTotal([0.1, 0.2, 100.33])).toBe(100.63);
    expect(officialPointsTotal([100.33, 0.2, 0.1])).toBe(100.63);
  });
});
