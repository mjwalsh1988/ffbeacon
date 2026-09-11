import { describe, it, expect } from "vitest";
import { validateHandleFormat, normalizeHandle } from "@/lib/signal";

/**
 * public/{key}.txt (the IndexNow key file, section 5 of the SEO plan) does
 * not need an entry in RESERVED_ROUTE_SEGMENTS: files under public/ are
 * served before any dynamic route matches, so /{key}.txt can never reach the
 * /{handle} catch-all in the first place. This test is the fallback check the
 * plan calls for anyway: the key filename must never even be SHAPED like a
 * handle, so the two mechanisms cannot conflict in a future refactor that
 * changes route precedence.
 */
describe("IndexNow key filename versus the handle shape", () => {
  const KEY_FILENAME = "be0374e062dc4aaf9603541eb303e58d.txt";

  it("does not pass validateHandleFormat, so it can never be claimed or resolved as a handle", () => {
    const handle = normalizeHandle(KEY_FILENAME);
    expect(validateHandleFormat(handle)).not.toBeNull();
  });

  it("fails specifically because of the .txt extension: dots are not in the handle charset", () => {
    const handle = normalizeHandle(KEY_FILENAME);
    expect(handle).toContain(".");
    expect(/^[a-z0-9_]+$/.test(handle)).toBe(false);
  });
});
