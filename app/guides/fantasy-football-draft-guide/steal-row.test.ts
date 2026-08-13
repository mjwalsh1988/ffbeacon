import { describe, it, expect } from "vitest";
import { readableAccent } from "./steal-row";

/** Perceived brightness, the same measure readableAccent works against. */
function brightness(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe("readableAccent", () => {
  it("lifts a near-black team color until it is visible on a dark card", () => {
    // Pittsburgh's real primary. Painted straight onto #0F0F1A it is invisible.
    const lifted = readableAccent("#101820");
    expect(brightness(lifted)).toBeGreaterThanOrEqual(90);
    expect(lifted).not.toBe("#101820");
  });

  it("lifts a dark red without turning it grey", () => {
    // Washington's real primary. The hue has to survive the lift.
    const lifted = readableAccent("#5A1414");
    const r = parseInt(lifted.slice(1, 3), 16);
    const g = parseInt(lifted.slice(3, 5), 16);
    const b = parseInt(lifted.slice(5, 7), 16);
    expect(brightness(lifted)).toBeGreaterThanOrEqual(90);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("leaves an already-bright color alone", () => {
    // Case-insensitive: the function normalizes to lowercase hex.
    expect(readableAccent("#22D3EE").toLowerCase()).toBe("#22d3ee");
  });

  it("falls back to brand purple when there is no team color", () => {
    expect(readableAccent(null)).toBe("#A855F7");
    expect(readableAccent("")).toBe("#A855F7");
  });

  it("refuses a malformed value rather than emitting broken CSS", () => {
    expect(readableAccent("red")).toBe("#A855F7");
    expect(readableAccent("#fff")).toBe("#A855F7");
    expect(readableAccent("javascript:alert(1)")).toBe("#A855F7");
  });

  it("always returns a six-digit hex", () => {
    for (const input of ["#101820", "#5A1414", "#000000", "#002C5F", null]) {
      expect(readableAccent(input)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
