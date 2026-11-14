import { describe, expect, it } from "vitest";
import { availableCategoriesFor } from "./load";
import { ACTIVITY_CATEGORIES } from "./types";

describe("availableCategoriesFor", () => {
  it("lists only the categories present when the whole window loaded", () => {
    const cats = availableCategoriesFor(
      [
        { category: ACTIVITY_CATEGORIES[0] },
        { category: ACTIVITY_CATEGORIES[0] },
      ],
      false,
    );
    expect(cats).toEqual([ACTIVITY_CATEGORIES[0]]);
  });

  it("keeps every category enabled when the row cap truncated the list", () => {
    const cats = availableCategoriesFor([{ category: ACTIVITY_CATEGORIES[0] }], true);
    expect(cats).toEqual([...ACTIVITY_CATEGORIES]);
  });
});
