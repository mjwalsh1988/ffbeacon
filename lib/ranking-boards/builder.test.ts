import { describe, expect, it } from "vitest";
import {
  foldRun,
  initialState,
  parseAnswer,
  parseAnswerLog,
  provisionalBoard,
  boardForFlush,
  runProgress,
  validateAnswer,
  type Answer,
  type RunSetup,
} from "./builder";

function setup(partial: Partial<RunSetup> = {}): RunSetup {
  return {
    seed: ["a", "b", "c", "d", "e", "f", "g", "h"],
    secondPass: [],
    initialBoard: [],
    startRank: 1,
    depth: 8,
    winsBeforePrompt: 3,
    cap: null,
    initialBreaks: [],
    ...partial,
  };
}

const keep: Answer = { a: "keep" };
const prefer: Answer = { a: "prefer" };

describe("the first question", () => {
  it("is seed players 1 and 2, and the winner is rank 1", () => {
    const s = initialState(setup());
    expect(s.board).toEqual(["a"]);
    expect(s.current?.playerId).toBe("b");
    expect(s.opponent).toBe("a");

    const kept = foldRun(setup(), [keep]).state;
    expect(kept.board.slice(0, 2)).toEqual(["a", "b"]);

    const flipped = foldRun(setup(), [prefer]).state;
    expect(flipped.board.slice(0, 2)).toEqual(["b", "a"]);
    expect(flipped.event).toMatchObject({ kind: "placed", playerId: "b", rank: 1, how: "top" });
  });
});

describe("insertion", () => {
  it("a reader who agrees answers one question per player", () => {
    const answers = Array.from({ length: 7 }, () => keep);
    const { state, error } = foldRun(setup(), answers);
    expect(error).toBeNull();
    expect(state.phase).toBe("done");
    expect(state.board).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(state.answered).toBe(7);
  });

  it("a newcomer climbs until the reader keeps the player above him", () => {
    // a b c placed in order, then d beats c and b, loses to a: a d b c.
    const answers: Answer[] = [keep, keep, prefer, prefer, keep];
    const { state } = foldRun(setup(), answers);
    expect(state.board.slice(0, 4)).toEqual(["a", "d", "b", "c"]);
    expect(state.current?.playerId).toBe("e");
    expect(state.opponent).toBe("c");
  });

  it("skip leaves him below the player he was asked about", () => {
    const { state } = foldRun(setup(), [keep, keep, prefer, { a: "skip" }]);
    expect(state.board.slice(0, 4)).toEqual(["a", "b", "d", "c"]);
  });

  it("leave off removes him, records it, and pulls the next seed so depth still fills", () => {
    const { state } = foldRun(setup({ depth: 3 }), [keep, { a: "leave" }, keep]);
    expect(state.leftOff).toEqual(["c"]);
    expect(state.board).toEqual(["a", "b", "d"]);
    expect(state.phase).toBe("done");
  });
});

