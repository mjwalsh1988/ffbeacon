import { describe, it, expect } from "vitest";
import {
  RUN_GAP_MS,
  groupIntoRuns,
  runDigestKey,
  runIsDigest,
  type RunnableMove,
} from "./waiver-run";

const BASE = Date.parse("2026-09-02T08:00:00Z");

function move(
  id: string,
  offsetMs: number,
  type: "waiver" | "free_agent" = "waiver",
  week: number | null = 1,
): RunnableMove {
  return {
    sleeperTransactionId: id,
    type,
    createdAtSleeper: new Date(BASE + offsetMs).toISOString(),
    week,
  };
}

describe("groupIntoRuns", () => {
  it("puts one Sleeper waiver run into one group", () => {
    // A real run writes every claim within a second or two of the others.
    const runs = groupIntoRuns([move("a", 0), move("b", 900), move("c", 1800)]);
    expect(runs).toHaveLength(1);
    expect(runs[0].moves.map((m) => m.sleeperTransactionId)).toEqual(["a", "b", "c"]);
  });

  it("splits on a real gap in the timeline", () => {
    const runs = groupIntoRuns([move("a", 0), move("b", RUN_GAP_MS + 60_000)]);
    expect(runs).toHaveLength(2);
  });

  it("never mixes waivers and free agent moves", () => {
    // A waiver run happened to everybody at once. A free agent pickup is one
    // person clicking a button, and a digest titled "waivers processed" over a
    // list that is half lunchtime browsing would be wrong.
    const runs = groupIntoRuns([move("a", 0, "waiver"), move("b", 500, "free_agent")]);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.type).sort()).toEqual(["free_agent", "waiver"]);
  });

  it("sorts within a run oldest first, whatever order it was handed", () => {
    const runs = groupIntoRuns([move("c", 1800), move("a", 0), move("b", 900)]);
    expect(runs[0].moves.map((m) => m.sleeperTransactionId)).toEqual(["a", "b", "c"]);
  });

  it("is deterministic, so a preview and the live tick agree", () => {
    const input = [move("c", 1800), move("a", 0), move("b", 900)];
    expect(JSON.stringify(groupIntoRuns(input))).toBe(
      JSON.stringify(groupIntoRuns([...input].reverse())),
    );
  });

  it("anchors a run on its earliest id, which cannot change under it", () => {
    // The anchor is the digest's ledger key. A hash of every id would change
    // when a late claim arrived, and the digest already sent would then look
    // unsent and go out a second time.
    const first = groupIntoRuns([move("a", 0), move("b", 900)]);
    const withLateArrival = groupIntoRuns([move("a", 0), move("b", 900), move("c", 1800)]);
    expect(withLateArrival[0].anchorId).toBe(first[0].anchorId);
  });

  it("gives an undated move a run of its own rather than guessing", () => {
    const undated: RunnableMove = {
      sleeperTransactionId: "x",
      type: "waiver",
      createdAtSleeper: null,
      week: 1,
    };
    const runs = groupIntoRuns([move("a", 0), undated]);
    expect(runs).toHaveLength(2);
    expect(runs.some((r) => r.moves.length === 1 && r.moves[0].sleeperTransactionId === "x")).toBe(
      true,
    );
  });

  it("takes the week from the first move that names one", () => {
    const runs = groupIntoRuns([move("a", 0, "waiver", null), move("b", 900, "waiver", 4)]);
    expect(runs[0].week).toBe(4);
  });

  it("leaves the week null when nothing in the run has one", () => {
    // Common in the preseason. Defaulting to 1 would file a July pickup under
    // week 1 of a season that has not started.
    const runs = groupIntoRuns([move("a", 0, "waiver", null)]);
    expect(runs[0].week).toBeNull();
  });

  it("returns nothing for an empty batch", () => {
    expect(groupIntoRuns([])).toEqual([]);
  });
});

describe("runIsDigest", () => {
  const run = (n: number) => groupIntoRuns(Array.from({ length: n }, (_, i) => move(`m${i}`, i * 100)))[0];

  it("keeps a run at the threshold as individual reviews", () => {
    expect(runIsDigest(run(3), 3)).toBe(false);
  });

  it("digests a run one move over the threshold", () => {
    expect(runIsDigest(run(4), 3)).toBe(true);
  });

  it("never digests a run of one, whatever the threshold says", () => {
    // A threshold of zero would otherwise turn every single claim into a
    // one-item digest, which is strictly worse than the review it replaced.
    expect(runIsDigest(run(1), 0)).toBe(false);
  });
});

describe("runDigestKey", () => {
  it("names the type, the league and the anchor", () => {
    const runs = groupIntoRuns([move("a", 0), move("b", 900)]);
    expect(runDigestKey("league-1", runs[0])).toBe("waiver-digest:league-1:a");
  });

  it("keeps waiver and free agent runs apart even on the same anchor id", () => {
    const w = groupIntoRuns([move("a", 0, "waiver")])[0];
    const f = groupIntoRuns([move("a", 0, "free_agent")])[0];
    expect(runDigestKey("league-1", w)).not.toBe(runDigestKey("league-1", f));
  });
});
