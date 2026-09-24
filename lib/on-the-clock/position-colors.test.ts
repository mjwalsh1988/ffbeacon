import { describe, expect, it } from "vitest";
import {
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
  POSITION_CELL,
  POSITION_ROW,
  normalizePositionColor,
  positionColorKey,
} from "./position-colors";

describe("defender position colours (IDP-103)", () => {
  it("maps DL, LB and DB to their own classes, never the grey fallback", () => {
    for (const p of ["DL", "LB", "DB"] as const) {
      const key = positionColorKey(p);
      expect(key).toBe(p);
      expect(POSITION_BADGE[p]).toContain(`position-${p.toLowerCase()}`);
      expect(POSITION_BADGE[p]).not.toBe(POSITION_BADGE_FALLBACK);
      expect(POSITION_CELL[p]).toContain(`position-${p.toLowerCase()}`);
      expect(POSITION_ROW[p]).toContain(`position-${p.toLowerCase()}`);
    }
  });

  it("resolves Sleeper's sub-position labels to the fantasy position", () => {
    expect(positionColorKey("DE")).toBe("DL");
    expect(positionColorKey("OLB")).toBe("LB");
    expect(positionColorKey("CB")).toBe("DB");
    expect(positionColorKey("SS")).toBe("DB");
  });

  it("leaves the offense-only normaliser at six, so the draft tracker stays offense-only", () => {
    expect(normalizePositionColor("LB")).toBeNull();
    expect(normalizePositionColor("DST")).toBe("DEF");
    expect(positionColorKey("WR")).toBe("WR");
    expect(positionColorKey("OL")).toBeNull();
  });
});
