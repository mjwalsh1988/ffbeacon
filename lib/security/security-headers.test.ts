import { describe, it, expect, beforeAll } from "vitest";
import {
  baselineSecurityHeaders,
  buildContentSecurityPolicy,
  securityHeadersForNextConfig,
} from "@/lib/security-headers";

/** FFB-SEC-005: global security response headers. */
describe("baseline security headers", () => {
  const byKey = Object.fromEntries(
    baselineSecurityHeaders.map((h) => [h.key.toLowerCase(), h.value]),
  );

  it("sets nosniff", () => {
    expect(byKey["x-content-type-options"]).toBe("nosniff");
  });
  it("denies framing (clickjacking)", () => {
    expect(byKey["x-frame-options"]).toBe("DENY");
  });
  it("sets a strict referrer policy", () => {
    expect(byKey["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
  it("ships a restrictive permissions policy", () => {
    expect(byKey["permissions-policy"]).toContain("camera=()");
    expect(byKey["permissions-policy"]).toContain("geolocation=()");
  });
  it("sets cross-origin isolation headers compatibly", () => {
    expect(byKey["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(byKey["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});

describe("content security policy", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://cilvpyivysjxpxbudkfa.supabase.co";
  });

  it("locks down framing, base-uri, and objects", () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("does NOT enable unsafe-eval", () => {
    expect(buildContentSecurityPolicy()).not.toContain("unsafe-eval");
  });

  it("allows the Supabase REST and Realtime origins", () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("https://cilvpyivysjxpxbudkfa.supabase.co");
    expect(csp).toContain("wss://cilvpyivysjxpxbudkfa.supabase.co");
  });

  it("ships CSP in report-only mode (documented path to enforcement)", () => {
    const headers = securityHeadersForNextConfig();
    const keys = headers.map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });
});
