import { describe, it, expect, vi } from "vitest";

// client-ip.ts is marked "server-only"; neutralize that guard for the node test.
vi.mock("server-only", () => ({}));

import { getTrustedClientIp, UNKNOWN_IP } from "@/lib/client-ip";

function req(headers: Record<string, string>): Request {
  return new Request("http://test/", { headers });
}

/** FFB-SEC-008: trusted client-IP derivation. */
describe("getTrustedClientIp", () => {
  it("prefers the Vercel platform header (not client-spoofable)", () => {
    expect(
      getTrustedClientIp(
        req({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("uses x-real-ip over x-forwarded-for", () => {
    expect(
      getTrustedClientIp(req({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "6.6.6.6" })),
    ).toBe("203.0.113.5");
  });

  it("never returns the client-spoofed leftmost x-forwarded-for entry", () => {
    const ip = getTrustedClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }));
    expect(ip).not.toBe("6.6.6.6");
    expect(ip).toBe("203.0.113.9"); // rightmost trusted hop
  });

  it("fails closed to a stable sentinel when no IP resolves (never fails open)", () => {
    expect(getTrustedClientIp(req({}))).toBe(UNKNOWN_IP);
    // Stable across calls so the limit still applies to unattributable traffic.
    expect(getTrustedClientIp(req({}))).toBe(getTrustedClientIp(req({})));
    expect(UNKNOWN_IP.length).toBeGreaterThan(0);
  });
});
