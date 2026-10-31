import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMERCE_SETTINGS,
  mergeCommerceSettings,
  validateCommerceSettings,
} from "./settings";

const d = DEFAULT_COMMERCE_SETTINGS;

describe("commerce settings", () => {
  it("fills an empty document with the code defaults", () => {
    expect(validateCommerceSettings({})).toEqual({ ok: true, settings: d });
  });

  it("fills a partial older row field by field", () => {
    const merged = mergeCommerceSettings({
      storefront: { maxOpenOrders: 4 },
      payments: { venmo: false },
    });
    expect(merged.storefront.maxOpenOrders).toBe(4);
    expect(merged.storefront.countPendingPayment).toBe(true);
    expect(merged.payments.venmo).toBe(false);
    expect(merged.payments.stripe).toBe(true);
    expect(merged.rateLimits).toEqual(d.rateLimits);
  });

  it("requires the reminder before the expiry", () => {
    const result = validateCommerceSettings({
      payments: { manualExpiryDays: 3, manualReminderDay: 3 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("manualReminderDay");
  });

  it("holds Stripe's own bounds on a session's life", () => {
    expect(validateCommerceSettings({ payments: { stripeSessionMinutes: 29 } }).ok).toBe(false);
    expect(validateCommerceSettings({ payments: { stripeSessionMinutes: 1441 } }).ok).toBe(false);
    expect(validateCommerceSettings({ payments: { stripeSessionMinutes: 30 } }).ok).toBe(true);
  });

  it("refuses a wrong type and an address that is not one", () => {
    expect(validateCommerceSettings({ storefront: { maxOpenOrders: "ten" } }).ok).toBe(false);
    expect(validateCommerceSettings({ notifications: { adminEmail: "nobody" } }).ok).toBe(false);
  });

  it("falls back to the defaults on a corrupt row", () => {
    expect(mergeCommerceSettings({ storefront: { maxOpenOrders: -1 } })).toEqual(d);
  });
});
