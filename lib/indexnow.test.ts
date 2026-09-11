import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "@/lib/site";
import { submitIndexNow } from "./indexnow";

/**
 * IndexNow key format per the protocol: 8 to 128 characters of a-z, A-Z, 0-9
 * and dash. Used both to find the committed key file below and to sanity
 * check its content.
 */
const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

const ORIGINAL_KEY = process.env.INDEXNOW_KEY;

function jsonResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

describe("submitIndexNow", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.INDEXNOW_KEY = "be0374e062dc4aaf9603541eb303e58d";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = ORIGINAL_KEY;
  });

  it("returns ok:false status:0 and makes no request when INDEXNOW_KEY is missing", async () => {
    delete process.env.INDEXNOW_KEY;
    const result = await submitIndexNow(["/brief"]);
    expect(result).toEqual({ ok: false, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok:false status:0 and makes no request for an empty list", async () => {
    const result = await submitIndexNow([]);
    expect(result).toEqual({ ok: false, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the payload shape the protocol expects, host from SITE.url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await submitIndexNow(["/brief"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json; charset=utf-8",
    );

    const host = new URL(SITE.url).host;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      host,
      key: "be0374e062dc4aaf9603541eb303e58d",
      keyLocation: `https://${host}/be0374e062dc4aaf9603541eb303e58d.txt`,
      urlList: [`${SITE.url.replace(/\/+$/, "")}/brief`],
    });
  });

  it("expands relative paths against SITE.url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await submitIndexNow(["/rankings/dynasty-ppr-sflex"]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.urlList).toEqual([
      `${SITE.url.replace(/\/+$/, "")}/rankings/dynasty-ppr-sflex`,
    ]);
  });

  it("drops URLs on any other host and de-duplicates the rest, capped at 10000", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    const own = `${SITE.url.replace(/\/+$/, "")}/brief`;
    await submitIndexNow([own, "/brief", "https://example.com/evil"]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.urlList).toEqual([own]);
  });

  it("returns ok:false with only the foreign URL dropped, so an all-foreign list makes no request", async () => {
    const result = await submitIndexNow(["https://example.com/x"]);
    expect(result).toEqual({ ok: false, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok:false with the response status on a non-2xx response, and never throws", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429));
    const result = await submitIndexNow(["/brief"]);
    expect(result).toEqual({ ok: false, status: 429 });
  });

  it("returns ok:true with the response status on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    const result = await submitIndexNow(["/brief"]);
    expect(result).toEqual({ ok: true, status: 200 });
  });

  it("returns ok:false status:0 without throwing when the request rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await submitIndexNow(["/brief"]);
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it("returns ok:false status:0 without throwing when the 20 second timeout aborts the request", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const promise = submitIndexNow(["/brief"]);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;
    expect(result).toEqual({ ok: false, status: 0 });
    vi.useRealTimers();
  });
});

/**
 * The key file at public/{key}.txt is what proves host control to IndexNow,
 * and it has to agree byte-for-byte with INDEXNOW_KEY or the protocol's own
 * verification step fails. This does not import .env.local (vitest does not
 * load it), so it locates the committed file by its own shape instead and
 * only cross-checks process.env.INDEXNOW_KEY when that happens to be set in
 * the running process.
 */
describe("public/{key}.txt agrees with INDEXNOW_KEY", () => {
  it("has exactly one key-shaped .txt file, whose trimmed content equals its filename", () => {
    const publicDir = join(process.cwd(), "public");
    const candidates = readdirSync(publicDir).filter((name) => {
      if (!name.endsWith(".txt")) return false;
      const stem = name.slice(0, -".txt".length);
      return KEY_FORMAT.test(stem);
    });

    expect(candidates, "no IndexNow key file found under public/").toHaveLength(1);

    const stem = candidates[0].slice(0, -".txt".length);
    const content = readFileSync(join(publicDir, candidates[0]), "utf8").trim();
    expect(content).toBe(stem);
    expect(KEY_FORMAT.test(content)).toBe(true);

    if (process.env.INDEXNOW_KEY) {
      expect(content).toBe(process.env.INDEXNOW_KEY);
    }
  });
});
