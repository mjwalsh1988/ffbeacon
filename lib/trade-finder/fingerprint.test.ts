import { describe, it, expect } from "vitest";
import { isValidSuggestionKey, suggestionKey } from "./fingerprint";
import type { SuggestionAsset } from "./types";

const p = (id: string): SuggestionAsset => ({
  kind: "player",
  playerId: id,
  sleeperId: null,
  name: id,
  position: "WR",
  team: null,
  value: 1000,
  age: 25,
  projPoints: 10,
});

const pick = (key: string): SuggestionAsset => ({
  kind: "pick",
  key,
  label: key,
  season: 2027,
  round: 1,
  value: 3000,
});

describe("suggestionKey", () => {
  it("is stable across asset order, because order is not part of the deal", () => {
    const a = suggestionKey({
      counterpartyRosterId: 3,
      incoming: [p("x")],
      outgoing: [p("a"), p("b")],
    });
    const b = suggestionKey({
      counterpartyRosterId: 3,
      incoming: [p("x")],
      outgoing: [p("b"), p("a")],
    });
    expect(a).toBe(b);
  });

  it("ignores value, so a price move cannot resurrect a passed trade", () => {
    const cheap = { ...p("x"), value: 1000 };
    const dear = { ...p("x"), value: 9000 };
    expect(
      suggestionKey({ counterpartyRosterId: 1, incoming: [cheap], outgoing: [p("a")] }),
    ).toBe(
      suggestionKey({ counterpartyRosterId: 1, incoming: [dear], outgoing: [p("a")] }),
    );
  });

  it("separates the same players traded with a different team", () => {
    expect(
      suggestionKey({ counterpartyRosterId: 1, incoming: [p("x")], outgoing: [p("a")] }),
    ).not.toBe(
      suggestionKey({ counterpartyRosterId: 2, incoming: [p("x")], outgoing: [p("a")] }),
    );
  });

  it("separates two packages that share a player", () => {
    // Passing on "my A for their X" must not silence "my A and B for their X".
    expect(
      suggestionKey({ counterpartyRosterId: 1, incoming: [p("x")], outgoing: [p("a")] }),
    ).not.toBe(
      suggestionKey({
        counterpartyRosterId: 1,
        incoming: [p("x")],
        outgoing: [p("a"), p("b")],
      }),
    );
  });

  it("separates a player from a pick, and one pick from another", () => {
    expect(
      suggestionKey({ counterpartyRosterId: 1, incoming: [p("x")], outgoing: [pick("pick:2027:1:4")] }),
    ).not.toBe(
      suggestionKey({ counterpartyRosterId: 1, incoming: [p("x")], outgoing: [pick("pick:2028:1:4")] }),
    );
  });

  it("swapping the two sides is a different deal", () => {
    expect(
      suggestionKey({ counterpartyRosterId: 1, incoming: [p("x")], outgoing: [p("a")] }),
    ).not.toBe(
      suggestionKey({ counterpartyRosterId: 1, incoming: [p("a")], outgoing: [p("x")] }),
    );
  });
});

describe("isValidSuggestionKey", () => {
  it("accepts what the generator produces", () => {
    const key = suggestionKey({
      counterpartyRosterId: 12,
      incoming: [p("x"), p("y")],
      outgoing: [p("a")],
    });
    expect(isValidSuggestionKey(key)).toBe(true);
  });

  it("rejects anything that is not one, including the shapes an attacker would try", () => {
    for (const bad of [
      "",
      "tf1",
      "nope",
      null,
      undefined,
      42,
      "tf1-1-1x1-ZZZZZZZZ",
      "tf1-1-1x1-deadbeef' or 1=1",
      `tf1-1-1x1-deadbeef${"x".repeat(500)}`,
    ]) {
      expect(isValidSuggestionKey(bad)).toBe(false);
    }
  });
});
