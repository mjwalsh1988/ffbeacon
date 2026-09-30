import { describe, expect, it } from "vitest";
import { NO_ACTIVE_OPTION, nextComboboxIndex, nextRadioIndex } from "./keyboard-navigation";

describe("nextComboboxIndex", () => {
  it("lands the first Down on the FIRST result, not the second", () => {
    expect(nextComboboxIndex(NO_ACTIVE_OPTION, "ArrowDown", 5)).toBe(0);
  });

  it("lands the first Up on the last result", () => {
    expect(nextComboboxIndex(NO_ACTIVE_OPTION, "ArrowUp", 5)).toBe(4);
  });

  it("steps and stops at the ends without wrapping", () => {
    expect(nextComboboxIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextComboboxIndex(2, "ArrowDown", 3)).toBe(2);
    expect(nextComboboxIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextComboboxIndex(0, "ArrowUp", 3)).toBe(0);
  });

  it("has no active option in an empty list", () => {
    expect(nextComboboxIndex(NO_ACTIVE_OPTION, "ArrowDown", 0)).toBe(NO_ACTIVE_OPTION);
    expect(nextComboboxIndex(3, "ArrowUp", 0)).toBe(NO_ACTIVE_OPTION);
  });

  it("recovers from an index left over from a longer list", () => {
    expect(nextComboboxIndex(7, "ArrowDown", 3)).toBe(0);
  });
});

describe("nextRadioIndex", () => {
  it("moves forward on Right and Down, wrapping", () => {
    expect(nextRadioIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextRadioIndex(2, "ArrowDown", 3)).toBe(0);
  });

  it("moves back on Left and Up, wrapping", () => {
    expect(nextRadioIndex(1, "ArrowLeft", 3)).toBe(0);
    expect(nextRadioIndex(0, "ArrowUp", 3)).toBe(2);
  });

  it("jumps to the ends on Home and End", () => {
    expect(nextRadioIndex(1, "Home", 4)).toBe(0);
    expect(nextRadioIndex(1, "End", 4)).toBe(3);
  });

  it("ignores every other key", () => {
    expect(nextRadioIndex(1, "Tab", 3)).toBeNull();
    expect(nextRadioIndex(1, " ", 3)).toBeNull();
    expect(nextRadioIndex(0, "ArrowRight", 0)).toBeNull();
  });
});
