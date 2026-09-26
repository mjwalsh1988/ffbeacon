/**
 * Every Beacon Ranker setting must be reachable from a form field on
 * /admin/beacon-ranker. A knob added to the defaults and never wired to a
 * field fails this test. The same deliberately crude source check as the
 * Manager Pulse one: it walks every leaf key of the defaults and looks for the
 * leaf's name in the form's source text.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_RANKING_BUILDER_SETTINGS } from "@/lib/ranking-boards/default-settings";
import {
  mergeRankingBuilderSettings,
  validateRankingBuilderSettings,
} from "@/lib/ranking-boards/validate";

const MANAGER_PATH = path.resolve(__dirname, "beacon-ranker-settings-manager.tsx");

function leafPaths(value: unknown, prefix: string): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("every Beacon Ranker setting is wired to a form field", () => {
  const paths = leafPaths(DEFAULT_RANKING_BUILDER_SETTINGS, "");
  const source = readFileSync(MANAGER_PATH, "utf8");

  it("names every leaf key in the settings manager source", () => {
    const missing = paths.filter((dotted) => !source.includes(dotted.split(".").pop()!));
    expect(missing, `Not wired: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("validation", () => {
  it("accepts the defaults and fills an empty row with them", () => {
    expect(validateRankingBuilderSettings(DEFAULT_RANKING_BUILDER_SETTINGS).ok).toBe(true);
    expect(mergeRankingBuilderSettings({})).toEqual(DEFAULT_RANKING_BUILDER_SETTINGS);
    expect(mergeRankingBuilderSettings("garbage")).toEqual(DEFAULT_RANKING_BUILDER_SETTINGS);
  });

  it("refuses out-of-bounds numbers and the unbuilt source switch", () => {
    const bad = structuredClone(DEFAULT_RANKING_BUILDER_SETTINGS);
    bad.builder.winsBeforePrompt = 1;
    expect(validateRankingBuilderSettings(bad).ok).toBe(false);
    const source = structuredClone(DEFAULT_RANKING_BUILDER_SETTINGS);
    source.community.sourceEnabled = true;
    expect(validateRankingBuilderSettings(source).ok).toBe(false);
    const caps = structuredClone(DEFAULT_RANKING_BUILDER_SETTINGS);
    caps.guests.capSingle = 60;
    expect(validateRankingBuilderSettings(caps).ok).toBe(false);
  });
});
