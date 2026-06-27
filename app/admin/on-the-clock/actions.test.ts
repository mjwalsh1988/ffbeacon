import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAdminMock, upsertMock, maybeSingleMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  upsertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: upsertMock,
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
    }),
  }),
}));

import { saveOnTheClockSettings, resetOnTheClockSettings } from "./actions";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "@/lib/on-the-clock/default-settings";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ userId: "admin-1" });
  upsertMock.mockResolvedValue({ error: null });
  maybeSingleMock.mockResolvedValue({ data: null });
});

describe("saveOnTheClockSettings", () => {
  it("requires admin (propagates the requireAdmin redirect/throw)", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(saveOnTheClockSettings(DEFAULT_ON_THE_CLOCK_SETTINGS)).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("saves valid settings and stamps updated_by from the verified session", async () => {
    const res = await saveOnTheClockSettings(DEFAULT_ON_THE_CLOCK_SETTINGS);
    expect(res.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const payload = upsertMock.mock.calls[0][0];
    expect(payload.id).toBe("global");
    expect(payload.updated_by).toBe("admin-1");
    expect(payload.settings.feature.enabled).toBe(false);
  });

  it("clamps an unsafe lock/cooldown pair before writing", async () => {
    const bad = structuredClone(DEFAULT_ON_THE_CLOCK_SETTINGS);
    bad.sync.cooldownSeconds = 10;
    bad.sync.lockSeconds = 90; // > cooldown: would fail validation un-clamped
    const res = await saveOnTheClockSettings(bad);
    expect(res.ok).toBe(true);
    const payload = upsertMock.mock.calls[0][0];
    expect(payload.settings.sync.lockSeconds).toBeLessThanOrEqual(
      payload.settings.sync.cooldownSeconds,
    );
  });

  it("rejects a malformed payload (bad enum) without writing", async () => {
    // Clamping fixes numbers, but a bad enum cannot be coerced and must be rejected.
    const res = await saveOnTheClockSettings({ recommendation: { aggressiveness: "reckless" } });
    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("surfaces a db error", async () => {
    upsertMock.mockResolvedValue({ error: { message: "boom" } });
    const res = await saveOnTheClockSettings(DEFAULT_ON_THE_CLOCK_SETTINGS);
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});

describe("resetOnTheClockSettings", () => {
  it("requires admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(resetOnTheClockSettings()).rejects.toThrow();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("restores defaults but keeps the current enabled state (on)", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { settings: { feature: { enabled: true }, sync: { cooldownSeconds: 120 } } },
    });
    const res = await resetOnTheClockSettings();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.feature.enabled).toBe(true);
      // a non-feature override is gone (back to default)
      expect(res.settings.sync.cooldownSeconds).toBe(
        DEFAULT_ON_THE_CLOCK_SETTINGS.sync.cooldownSeconds,
      );
    }
    const payload = upsertMock.mock.calls[0][0];
    expect(payload.settings.feature.enabled).toBe(true);
    expect(payload.updated_by).toBe("admin-1");
  });

  it("defaults to disabled when there is no existing row", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });
    const res = await resetOnTheClockSettings();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.settings.feature.enabled).toBe(false);
  });
});
