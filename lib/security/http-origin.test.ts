import { describe, it, expect } from "vitest";
import { isSameOrigin } from "@/lib/http-origin";

/** FFB-SEC-013: same-origin guard used by the sign-out route. */
function req(headers: Record<string, string>): Request {
  return new Request("https://ffbeacon.com/auth/signout", { method: "POST", headers });
}

describe("isSameOrigin", () => {
  it("accepts a same-origin Origin header", () => {
    expect(isSameOrigin(req({ origin: "https://ffbeacon.com" }))).toBe(true);
  });

  it("rejects a cross-origin Origin header", () => {
    expect(isSameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
  });

  it("falls back to a same-origin Referer when Origin is absent", () => {
    expect(isSameOrigin(req({ referer: "https://ffbeacon.com/my-beacon" }))).toBe(true);
  });

  it("rejects a cross-origin Referer", () => {
    expect(isSameOrigin(req({ referer: "https://evil.example/x" }))).toBe(false);
  });

  it("fails closed when neither Origin nor Referer is present", () => {
    expect(isSameOrigin(req({}))).toBe(false);
  });
});
