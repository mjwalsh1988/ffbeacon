import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  loadManagerPulseSettings,
  saveManagerPulseSettings,
  MANAGER_PULSE_SETTINGS_ID,
} from "./settings";
import {
  DEFAULT_MANAGER_PULSE_SETTINGS,
  mergeManagerPulseSettings,
} from "./default-settings";
import { validateManagerPulseSettings } from "./validate";

type SelectResult = { data: { settings: unknown } | null; error: { message: string } | null };

function makeAdmin(opts: {
  selectResult?: SelectResult;
  selectThrows?: boolean;
  upsertError?: { message: string } | null;
} = {}) {
  const selectResult: SelectResult = opts.selectResult ?? { data: null, error: null };
  const maybeSingle = opts.selectThrows
    ? vi.fn().mockRejectedValue(new Error("boom"))
    : vi.fn().mockResolvedValue(selectResult);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null });
  const from = vi.fn(() => ({ select, upsert }));
  return { admin: { from } as unknown as SupabaseClient<Database>, from, select, eq, maybeSingle, upsert };
}

describe("loadManagerPulseSettings", () => {
  it("returns the code defaults when no row exists", async () => {
    const { admin } = makeAdmin({ selectResult: { data: null, error: null } });
    const settings = await loadManagerPulseSettings(admin);
    expect(settings).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
  });

  it("returns the code defaults on a query error", async () => {
    const { admin } = makeAdmin({
      selectResult: { data: null, error: { message: "relation does not exist" } },
    });
    const settings = await loadManagerPulseSettings(admin);
    expect(settings).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
  });

  it("returns the code defaults when the client throws", async () => {
    const { admin } = makeAdmin({ selectThrows: true });
    const settings = await loadManagerPulseSettings(admin);
    expect(settings).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
  });

  it("merges a stored row over the defaults", async () => {
    const { admin } = makeAdmin({
      selectResult: {
        data: { settings: { capture: { seasonWindowDefault: 6 } } },
        error: null,
      },
    });
    const settings = await loadManagerPulseSettings(admin);
    expect(settings.capture.seasonWindowDefault).toBe(6);
    // untouched fields still come from defaults
    expect(settings.capture.maxLeaguesPerRun).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.capture.maxLeaguesPerRun,
    );
  });

  it("queries the global row id", async () => {
    const { admin, eq } = makeAdmin();
    await loadManagerPulseSettings(admin);
    expect(eq).toHaveBeenCalledWith("id", MANAGER_PULSE_SETTINGS_ID);
  });
});

describe("saveManagerPulseSettings", () => {
  it("upserts the settings document keyed on the global row id", async () => {
    const { admin, upsert } = makeAdmin();
    const result = await saveManagerPulseSettings(
      admin,
      DEFAULT_MANAGER_PULSE_SETTINGS,
      "user-1",
    );
    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MANAGER_PULSE_SETTINGS_ID,
        settings: DEFAULT_MANAGER_PULSE_SETTINGS,
        updated_by: "user-1",
      }),
      { onConflict: "id" },
    );
  });

  it("returns the error message when the write fails", async () => {
    const { admin } = makeAdmin({ upsertError: { message: "permission denied" } });
    const result = await saveManagerPulseSettings(admin, DEFAULT_MANAGER_PULSE_SETTINGS, null);
    expect(result).toEqual({ ok: false, error: "permission denied" });
  });
});

describe("mergeManagerPulseSettings", () => {
  it("returns exactly the defaults for a missing row", () => {
    expect(mergeManagerPulseSettings(null)).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
    expect(mergeManagerPulseSettings(undefined)).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
  });

  it("returns exactly the defaults for a corrupt (non-object) row", () => {
    expect(mergeManagerPulseSettings("nope")).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
    expect(mergeManagerPulseSettings(42)).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
    expect(mergeManagerPulseSettings([1, 2, 3])).toEqual(DEFAULT_MANAGER_PULSE_SETTINGS);
  });

  it("ignores unknown keys", () => {
    const merged = mergeManagerPulseSettings({
      capture: { seasonWindowDefault: 5, notARealField: "hello" },
      notARealGroup: { anything: true },
    });
    expect(merged.capture.seasonWindowDefault).toBe(5);
    expect((merged.capture as Record<string, unknown>).notARealField).toBeUndefined();
    expect((merged as Record<string, unknown>).notARealGroup).toBeUndefined();
  });

  it("ignores a value of the wrong type and falls back to the default", () => {
    const merged = mergeManagerPulseSettings({
      capture: { seasonWindowDefault: "five" },
      tendency: { enabledForTradeIdeas: "yes" },
    });
    expect(merged.capture.seasonWindowDefault).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.capture.seasonWindowDefault,
    );
    expect(merged.tendency.enabledForTradeIdeas).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.tendency.enabledForTradeIdeas,
    );
  });

  it("keeps a valid modelVersion and falls back on an invalid one", () => {
    expect(mergeManagerPulseSettings({ modelVersion: "mp-2" }).modelVersion).toBe("mp-2");
    expect(mergeManagerPulseSettings({ modelVersion: "" }).modelVersion).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.modelVersion,
    );
    expect(mergeManagerPulseSettings({ modelVersion: 7 }).modelVersion).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.modelVersion,
    );
  });
});

describe("validateManagerPulseSettings", () => {
  it("accepts the shipped defaults", () => {
    const result = validateManagerPulseSettings(DEFAULT_MANAGER_PULSE_SETTINGS);
    expect(result.ok).toBe(true);
  });

  it("rejects a season window default below the minimum", () => {
    const invalid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    invalid.capture.seasonWindowMin = 4;
    invalid.capture.seasonWindowDefault = 2;
    const result = validateManagerPulseSettings(invalid);
    expect(result.ok).toBe(false);
  });

  it("rejects a season window default above the maximum", () => {
    const invalid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    invalid.capture.seasonWindowMax = 3;
    invalid.capture.seasonWindowDefault = 4;
    const result = validateManagerPulseSettings(invalid);
    expect(result.ok).toBe(false);
  });

  it("rejects confidenceLowMax not below confidenceMediumMax", () => {
    const invalid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    invalid.tendency.confidenceLowMax = 15;
    invalid.tendency.confidenceMediumMax = 15;
    const result = validateManagerPulseSettings(invalid);
    expect(result.ok).toBe(false);
  });

  it("rejects a modelVersion with uppercase or spaces", () => {
    const invalid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    invalid.modelVersion = "MP 1";
    const result = validateManagerPulseSettings(invalid);
    expect(result.ok).toBe(false);
  });

  it("accepts a modelVersion with dots, underscores, and hyphens", () => {
    const valid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    valid.modelVersion = "mp-1.2_beta";
    const result = validateManagerPulseSettings(valid);
    expect(result.ok).toBe(true);
  });

  it("rejects a value outside its bound", () => {
    const invalid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    invalid.capture.maxLeaguesPerRun = 10000;
    const result = validateManagerPulseSettings(invalid);
    expect(result.ok).toBe(false);
  });

  it("names the field in the error message", () => {
    const invalid = structuredClone(DEFAULT_MANAGER_PULSE_SETTINGS);
    invalid.capture.maxLeaguesPerRun = 10000;
    const result = validateManagerPulseSettings(invalid);
    if (!result.ok) {
      expect(result.error).toContain("maxLeaguesPerRun");
    } else {
      throw new Error("expected validation to fail");
    }
  });
});
