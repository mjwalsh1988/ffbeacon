import { describe, expect, it } from "vitest";
import {
  buildKtcPlayerIndex,
  buildKtcPlayerPatch,
  collectKtcPlayerUpdate,
  type KtcMatchPlayer,
  type PendingKtcUpdate,
} from "./ktc-player-match";

function row(p: Partial<KtcMatchPlayer> & { id: string }): KtcMatchPlayer {
  return { external_ids: {}, first_name: "A", last_name: "B", position: "RB", team: null, ...p };
}

// The two production rows behind "ktc id collision: another player already owns ktc=1570".
const goreSr = row({ id: "sr", first_name: "Frank", last_name: "Gore", external_ids: { sleeper: "232", ktc: "1570" } });
const goreJr = row({ id: "jr", first_name: "Frank", last_name: "Gore", team: "BUF", external_ids: { sleeper: "11573" } });
const goreJrKtc = { playerID: 1570, playerName: "Frank Gore Jr.", team: "BUF" };

describe("buildKtcPlayerIndex", () => {
  it("matches a unique name and position", () => {
    const idx = buildKtcPlayerIndex([goreJr]);
    expect(idx.resolve(goreJrKtc, "RB")).toEqual({ kind: "matched", playerId: "jr" });
  });

  it("does not let a retired namesake that was wrongly stamped with the id win (Frank Gore)", () => {
    // Either load order: the old Map let whichever row loaded last win.
    expect(buildKtcPlayerIndex([goreJr, goreSr]).resolve(goreJrKtc, "RB")).toEqual({ kind: "matched", playerId: "jr" });
    expect(buildKtcPlayerIndex([goreSr, goreJr]).resolve(goreJrKtc, "RB")).toEqual({ kind: "matched", playerId: "jr" });
  });

  it("reads KTC's three-letter team codes against Sleeper's (Kyle Williams, NEP)", () => {
    const old = row({ id: "old", first_name: "Kyle", last_name: "Williams", position: "WR", external_ids: { ktc: "1812" } });
    const mid = row({ id: "mid", first_name: "Kyle", last_name: "Williams", position: "WR", team: "DAL" });
    const rookie = row({ id: "new", first_name: "Kyle", last_name: "Williams", position: "WR", team: "NE" });
    const idx = buildKtcPlayerIndex([old, mid, rookie]);
    expect(idx.resolve({ playerID: 1812, playerName: "Kyle Williams", team: "NEP" }, "WR")).toEqual({
      kind: "matched",
      playerId: "new",
    });
  });

  it("falls back to the stored id when nothing else separates the rows", () => {
    const a = row({ id: "a", external_ids: { ktc: "9" } });
    const b = row({ id: "b" });
    expect(buildKtcPlayerIndex([a, b]).resolve({ playerID: 9, playerName: "A B", team: null }, "RB")).toEqual({
      kind: "matched",
      playerId: "a",
    });
  });

  it("reports an ambiguous name instead of guessing", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b" });
    expect(buildKtcPlayerIndex([a, b]).resolve({ playerID: 9, playerName: "A B", team: null }, "RB").kind).toBe(
      "ambiguous",
    );
  });

  it("does not match across positions", () => {
    expect(buildKtcPlayerIndex([goreJr]).resolve(goreJrKtc, "WR")).toEqual({ kind: "unmatched" });
  });
});

describe("collectKtcPlayerUpdate + buildKtcPlayerPatch", () => {
  type Raw = { playerID: number; tag: string };
  type Row = { external_ids: Record<string, unknown>; source_synced_at: Record<string, unknown>; metadata: Record<string, unknown> };

  // The pre-change loop: re-read the row, write it, once per target in order.
  function oldLastWins(start: Row, perTarget: Raw[], now: string): Row {
    let current = start;
    for (const raw of perTarget) {
      current = buildKtcPlayerPatch(current, { ktcId: String(raw.playerID), raw }, now);
    }
    return current;
  }

  it("writes once per player and leaves exactly what the per-target loop left", () => {
    const now = "2026-09-25T12:00:00.000Z";
    const targets: Raw[][] = [
      [{ playerID: 1, tag: "1qb" }, { playerID: 2, tag: "1qb" }],
      [{ playerID: 1, tag: "sf" }, { playerID: 2, tag: "sf" }],
      [{ playerID: 2, tag: "sf-again" }],
    ];
    const starts: Record<string, Row> = {
      p1: { external_ids: { sleeper: "10" }, source_synced_at: { sleeper: "x" }, metadata: { sleeper: { a: 1 } } },
      p2: { external_ids: { sleeper: "20", ktc: "2" }, source_synced_at: {}, metadata: { ktc: { stale: true } } },
    };
    const idOf = (raw: Raw) => (raw.playerID === 1 ? "p1" : "p2");

    const pending = new Map<string, PendingKtcUpdate<Raw>>();
    for (const target of targets) for (const raw of target) collectKtcPlayerUpdate(pending, idOf(raw), raw);
    expect(pending.size).toBe(2);

    for (const id of ["p1", "p2"]) {
      const perTarget = targets.flat().filter((r) => idOf(r) === id);
      const expected = oldLastWins(starts[id], perTarget, now);
      expect(buildKtcPlayerPatch(starts[id], pending.get(id)!, now)).toEqual(expected);
    }
    expect(buildKtcPlayerPatch(starts.p2, pending.get("p2")!, now).metadata.ktc).toEqual({ playerID: 2, tag: "sf-again" });
    expect(buildKtcPlayerPatch(starts.p1, pending.get("p1")!, now).external_ids).toEqual({ sleeper: "10", ktc: "1" });
  });
});
