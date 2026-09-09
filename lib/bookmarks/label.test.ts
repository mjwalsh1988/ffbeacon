import { describe, expect, it } from "vitest";
import { defaultBookmarkLabel } from "./label";
import { MAX_BOOKMARK_LABEL_LENGTH } from "./types";

describe("defaultBookmarkLabel", () => {
  it("uses the label a page registered for itself, over its slug", () => {
    expect(
      defaultBookmarkLabel("/players/ja-marr-chase", "Ja'Marr Chase"),
    ).toBe("Ja'Marr Chase");
  });

  it("falls back to the last crumb", () => {
    expect(defaultBookmarkLabel("/tools/faab")).toBe("FAAB Calculator");
    expect(defaultBookmarkLabel("/my-beacon/bookmarks")).toBe("Bookmarks");
  });

  it("humanises a slug the route table does not know", () => {
    expect(defaultBookmarkLabel("/guides/some-new-guide")).toBe(
      "Some New Guide",
    );
  });

  it("names the homepage, which has no trail at all", () => {
    expect(defaultBookmarkLabel("/")).toBe("FF Beacon");
  });

  it("ignores a registered label that is only whitespace", () => {
    expect(defaultBookmarkLabel("/tools/faab", "   ")).toBe("FAAB Calculator");
    expect(defaultBookmarkLabel("/tools/faab", null)).toBe("FAAB Calculator");
  });

  it("collapses and clamps a long registered label", () => {
    const long = `${"word ".repeat(40)}`;
    const result = defaultBookmarkLabel("/brief/x", long);
    expect(result.length).toBeLessThanOrEqual(MAX_BOOKMARK_LABEL_LENGTH);
    expect(result).not.toMatch(/\s\s/);
  });
});
