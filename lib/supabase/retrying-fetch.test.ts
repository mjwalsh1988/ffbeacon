import { describe, expect, it, vi } from "vitest";
import { createRetryingFetch } from "./retrying-fetch";

const ok = () => new Response("[]", { status: 200 });
const bad = (status: number) => new Response("", { status });

describe("createRetryingFetch", () => {
  it("retries a read that threw and returns the later answer", async () => {
    const base = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce(ok());
    const res = await createRetryingFetch(base, [1, 1, 1])("https://db.test/rest/v1/leagues");
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("retries a gateway error and gives up with the last answer", async () => {
    const base = vi.fn().mockImplementation(async () => bad(503));
    const res = await createRetryingFetch(base, [1, 1])("https://db.test/rest/v1/leagues");
    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("uses the global fetch in place at call time, not at import", async () => {
    const stub = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", stub);
    try {
      const res = await createRetryingFetch(undefined, [1])("https://db.test/rest/v1/leagues");
      expect(res.status).toBe(200);
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws the last error once every try has failed", async () => {
    const base = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(createRetryingFetch(base, [1, 1])("https://db.test/x")).rejects.toThrow("fetch failed");
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("returns a 4xx at once: it is the database's real answer", async () => {
    const base = vi.fn().mockResolvedValue(bad(404));
    const res = await createRetryingFetch(base, [1, 1])("https://db.test/x");
    expect(res.status).toBe(404);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("never repeats a write", async () => {
    const base = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(
      createRetryingFetch(base, [1, 1])("https://db.test/x", { method: "POST", body: "{}" }),
    ).rejects.toThrow("fetch failed");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the request is aborted", async () => {
    const controller = new AbortController();
    const base = vi.fn().mockImplementation(async () => {
      controller.abort(new Error("gone"));
      throw new Error("fetch failed");
    });
    await expect(
      createRetryingFetch(base, [50])("https://db.test/x", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });
});
