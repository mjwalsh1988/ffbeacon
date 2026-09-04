/**
 * Every Manager Pulse setting must be reachable from a form field on
 * /admin/manager-pulse, per the ABSOLUTE RULE in docs/manager-pulse-plan.md
 * section 5.1: a knob added to the defaults and never wired to a form field
 * fails this test.
 *
 * This is a deliberately crude check. It walks every leaf key of
 * DEFAULT_MANAGER_PULSE_SETTINGS, builds a dotted path for each (so a failure
 * message can name exactly which setting is missing), and then greps the
 * settings manager's own SOURCE TEXT for the leaf key's name. It does not
 * render the component, does not exercise onChange handlers, and does not
 * prove a field behaves correctly. What it catches is the one failure mode
 * that matters here: a setting that exists in the defaults but has no input
 * anywhere in the form, which would otherwise ship silently because nothing
 * else notices an unreachable field.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "@/lib/manager-pulse/default-settings";

const MANAGER_PATH = path.resolve(
  __dirname,
  "manager-pulse-settings-manager.tsx",
);

function leafPaths(value: unknown, prefix: string): string[] {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return [prefix];
  }
  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push(...leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

/** The last segment of a dotted path, which is the actual property name a
 *  form field's onChange handler would reference. */
function leafName(dottedPath: string): string {
  const segments = dottedPath.split(".");
  return segments[segments.length - 1];
}

describe("every Manager Pulse setting is wired to a form field", () => {
  const paths = leafPaths(DEFAULT_MANAGER_PULSE_SETTINGS, "");
  const source = readFileSync(MANAGER_PATH, "utf8");

  it("has at least one setting to check", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it("names every leaf key in the settings manager source", () => {
    const missing = paths.filter((dotted) => !source.includes(leafName(dotted)));
    expect(
      missing.length === 0,
      `Settings not wired to any form field in manager-pulse-settings-manager.tsx: ${missing.join(", ")}`,
    ).toBe(true);
  });
});
