import { describe, expect, it, vi } from "vitest";

// brand.tsx imports ./assets, which reads the font and logo files at module
// load. fitText needs none of that, so the file reads are stubbed out.
vi.mock("./assets", () => ({
  OG_FONT_FAMILY: "Geist",
  OG_FONTS: [],
  OG_LOGO_DATA_URI: "data:image/png;base64,",
  OG_WORDMARK: "FFBeacon.com",
}));

const { fitText } = await import("./brand");

describe("fitText", () => {
  it("keeps a short title at the largest size on one line", () => {
    const r = fitText("S2", { width: 540, maxSize: 72, minSize: 40, maxLines: 3 });
    expect(r).toEqual({ text: "S2", fontSize: 72, lines: 1 });
  });

  it("steps the size down until a long league name fits its line budget", () => {
    const r = fitText("Wait Dylan there are stairs over there, Oh no!", { width: 540, maxSize: 72, minSize: 40, maxLines: 3 });
    expect(r.text).toBe("Wait Dylan there are stairs over there, Oh no!");
    expect(r.fontSize).toBeLessThan(72);
    expect(r.lines).toBeLessThanOrEqual(3);
  });

  it("clips at a word boundary with three periods when even the minimum size will not hold it", () => {
    const long = "word ".repeat(80).trim();
    const r = fitText(long, { width: 300, maxSize: 30, minSize: 20, maxLines: 2 });
    expect(r.fontSize).toBe(20);
    expect(r.lines).toBe(2);
    expect(r.text.endsWith("...")).toBe(true);
    expect(r.text.length).toBeLessThan(long.length);
    expect(r.text).not.toMatch(/\s\.\.\.$/);
  });

  it("clips a single unbreakable word rather than letting it overflow", () => {
    const r = fitText("x".repeat(200), { width: 200, maxSize: 30, minSize: 20, maxLines: 1 });
    expect(r.text.endsWith("...")).toBe(true);
    expect(r.text.length).toBeLessThan(200);
  });

  it("collapses runs of whitespace before measuring", () => {
    expect(fitText("  Fantasy   Football  ", { width: 800, maxSize: 40, minSize: 20, maxLines: 1 }).text).toBe("Fantasy Football");
  });
});
