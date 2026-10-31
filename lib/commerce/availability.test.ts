import { describe, expect, it } from "vitest";
import { offerAvailability } from "./availability";
import { DEFAULT_COMMERCE_SETTINGS as d, type CommerceSettings } from "./default-settings";

function settings(patch: Partial<CommerceSettings>): CommerceSettings {
  return { ...d, ...patch };
}

describe("offerAvailability", () => {
  it("is open with every method by default", () => {
    expect(offerAvailability(d, 0, true)).toEqual({
      open: true,
      reason: null,
      methods: ["stripe", "paypal", "venmo"],
    });
  });

  it("is closed when the storefront is switched off", () => {
    const s = settings({ storefront: { ...d.storefront, enabled: false } });
    expect(offerAvailability(s, 0, true)).toMatchObject({ open: false, reason: "closed" });
  });

  it("is fully booked at the cap, and open one under it", () => {
    expect(offerAvailability(d, 10, true)).toMatchObject({
      open: false,
      reason: "fully_booked",
    });
    expect(offerAvailability(d, 9, true).open).toBe(true);
  });

  it("is fully booked by the switch whatever the count", () => {
    const s = settings({ storefront: { ...d.storefront, fullyBooked: true } });
    expect(offerAvailability(s, 0, true)).toMatchObject({
      open: false,
      reason: "fully_booked",
    });
  });

  it("drops Stripe when it is not configured", () => {
    expect(offerAvailability(d, 0, false).methods).toEqual(["paypal", "venmo"]);
  });

  it("drops a method switched off", () => {
    const s = settings({ payments: { ...d.payments, venmo: false } });
    expect(offerAvailability(s, 0, true).methods).toEqual(["stripe", "paypal"]);
  });
});
