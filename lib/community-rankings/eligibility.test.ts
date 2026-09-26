import { describe, expect, it } from "vitest";
import {
  countedBoards,
  eligibleBoardsByFormat,
  isFormatPublished,
  type RawCommunityBoard,
} from "./eligibility";

const SETTINGS = { minPlayersMulti: 50, minPlayersSingle: 12 };

function board(over: Partial<RawCommunityBoard>): RawCommunityBoard {
  return {
    id: "b1",
    userId: "u1",
    scope: "overall",
    includesDefenders: false,
    formatConfigId: "f1",
    optOut: false,
    updatedAt: "2026-09-01T00:00:00Z",
    playerCount: 60,
    ...over,
  };
}

describe("countedBoards", () => {
  it("drops opted-out boards and boards with no format", () => {
    const out = countedBoards(
      [board({ id: "a", optOut: true }), board({ id: "b", formatConfigId: null, userId: "u2" })],
      SETTINGS,
    );
    expect(out).toEqual([]);
  });

  it("applies the multi and single position minimums", () => {
    const out = countedBoards(
      [
        board({ id: "o49", playerCount: 49 }),
        board({ id: "d50", scope: "defense", playerCount: 50 }),
        board({ id: "q11", scope: "QB", playerCount: 11 }),
        board({ id: "r12", scope: "RB", playerCount: 12 }),
        board({ id: "x", scope: "nonsense", playerCount: 500 }),
      ],
      SETTINGS,
    );
    expect(out.map((b) => b.id).sort()).toEqual(["d50", "r12"]);
  });

  it("counts one board per account, format and scope: the most recently updated", () => {
    const out = countedBoards(
      [
        board({ id: "old", updatedAt: "2026-09-01T00:00:00Z" }),
        board({ id: "new", updatedAt: "2026-09-20T00:00:00Z", includesDefenders: true }),
        board({ id: "mid", updatedAt: "2026-09-10T00:00:00Z" }),
        board({ id: "other-format", formatConfigId: "f2" }),
        board({ id: "other-user", userId: "u2" }),
      ],
      SETTINGS,
    );
    expect(out.map((b) => b.id).sort()).toEqual(["new", "other-format", "other-user"]);
  });

  it("does not let an ineligible newer copy knock out an eligible older one", () => {
    const out = countedBoards(
      [
        board({ id: "full", updatedAt: "2026-09-01T00:00:00Z" }),
        board({ id: "stub", updatedAt: "2026-09-20T00:00:00Z", playerCount: 5 }),
      ],
      SETTINGS,
    );
    expect(out.map((b) => b.id)).toEqual(["full"]);
  });
});

describe("eligibleBoardsByFormat", () => {
  it("returns per-format eligible counts", () => {
    const { boards, countsByFormat } = eligibleBoardsByFormat(
      [
        board({ id: "a" }),
        board({ id: "b", userId: "u2" }),
        board({ id: "c", userId: "u3", formatConfigId: "f2", scope: "TE", playerCount: 20 }),
        board({ id: "d", userId: "u3", formatConfigId: "f2", optOut: true }),
      ],
      SETTINGS,
    );
    expect(boards).toHaveLength(3);
    expect(countsByFormat.get("f1")).toBe(2);
    expect(countsByFormat.get("f2")).toBe(1);
  });

  it("counts distinct accounts apart from boards", () => {
    const { countsByFormat, accountsByFormat } = eligibleBoardsByFormat(
      [
        board({ id: "a" }),
        board({ id: "b", scope: "QB", playerCount: 20 }),
        board({ id: "c", scope: "RB", playerCount: 20 }),
        board({ id: "d", userId: "u2" }),
      ],
      SETTINGS,
    );
    expect(countsByFormat.get("f1")).toBe(4);
    expect(accountsByFormat.get("f1")).toBe(2);
  });
});

describe("isFormatPublished", () => {
  it("publishes on accounts, so one person's many boards do not reach the threshold", () => {
    expect(isFormatPublished(1, 5)).toBe(false);
    expect(isFormatPublished(4, 5)).toBe(false);
    expect(isFormatPublished(5, 5)).toBe(true);
  });
});
