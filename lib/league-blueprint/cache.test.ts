import { describe, expect, it } from "vitest";
import { buildFingerprint, isFresh, staleOrFailed, type FingerprintInput } from "./cache";
import type { BlueprintView } from "./types";
import { BLUEPRINT_MODEL_VERSION } from "./types";

const base: FingerprintInput = {
  playerIds: ["b", "a", "c"],
  powerRankingsAt: "2026-10-29T10:00:00Z",
  pulseAt: "2026-10-29T09:00:00Z",
  warAt: null,
  ledgerAt: "2026-10-28T09:00:00Z",
  signalsAt: "2026-10-29T10:31:00Z",
  throughWeek: 8,
  settingsVersion: 1,
  modelVersion: BLUEPRINT_MODEL_VERSION,
};

describe("buildFingerprint", () => {
  it("ignores player order", () => {
    expect(buildFingerprint({ ...base, playerIds: ["c", "b", "a"] })).toBe(buildFingerprint(base));
  });

  it.each([
    ["playerIds", ["a", "b"]],
    ["powerRankingsAt", "2026-10-30T10:00:00Z"],
    ["pulseAt", null],
    ["warAt", "2026-10-29T11:00:00Z"],
    ["ledgerAt", null],
    ["signalsAt", "2026-10-30T10:31:00Z"],
    ["throughWeek", 9],
    ["settingsVersion", 2],
    ["modelVersion", BLUEPRINT_MODEL_VERSION + 1],
  ] as const)("changes when %s changes", (key, value) => {
    expect(buildFingerprint({ ...base, [key]: value })).not.toBe(buildFingerprint(base));
  });
});

describe("isFresh", () => {
  const fp = buildFingerprint(base);
  const now = Date.parse("2026-10-29T12:00:00Z");
  const row = { fingerprint: fp, modelVersion: BLUEPRINT_MODEL_VERSION, generatedAt: "2026-10-29T06:00:00Z" };
  const TTL = 12 * 3_600_000;

  it("is fresh inside the TTL with a matching fingerprint", () => {
    expect(isFresh(row, fp, TTL, now)).toBe(true);
  });

  it("is stale past the TTL, on a new fingerprint, on an old model, or with no row", () => {
    expect(isFresh(row, fp, 5 * 3_600_000, now)).toBe(false);
    expect(isFresh(row, "other", TTL, now)).toBe(false);
    expect(isFresh({ ...row, modelVersion: 0 }, fp, TTL, now)).toBe(false);
    expect(isFresh(null, fp, TTL, now)).toBe(false);
  });
});

describe("staleOrFailed", () => {
  it("keeps the stored view when a rebuild fails", () => {
    const view = { generatedAt: "2026-10-28T10:00:00Z" } as BlueprintView;
    const cached = { view, fingerprint: "f", modelVersion: BLUEPRINT_MODEL_VERSION, generatedAt: view.generatedAt };
    expect(staleOrFailed(cached, "ctx", "boom")).toEqual({ kind: "stale", view, context: "ctx", reason: "failed" });
    expect(staleOrFailed(null, "ctx", "boom")).toEqual({ kind: "failed", context: "ctx", message: "boom" });
  });
});
