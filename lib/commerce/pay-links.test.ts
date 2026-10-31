import { describe, expect, it } from "vitest";
import { manualPayUrl, orderNote, paypalOrderUrl, venmoOrderUrl } from "./pay-links";
import { PAY_HANDLE } from "@/lib/donate/links";

describe("order pay links", () => {
  it("writes the order number into the note", () => {
    expect(orderNote("FFB-100001")).toBe("FF Beacon order FFB-100001");
  });

  it("builds a paypal.me link with cents and with a whole amount", () => {
    expect(paypalOrderUrl(1995)).toBe(
      `https://www.paypal.com/paypalme/${PAY_HANDLE}/19.95USD`,
    );
    expect(paypalOrderUrl(2000)).toBe(`https://www.paypal.com/paypalme/${PAY_HANDLE}/20USD`);
  });

  it("builds a private Venmo link carrying the encoded note", () => {
    const url = new URL(venmoOrderUrl(995, "FFB-100001"));
    expect(url.host).toBe("venmo.com");
    expect(url.searchParams.get("txn")).toBe("pay");
    expect(url.searchParams.get("audience")).toBe("private");
    expect(url.searchParams.get("recipients")).toBe(PAY_HANDLE);
    expect(url.searchParams.get("amount")).toBe("9.95");
    expect(url.searchParams.get("note")).toBe("FF Beacon order FFB-100001");
    expect(url.search).toContain("note=FF+Beacon+order+FFB-100001");
  });

  it("routes by method", () => {
    expect(manualPayUrl("paypal", 995, "FFB-100001")).toContain("paypal.com");
    expect(manualPayUrl("venmo", 995, "FFB-100001")).toContain("venmo.com");
  });
});
