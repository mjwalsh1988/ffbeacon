import { describe, it, expect } from "vitest";
import {
  isValidUsername,
  isValidSeason,
  isValidLeagueId,
  isValidDraftId,
  normalizeUsername,
  sanitizeSleeperPlayerId,
  sanitizeSleeperPlayerIds,
} from "./validation";

describe("isValidUsername", () => {
  it("accepts letters, digits, underscore up to 32 chars", () => {
    expect(isValidUsername("Michael_99")).toBe(true);
    expect(isValidUsername("a")).toBe(true);
    expect(isValidUsername("x".repeat(32))).toBe(true);
  });
  it("rejects empty, too long, or hostile characters", () => {
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("x".repeat(33))).toBe(false);
    expect(isValidUsername("bad name")).toBe(false);
    expect(isValidUsername("drop;table")).toBe(false);
    expect(isValidUsername(123 as unknown)).toBe(false);
  });
});

describe("isValidSeason", () => {
  it("accepts a 4-digit year", () => {
    expect(isValidSeason("2026")).toBe(true);
  });
  it("rejects non-4-digit values", () => {
    expect(isValidSeason("26")).toBe(false);
    expect(isValidSeason("20260")).toBe(false);
    expect(isValidSeason("20a6")).toBe(false);
  });
});

describe("isValidLeagueId / isValidDraftId", () => {
  it("accepts numeric ids up to 20 digits", () => {
    expect(isValidLeagueId("992054")).toBe(true);
    expect(isValidDraftId("9".repeat(20))).toBe(true);
  });
  it("rejects non-numeric or over-length", () => {
    expect(isValidLeagueId("")).toBe(false);
    expect(isValidLeagueId("9".repeat(21))).toBe(false);
    expect(isValidDraftId("BUF")).toBe(false);
    expect(isValidDraftId("123abc")).toBe(false);
  });
});

describe("normalizeUsername", () => {
  it("lowercases and trims a valid username", () => {
    expect(normalizeUsername("  Michael_99 ")).toBe("michael_99");
  });
  it("returns null for invalid usernames", () => {
    expect(normalizeUsername("bad name")).toBe(null);
    expect(normalizeUsername("")).toBe(null);
    expect(normalizeUsername(null)).toBe(null);
  });
});

describe("sanitizeSleeperPlayerId", () => {
  it("allows numeric skill-player ids", () => {
    expect(sanitizeSleeperPlayerId("4046")).toBe("4046");
  });
  it("allows non-numeric DEF team-code ids like BUF", () => {
    expect(sanitizeSleeperPlayerId("BUF")).toBe("BUF");
    expect(sanitizeSleeperPlayerId("ARI")).toBe("ARI");
  });
  it("drops hostile ids", () => {
    expect(sanitizeSleeperPlayerId("4046; drop table")).toBe(null);
    expect(sanitizeSleeperPlayerId("external_ids->>sleeper")).toBe(null);
    expect(sanitizeSleeperPlayerId("'or'1'='1")).toBe(null);
    expect(sanitizeSleeperPlayerId("x".repeat(17))).toBe(null);
    expect(sanitizeSleeperPlayerId(42 as unknown)).toBe(null);
  });
});

describe("sanitizeSleeperPlayerIds", () => {
  it("keeps valid ids (numeric + BUF + kicker), drops hostile and '0', de-dupes", () => {
    const out = sanitizeSleeperPlayerIds([
      "4046", // skill
      "BUF", // DEF team code
      "5045", // kicker
      "0", // empty-slot placeholder -> dropped
      "bad id", // hostile (space) -> dropped
      "4046", // dup -> dropped
      "DROP TABLE players", // hostile -> dropped
    ]);
    expect(out).toEqual(["4046", "BUF", "5045"]);
  });
  it("returns an empty array when nothing is valid", () => {
    expect(sanitizeSleeperPlayerIds(["0", "bad id", ""])).toEqual([]);
  });
});
