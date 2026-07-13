import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyCronRequest } from "@/lib/cron-auth";

function reqWith(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request("http://test/api/cron/x", { headers });
}

const ORIGINAL = process.env.CRON_SECRET;

describe("verifyCronRequest (FFB-SEC-009)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cr3t-value-abc";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it("accepts the exact valid bearer", () => {
    expect(verifyCronRequest(reqWith("Bearer s3cr3t-value-abc"))).toEqual({ ok: true });
  });

  it("rejects an incorrect secret (401)", () => {
    expect(verifyCronRequest(reqWith("Bearer wrong"))).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
  });

  it("rejects a missing Authorization header (401)", () => {
    expect(verifyCronRequest(reqWith())).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a malformed header without the Bearer prefix (401)", () => {
    expect(verifyCronRequest(reqWith("s3cr3t-value-abc"))).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed with 500 when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronRequest(reqWith("Bearer anything"))).toMatchObject({ ok: false, status: 500 });
  });
});