describe("the three-win prompt", () => {
  const five = setup({ seed: ["a", "b", "c", "d", "e", "f"], depth: 6 });
  // Place a..e in order, then f climbs.
  const base: Answer[] = [keep, keep, keep, keep];

  it("appears after three straight wins", () => {
    const { state } = foldRun(five, [...base, prefer, prefer, prefer]);
    expect(state.phase).toBe("prompt");
    expect(state.current).toMatchObject({ playerId: "f", pos: 2, streak: 3 });
    expect(state.event).toMatchObject({ kind: "prompt", streak: 3 });
  });

  it("place at a rank puts him there and moves everyone down", () => {
    const { state } = foldRun(five, [...base, prefer, prefer, prefer, { a: "place", rank: 1 }]);
    expect(state.board).toEqual(["f", "a", "b", "c", "d", "e"]);
    expect(state.phase).toBe("done");
  });

  it("refuses a rank that is not above his current spot", () => {
    const { error } = foldRun(five, [...base, prefer, prefer, prefer, { a: "place", rank: 3 }]);
    expect(error?.reason).toMatch(/not above/);
  });

  it("keep comparing is offered again after each further run of wins", () => {
    const seed = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const s = setup({ seed, depth: 10 });
    const placeNine = Array.from({ length: 8 }, () => keep);
    const three = [prefer, prefer, prefer];
    const afterFirst = foldRun(s, [...placeNine, ...three]).state;
    expect(afterFirst.phase).toBe("prompt");
    const continued = foldRun(s, [...placeNine, ...three, { a: "continue" }, prefer, prefer]).state;
    expect(continued.phase).toBe("compare");
    const again = foldRun(s, [...placeNine, ...three, { a: "continue" }, ...three]).state;
    expect(again.phase).toBe("prompt");
    expect(again.current?.streak).toBe(6);
  });

  it("a newcomer who beats rank 1 is placed first without a prompt", () => {
    const s = setup({ seed: ["a", "b", "c", "d"], depth: 4 });
    const { state } = foldRun(s, [keep, keep, prefer, prefer, prefer]);
    expect(state.board).toEqual(["d", "a", "b", "c"]);
    expect(state.phase).toBe("done");
  });

  it("put him at is available on any question", () => {
    const { state } = foldRun(setup(), [keep, keep, { a: "place", rank: 1 }]);
    expect(state.board.slice(0, 4)).toEqual(["d", "a", "b", "c"]);
  });

  it("only rank choices and keep comparing are accepted while it is open", () => {
    const { error } = foldRun(five, [...base, prefer, prefer, prefer, keep]);
    expect(error?.reason).toMatch(/Choose a rank/);
  });
});

describe("depth, keep going and the guest cap", () => {
  it("stops pulling seeds at the depth, and keep going adds more", () => {
    const s = setup({ depth: 3 });
    const done = foldRun(s, [keep, keep]).state;
    expect(done.phase).toBe("done");
    expect(done.board).toEqual(["a", "b", "c"]);
    const more = foldRun(s, [keep, keep, { a: "extend", by: 2 }]).state;
    expect(more.phase).toBe("compare");
    expect(more.depth).toBe(5);
    expect(more.current?.playerId).toBe("d");
  });

  it("a guest stops at the cap, and cannot extend past it", () => {
    const s = setup({ depth: 3, cap: 3 });
    const done = foldRun(s, [keep, keep]).state;
    expect(done.phase).toBe("done");
    expect(done.capReached).toBe(true);
    const refused = foldRun(s, [keep, keep, { a: "extend", by: 5 }]);
    expect(refused.error?.reason).toMatch(/guest limit/);
  });

  it("ends when the seed runs out, whatever the depth", () => {
    const s = setup({ seed: ["a", "b"], depth: 100 });
    expect(foldRun(s, [keep]).state.phase).toBe("done");
  });
});

describe("defenders as a second pass", () => {
  it("enter after the offensive run, at the bottom, and climb", () => {
    const s = setup({ seed: ["a", "b", "c"], depth: 3, secondPass: ["lb1", "lb2"] });
    const afterOffense = foldRun(s, [keep, keep]).state;
    expect(afterOffense.current?.playerId).toBe("lb1");
    expect(afterOffense.opponent).toBe("c");
    const { state } = foldRun(s, [keep, keep, prefer, keep, keep]);
    expect(state.board).toEqual(["a", "b", "lb1", "c", "lb2"]);
    expect(state.phase).toBe("done");
  });
});

describe("running on an existing board", () => {
  it("start from the top re-checks every player, then brings in new seeds", () => {
    const s = setup({
      initialBoard: ["x", "y", "z"],
      seed: ["y", "a", "x", "b"],
      depth: 5,
    });
    const first = initialState(s);
    expect(first.board).toEqual(["x"]);
    expect(first.current?.playerId).toBe("y");
    const { state } = foldRun(s, [keep, keep, keep, keep]);
    // Seeds already on the board are not asked about twice.
    expect(state.board).toEqual(["x", "y", "z", "a", "b"]);
    expect(state.phase).toBe("done");
  });

  it("start from rank N keeps the ranks above N, and a re-checked player can still climb past N", () => {
    const s = setup({
      initialBoard: ["x", "y", "z", "w"],
      seed: [],
      startRank: 3,
      depth: 4,
    });
    const first = initialState(s);
    expect(first.board).toEqual(["x", "y"]);
    expect(first.current?.playerId).toBe("z");
    const { state } = foldRun(s, [prefer, prefer]);
    expect(state.board.slice(0, 3)).toEqual(["z", "x", "y"]);
  });
});

