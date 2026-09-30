import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

const FALLBACK = "/my-beacon";
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const C1 = String.fromCharCode(0x85);

describe("safeRedirectPath", () => {
  it("keeps an ordinary same-origin path, query and fragment", () => {
    expect(safeRedirectPath("/my-beacon", FALLBACK)).toBe("/my-beacon");
    expect(safeRedirectPath("/tools/custom-rankings?claim=1", FALLBACK)).toBe(
      "/tools/custom-rankings?claim=1",
    );
    expect(safeRedirectPath("/leagues/123#teams", FALLBACK)).toBe("/leagues/123#teams");
  });

  it("falls back for missing or non-string input", () => {
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath(42, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("", FALLBACK)).toBe(FALLBACK);
  });

  it("refuses anything that is not a site-relative path", () => {
    for (const bad of [
      "https://example.com",
      "example.com/x",
      "javascript:alert(1)",
      "//example.com",
      "/\\example.com",
      "\\\\example.com",
      "/x\\y",
    ]) {
      expect(safeRedirectPath(bad, FALLBACK), bad).toBe(FALLBACK);
    }
  });

  it("refuses control characters browsers strip before parsing", () => {
    for (const ch of [TAB, LF, CR, NUL, C1]) {
      expect(safeRedirectPath(`/${ch}/example.com`, FALLBACK)).toBe(FALLBACK);
      expect(safeRedirectPath(`${ch}//example.com`, FALLBACK)).toBe(FALLBACK);
      expect(safeRedirectPath(`/ok${ch}`, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("refuses leading or trailing whitespace rather than trimming it", () => {
    expect(safeRedirectPath(" //example.com", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/ok ", FALLBACK)).toBe(FALLBACK);
  });

  it("refuses a path that normalises to a protocol-relative form", () => {
    expect(safeRedirectPath("/..//example.com", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/./..//example.com/x", FALLBACK)).toBe(FALLBACK);
  });

  it("refuses over-long input", () => {
    expect(safeRedirectPath(`/${"a".repeat(600)}`, FALLBACK)).toBe(FALLBACK);
  });

  it("never returns anything that leaves the origin, whatever the fallback", () => {
    const out = safeRedirectPath("/a/../b?x=1", "/");
    expect(out).toBe("/b?x=1");
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
  });
});
