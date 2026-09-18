import { describe, it, expect } from "vitest";
import {
  BAND_LINES,
  BAND_PLAIN,
  EVEN_LINES,
  LOPSIDED_LINES,
  PREVIEW_CLOSERS,
  RECAP_CLOSERS,
  TRADE_OPENERS,
  Voice,
  bandFromRank,
  describeBand,
  listOf,
  ordinal,
  ppChange,
  pulseFieldSize,
  pulsePhrase,
  seedFrom,
  standingClause,
  tablePhrase,
} from "./voice";

/**
 * Two guarantees, and both of them are product requirements rather than
 * implementation details.
 *
 *   DETERMINISM. The same message must read the same way every time it is
 *   rendered, or the admin preview is not a preview, a retry after a Discord
 *   500 posts a differently-worded second version, and the ledger row does not
 *   match what went out.
 *
 *   THE SNARK DIAL IS A FILTER, NOT A WEIGHTING. A line hotter than the setting
 *   must be unreachable, not merely rarer. An admin who turns the dial down is
 *   promising a channel that nothing above that level will be said.
 */

describe("determinism", () => {
  it("gives the same line for the same seed, every time", () => {
    const a = new Voice("trade:abc:123", 0.8);
    const b = new Voice("trade:abc:123", 0.8);
    expect(a.pick(BAND_LINES.dire)).toBe(b.pick(BAND_LINES.dire));
  });

  it("gives different messages different lines, so a channel is not repetitive", () => {
    // Not a guarantee about any one pair, so this samples enough keys that
    // "they all said the same thing" would be a real failure.
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => new Voice(`trade:x:${i}`, 1).pick(BAND_LINES.dire)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("hashes distinct keys to distinct seeds", () => {
    expect(seedFrom("a")).not.toBe(seedFrom("b"));
    expect(seedFrom("trade:1")).toBe(seedFrom("trade:1"));
  });
});

describe("the snark dial", () => {
  it("never draws a line hotter than the setting, over many seeds", () => {
    const coolTexts = new Set(BAND_LINES.dire.filter((l) => l.heat <= 0.5).map((l) => l.text));
    for (let i = 0; i < 200; i += 1) {
      const line = new Voice(`k${i}`, 0.5).pick(BAND_LINES.dire);
      if (line !== null) expect(coolTexts.has(line)).toBe(true);
    }
  });

  it("returns null when the whole bank is hotter than the setting", () => {
    expect(new Voice("k", 0).pick([{ heat: 0.9, text: "brutal" }])).toBeNull();
  });

  it("falls back to the plain adjective rather than saying nothing", () => {
    // describeBand always produces a phrase: a writeup has to be able to
    // describe a team even at snark 0.
    expect(describeBand(new Voice("k", 0), "dire")).toBe(BAND_PLAIN.dire);
  });
});

describe("not repeating itself inside one message", () => {
  it("gives two teams different phrases when the bank has room", () => {
    // The bug this exists to stop: a preview whose two closing lines were the
    // same sentence, one under the other, because the two draws were
    // independent.
    const voice = new Voice("preview:x:1", 1);
    const first = voice.pick(BAND_LINES.dire);
    const second = voice.pick(BAND_LINES.dire);
    expect(first).not.toBe(second);
  });

  it("repeats rather than falling silent when the bank is exhausted", () => {
    const voice = new Voice("k", 1);
    const only = [{ heat: 0, text: "the only line" }];
    expect(voice.pick(only)).toBe("the only line");
    expect(voice.pick(only)).toBe("the only line");
  });
});

describe("bandFromRank", () => {
  it("puts the top of a twelve-team league in the top band", () => {
    expect(bandFromRank(1, 12)).toBe("elite");
  });

  it("puts the bottom in the bottom band", () => {
    expect(bandFromRank(12, 12)).toBe("dire");
  });

  it("puts the middle in the middle", () => {
    expect(bandFromRank(6, 12)).toBe("middle");
  });

  it("treats an unranked team as mid-table rather than as bad", () => {
    // Unranked means unknown. Calling an unknown team the worst in the league
    // would be an invented fact with a joke attached to it.
    expect(bandFromRank(null, 12)).toBe("middle");
  });

  it("does not divide by zero in a one-team league", () => {
    expect(bandFromRank(1, 1)).toBe("middle");
  });
});

describe("sentence helpers", () => {
  it("joins a list without an oxford comma", () => {
    expect(listOf(["a"])).toBe("a");
    expect(listOf(["a", "b"])).toBe("a and b");
    expect(listOf(["a", "b", "c"])).toBe("a, b and c");
  });

  it("says nothing rather than emitting an empty string", () => {
    expect(listOf([])).toBe("nothing");
  });

  it("gets the awkward ordinals right", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
  });

  it("reports a change under half a point as no change, not as a rounded zero", () => {
    expect(ppChange(0.5, 0.502)?.delta).toBe(0);
    expect(ppChange(0.5, 0.502)?.text).toBe("no meaningful change");
  });

  it("returns null on a missing figure instead of treating it as zero", () => {
    // A null odds figure means the model had no opinion. Printing "+0 points"
    // would be a number a reader believes.
    expect(ppChange(null, 0.5)).toBeNull();
    expect(ppChange(0.5, null)).toBeNull();
  });
});

/**
 * THE RANK RULE. A Power Pulse rank and a table position are different numbers
 * and a writeup that prints one without naming it has told a reader something
 * they will check and find wrong. See the block comment above these helpers.
 */
describe("ranks", () => {
  const league = { pulseRankedTeams: 10, totalRosters: 12 };

  it("counts a pulse rank out of the teams Power Pulse actually scored", () => {
    expect(pulseFieldSize(league)).toBe(10);
    expect(pulsePhrase(3, league)).toBe("3rd of 10 by Power Pulse");
  });

  it("falls back to the roster count only when nothing was scored", () => {
    expect(pulseFieldSize({ pulseRankedTeams: null, totalRosters: 12 })).toBe(12);
  });

  it("counts a table position out of every roster in the league", () => {
    expect(tablePhrase(3, league)).toBe("3rd of 12 in the table");
  });

  it("always names which rank it is quoting", () => {
    expect(pulsePhrase(11, league)).toContain("Power Pulse");
    expect(tablePhrase(11, league)).toContain("the table");
  });

  it("says both when both are known, because they disagree on purpose", () => {
    expect(standingClause(3, 11, league)).toBe(
      "3rd of 12 in the table and 11th of 10 by Power Pulse",
    );
  });

  it("gives the one it has, still named, when the other is missing", () => {
    expect(standingClause(null, 11, league)).toBe("11th of 10 by Power Pulse");
    expect(standingClause(3, null, league)).toBe("3rd of 12 in the table");
    expect(standingClause(null, null, league)).toBeNull();
  });
});

/**
 * VARIETY IS THE FEATURE. A channel gets these messages several times a week
 * from the same league, and a bank of three lines is a bank a regular reader
 * has memorised by October. The seeded draw cannot manufacture variety it does
 * not have; the only supply is the size of the bank.
 *
 * The floor is deliberately checked at MID snark rather than at full, because
 * that is where most channels run and a bank that is only varied at 1.0 is a
 * bank that repeats itself for everybody sensible.
 */
describe("variety", () => {
  const banks: Array<[string, { heat: number; text: string }[]]> = [
    ["trade openers", TRADE_OPENERS],
    ["lopsided", LOPSIDED_LINES],
    ["even", EVEN_LINES],
    ["preview closers", PREVIEW_CLOSERS],
    ["recap closers", RECAP_CLOSERS],
    ...Object.entries(BAND_LINES),
  ];

  it.each(banks)("%s has real choice at mid snark", (_name, bank) => {
    expect(bank.filter((l) => l.heat <= 0.5).length).toBeGreaterThanOrEqual(3);
  });

  it.each(banks)("%s has real choice at full snark", (_name, bank) => {
    expect(bank.length).toBeGreaterThanOrEqual(6);
  });

  it.each(banks)("%s says each thing once", (_name, bank) => {
    expect(new Set(bank.map((l) => l.text)).size).toBe(bank.length);
  });

  it("draws widely across a bank over many messages", () => {
    // One writeup cannot repeat itself; this is about the CHANNEL. Fifty
    // different trades should not keep landing on the same three openers.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(new Voice(`trade:league:${i}`, 0.8).pick(TRADE_OPENERS)!);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
