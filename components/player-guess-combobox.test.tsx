import { describe, expect, it } from "vitest";
import {
  MAX_OPTIONS,
  applySearchOutcome,
  comboboxKeyAction,
  firstSelectableIndex,
  type SearchPlayerResult,
} from "./player-guess-combobox";

const r = (id: string): SearchPlayerResult => ({ id, name: id, position: "WR", team: "KC", sleeperId: null });
const results = [r("a"), r("b"), r("c")];

describe("player guess combobox", () => {
  it("renders results after the injected search resolves, capped at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => r(`p${i}`));
    const next = applySearchOutcome({ results: [], phase: "loading" }, { ok: true, results: many });
    expect(next.phase).toBe("ok");
    expect(next.results).toHaveLength(MAX_OPTIONS);
  });

  it("skips a ruled-out option with the arrow keys", () => {
    const ruledOut = new Set(["b"]);
    expect(comboboxKeyAction("ArrowDown", { open: true, activeIdx: 0, results, ruledOut })).toEqual({
      type: "move",
      index: 2,
    });
    expect(comboboxKeyAction("ArrowUp", { open: true, activeIdx: 2, results, ruledOut })).toEqual({
      type: "move",
      index: 0,
    });
    expect(firstSelectableIndex(results, new Set(["a"]))).toBe(1);
  });

  it("commits on Enter only for an open, selectable option", () => {
    expect(comboboxKeyAction("Enter", { open: true, activeIdx: 1, results, ruledOut: new Set() })).toEqual({
      type: "commit",
      index: 1,
    });
    expect(comboboxKeyAction("Enter", { open: false, activeIdx: 1, results, ruledOut: new Set() }).type).toBe("none");
    expect(comboboxKeyAction("Enter", { open: true, activeIdx: 1, results, ruledOut: new Set(["b"]) }).type).toBe(
      "none",
    );
  });

  it("closes on Escape when open", () => {
    expect(comboboxKeyAction("Escape", { open: true, activeIdx: 0, results, ruledOut: new Set() }).type).toBe("close");
    expect(comboboxKeyAction("Escape", { open: false, activeIdx: 0, results, ruledOut: new Set() }).type).toBe("none");
  });

  it("keeps prior results on screen on a rate_limited answer", () => {
    const next = applySearchOutcome({ results, phase: "loading" }, { ok: false, code: "rate_limited" });
    expect(next).toEqual({ results, phase: "rate_limited" });
  });

  it("clears results on any other failure", () => {
    expect(applySearchOutcome({ results, phase: "loading" }, { ok: false, code: "server_error" })).toEqual({
      results: [],
      phase: "error",
    });
  });
});