describe("the tier pass", () => {
  it("asks one gap at a time and draws a line on yes", () => {
    const s = setup({ seed: ["a", "b", "c", "d"], depth: 4 });
    const done = [keep, keep, keep];
    const started = foldRun(s, [...done, { a: "tiers" }]).state;
    expect(started.phase).toBe("tiers");
    expect(started.tierPass.gap).toBe(1);
    const { state } = foldRun(s, [
      ...done,
      { a: "tiers" },
      { a: "tier", yes: false },
      { a: "tier", yes: true },
      { a: "tier", yes: false },
    ]);
    expect(state.tierPass.breaks).toEqual([2]);
    expect(state.phase).toBe("finished");
  });

  it("skips gaps that already carry a line, and can end early", () => {
    const s = setup({ seed: ["a", "b", "c", "d"], depth: 4, initialBreaks: [1] });
    const started = foldRun(s, [keep, keep, keep, { a: "tiers" }]).state;
    expect(started.tierPass).toEqual({ gap: 2, breaks: [1] });
    const ended = foldRun(s, [keep, keep, keep, { a: "tiers" }, { a: "tiers_done" }]).state;
    expect(ended.phase).toBe("finished");
    expect(ended.tierPass.breaks).toEqual([1]);
  });
});

describe("undo, resume and validation", () => {
  it("undo is the log minus its last answer", () => {
    const log: Answer[] = [keep, prefer, keep];
    const undone = foldRun(setup(), log.slice(0, -1)).state;
    expect(undone).toEqual(foldRun(setup(), [keep, prefer]).state);
  });

  it("refuses an answer about a pair that is no longer on screen", () => {
    const s = setup();
    const ok = validateAnswer(s, [], keep, ["b", "a"]);
    expect(ok.ok).toBe(true);
    const stale = validateAnswer(s, [keep], keep, ["b", "a"]);
    expect(stale.ok).toBe(false);
  });

  it("refuses an answer that does not apply", () => {
    const s = setup({ depth: 2 });
    const r = validateAnswer(s, [keep], keep, null);
    expect(r.ok).toBe(false);
  });

  it("parses only well-formed answers, and a stored log stops at the first bad one", () => {
    expect(parseAnswer({ a: "place", rank: 3 })).toEqual({ a: "place", rank: 3 });
    expect(parseAnswer({ a: "place", rank: "3" })).toBeNull();
    expect(parseAnswer({ a: "drop table" })).toBeNull();
    expect(parseAnswerLog([{ a: "keep" }, { a: "nope" }, { a: "keep" }])).toEqual([keep]);
  });
});

describe("the provisional board and progress", () => {
  it("draws the climbing newcomer at his current spot", () => {
    const state = foldRun(setup(), [keep, keep, prefer]).state;
    expect(provisionalBoard(state).slice(0, 4)).toEqual(["a", "b", "d", "c"]);
  });

  it("a checkpoint keeps original players the run has not reached yet", () => {
    const s = setup({ initialBoard: ["x", "y", "z", "w"], seed: [], depth: 4 });
    const state = foldRun(s, [prefer]).state;
    expect(state.board).toEqual(["y", "x"]);
    expect(state.pendingRecheck).toEqual(["w"]);
    expect(boardForFlush(state)).toEqual(["y", "x", "z", "w"]);
  });

  it("counts placed players over the planned total", () => {
    const s = setup({ depth: 8 });
    const state = foldRun(s, [keep, keep]).state;
    expect(runProgress(s, state)).toEqual({ placed: 3, total: 8 });
  });
});
