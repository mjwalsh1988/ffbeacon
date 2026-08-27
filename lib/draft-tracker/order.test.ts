import { describe, expect, it } from "vitest";
import {
  buildSortName,
  clampTeamCount,
  describeBoard,
  describeDraftSlot,
  draftSlotLabel,
  filterBoard,
  isDraftOrder,
  isTrackingMode,
  isUuid,
  normalizeTeamNames,
  orderHelp,
  orderLabel,
  orderPhrase,
  parseTeamNames,
  searchKey,
  sortBoard,
  teamLabel,
} from "./order";
import type { TrackerPlayer } from "./types";

function player(over: Partial<TrackerPlayer> & { name: string }): TrackerPlayer {
  const [first, ...rest] = over.name.split(" ");
  return {
    playerId: over.playerId ?? over.name,
    sleeperId: over.sleeperId ?? null,
    name: over.name,
    sortName: over.sortName ?? buildSortName(first, rest.join(" "), over.name),
    position: over.position ?? "WR",
    team: over.team ?? "BUF",
    overallRank: over.overallRank ?? 1,
    positionRank: over.positionRank ?? 1,
    tier: over.tier ?? 1,
    value: over.value ?? null,
    adp: over.adp ?? null,
  };
}

describe("guards", () => {
  it("accepts only the three orderings", () => {
    expect(isDraftOrder("value")).toBe(true);
    expect(isDraftOrder("adp")).toBe(true);
    expect(isDraftOrder("alphabetical")).toBe(true);
    expect(isDraftOrder("overall")).toBe(false);
    expect(isDraftOrder(null)).toBe(false);
  });

  it("accepts only the two tracking modes", () => {
    expect(isTrackingMode("mine")).toBe(true);
    expect(isTrackingMode("all")).toBe(true);
    expect(isTrackingMode("everyone")).toBe(false);
  });

  it("recognises a uuid and nothing else", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isUuid("11111111-1111-1111-1111-11111111111")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("sortBoard", () => {
  const board = [
    player({ name: "Alpha One", value: 3000, adp: 40, overallRank: 3 }),
    player({ name: "Bravo Two", value: 9000, adp: 2, overallRank: 1 }),
    player({ name: "Charlie Three", value: null, adp: null, overallRank: 2 }),
  ];

  it("puts the highest value first and sinks players with no value", () => {
    const out = sortBoard(board, "value").map((p) => p.name);
    expect(out).toEqual(["Bravo Two", "Alpha One", "Charlie Three"]);
  });

  it("puts the earliest ADP first and sinks players with no ADP", () => {
    const out = sortBoard(board, "adp").map((p) => p.name);
    expect(out).toEqual(["Bravo Two", "Alpha One", "Charlie Three"]);
  });

  it("orders A to Z by last name", () => {
    const out = sortBoard(
      [
        player({ name: "Zack Adams" }),
        player({ name: "Aaron Zimmer" }),
        player({ name: "Mike Adams" }),
      ],
      "alphabetical",
    ).map((p) => p.name);
    expect(out).toEqual(["Mike Adams", "Zack Adams", "Aaron Zimmer"]);
  });

  it("does not mutate the input", () => {
    const input = board.slice();
    sortBoard(input, "value");
    expect(input.map((p) => p.name)).toEqual(board.map((p) => p.name));
  });

  it("breaks ties on overall rank so the order never wobbles", () => {
    const tied = [
      player({ name: "Later Rank", value: 100, overallRank: 9 }),
      player({ name: "Earlier Rank", value: 100, overallRank: 4 }),
    ];
    expect(sortBoard(tied, "value").map((p) => p.name)).toEqual([
      "Earlier Rank",
      "Later Rank",
    ]);
  });

  it("orders names by codepoint, not by locale", () => {
    // The table server-renders and then hydrates. localeCompare can disagree
    // between Node's default locale and the browser's, which would hand React a
    // hydration mismatch across every row.
    const names = ["zeta", "Alpha", "alpha", "Zeta"];
    const sorted = sortBoard(
      names.map((n, i) => player({ name: n, sortName: n, overallRank: i })),
      "alphabetical",
    ).map((p) => p.sortName);
    expect(sorted).toEqual([...names].sort());
  });
});

describe("filterBoard", () => {
  const board = [
    player({ name: "Josh Allen", position: "QB", team: "BUF" }),
    player({ name: "Ja'Marr Chase", position: "WR", team: "CIN" }),
    player({ name: "Bijan Robinson", position: "RB", team: "ATL" }),
  ];

  it("returns the same array when nothing is filtering", () => {
    expect(filterBoard(board, {})).toBe(board);
  });

  it("matches on name regardless of punctuation or case", () => {
    expect(filterBoard(board, { search: "jamarr" }).map((p) => p.name)).toEqual([
      "Ja'Marr Chase",
    ]);
    expect(filterBoard(board, { search: "JA'MARR" }).map((p) => p.name)).toEqual([
      "Ja'Marr Chase",
    ]);
  });

  it("matches on team code", () => {
    expect(filterBoard(board, { search: "atl" }).map((p) => p.name)).toEqual([
      "Bijan Robinson",
    ]);
  });

  it("combines position and text", () => {
    expect(filterBoard(board, { search: "o", position: "QB" }).map((p) => p.name)).toEqual([
      "Josh Allen",
    ]);
  });

  it("strips accents so a plain keyboard finds the player", () => {
    expect(searchKey("Amon-Ra")).toBe("amonra");
    // Written as an escape so this file stays plain ASCII on disk.
    expect(searchKey("Jos\u00e9 Ramirez")).toBe("jose ramirez");
  });
});

describe("team labels", () => {
  it("falls back to a numbered label when a slot is unnamed", () => {
    expect(teamLabel(["Mike", "  ", ""], 0)).toBe("Mike");
    expect(teamLabel(["Mike", "  ", ""], 1)).toBe("Team 2");
    expect(teamLabel([], 5)).toBe("Team 6");
  });

  it("survives a team_names value that is not an array of strings", () => {
    expect(parseTeamNames(null)).toEqual([]);
    expect(parseTeamNames({ a: 1 })).toEqual([]);
    expect(parseTeamNames(["ok", 7, null])).toEqual(["ok", "", ""]);
  });

  it("pads and truncates submitted names to the team count", () => {
    expect(normalizeTeamNames(["  Mike  ", "Sarah", "Extra"], 2)).toEqual(["Mike", "Sarah"]);
    expect(normalizeTeamNames(["Mike"], 3)).toEqual(["Mike", "", ""]);
  });

  it("caps a very long name rather than rejecting it", () => {
    const long = "x".repeat(200);
    expect(normalizeTeamNames([long], 1)[0]).toHaveLength(40);
  });

  it("does not walk an oversized array before truncating it", () => {
    const huge = Array.from({ length: 50_000 }, (_, i) => String(i));
    expect(normalizeTeamNames(huge, 3)).toEqual(["0", "1", "2"]);
  });
});

describe("clampTeamCount", () => {
  it("keeps a sensible number and clamps the rest", () => {
    expect(clampTeamCount("12")).toBe(12);
    expect(clampTeamCount(1)).toBe(2);
    expect(clampTeamCount(99)).toBe(32);
    expect(clampTeamCount("not a number")).toBe(12);
    expect(clampTeamCount(10.7)).toBe(10);
  });
});

describe("copy", () => {
  it("names the source in the value ordering so a KTC reader is not told it is ours", () => {
    expect(orderLabel("value", "KTC")).toBe("Player value (KTC)");
    expect(orderHelp("value", "KTC")).toBe("Best player first, by KTC value.");
    expect(orderLabel("adp", "KTC")).toBe("Sleeper ADP");
  });

  it("has a sentence form so a source name never has to be lowercased", () => {
    expect(orderPhrase("value", "KeepTradeCut")).toBe("player value from KeepTradeCut");
    expect(orderPhrase("adp", "KeepTradeCut")).toBe("Sleeper ADP");
    expect(orderPhrase("alphabetical", "KeepTradeCut")).toBe("name, A to Z");
  });

  it("says how many are left, and how many matched when a filter is on", () => {
    expect(describeBoard(120, 120, 120, "ALL")).toBe("120 players still available.");
    expect(describeBoard(1, 1, 1, "ALL")).toBe("1 player still available.");
    expect(describeBoard(9, 9, 120, "RB")).toBe(
      "9 of 120 available players at RB match.",
    );
  });

  it("changes when Show more changes only the visible count", () => {
    // A sentence built from the match count alone would be byte-identical
    // between the two, React would skip the DOM write, and pressing Show more
    // would announce nothing at all.
    const first = describeBoard(25, 812, 812, "ALL");
    const second = describeBoard(50, 812, 812, "ALL");
    expect(first).not.toBe(second);
    expect(first).toContain("787 still to come");
    expect(second).toContain("762 still to come");
  });

  it("adds nothing when everything matching is already on screen", () => {
    expect(describeBoard(9, 9, 120, "RB")).not.toContain("still to come");
    expect(describeBoard(40, 40, 812, "ALL")).toBe("40 of 812 available players match.");
  });

  it("handles a search that matches nothing", () => {
    expect(describeBoard(0, 0, 812, "ALL")).toBe("0 of 812 available players match.");
  });
});

describe("draft slots", () => {
  it("reads the way people say it, padded to two digits", () => {
    expect(draftSlotLabel(1, 12)).toBe("1.01");
    expect(draftSlotLabel(5, 12)).toBe("1.05");
    expect(draftSlotLabel(12, 12)).toBe("1.12");
    expect(draftSlotLabel(13, 12)).toBe("2.01");
    expect(draftSlotLabel(47, 12)).toBe("4.11");
  });

  it("follows the room size rather than assuming twelve", () => {
    expect(draftSlotLabel(11, 10)).toBe("2.01");
    expect(draftSlotLabel(9, 8)).toBe("2.01");
    expect(draftSlotLabel(33, 32)).toBe("2.01");
  });

  it("says it out loud without the decimal", () => {
    expect(describeDraftSlot(1, 12)).toBe("Round 1, pick 1");
    expect(describeDraftSlot(13, 12)).toBe("Round 2, pick 1");
    expect(describeDraftSlot(47, 12)).toBe("Round 4, pick 11");
  });

  it("does not divide by a team count that is missing or nonsense", () => {
    expect(draftSlotLabel(3, 0)).toBe("3.01");
    expect(draftSlotLabel(3, Number.NaN)).toBe("3.01");
    expect(draftSlotLabel(0, 12)).toBe("1.01");
  });
});

describe("buildSortName", () => {
  it("puts the last name first", () => {
    expect(buildSortName("Josh", "Allen", "Josh Allen")).toBe("allen josh");
  });

  it("falls back to the full name for a one-name entry such as a defense", () => {
    expect(buildSortName(null, null, "Buffalo Bills")).toBe("buffalo bills");
  });
});
