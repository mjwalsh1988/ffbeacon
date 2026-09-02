import { describe, it, expect } from "vitest";
import { matches, normalizeParts, queryTerms } from "./player-filter";

/** One option's searchable text, the way the picker builds it. */
function hay(label: string, group: string) {
  return normalizeParts(`${label} ${group}`);
}

function finds(query: string, label: string, group = "Team Alpha"): boolean {
  return matches(hay(label, group), queryTerms(query));
}

describe("player filter matching", () => {
  it("finds a name typed the way it is spelled", () => {
    expect(finds("chase", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("jefferson", "Justin Jefferson (WR, MIN)")).toBe(true);
  });

  it("finds a name typed without its apostrophe", () => {
    // The bug this file exists for. Every mark used to become a space, so
    // "Ja'Marr" was stored as "ja marr" and the term "jamarr" matched nothing.
    // A reader typing the name as it sounds got an empty list for a player who
    // was in it.
    expect(finds("jamarr", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("jamarr chase", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("dandre swift", "D'Andre Swift (RB, CHI)")).toBe(true);
    expect(finds("devon achane", "De'Von Achane (RB, MIA)")).toBe(true);
  });

  it("still finds it typed WITH the apostrophe, or with a space instead", () => {
    expect(finds("ja'marr", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("ja marr", "Ja'Marr Chase (WR, CIN)")).toBe(true);
  });

  it("handles hyphens and full stops the same way", () => {
    expect(finds("amonra", "Amon-Ra St. Brown (WR, DET)")).toBe(true);
    expect(finds("amon-ra", "Amon-Ra St. Brown (WR, DET)")).toBe(true);
    expect(finds("st brown", "Amon-Ra St. Brown (WR, DET)")).toBe(true);
    expect(finds("smithnjigba", "Jaxon Smith-Njigba (WR, SEA)")).toBe(true);
  });

  it("keeps a real space between two words a real space", () => {
    // The honest edge of this. Closing up an apostrophe or a hyphen is
    // recovering a word that was always one word; closing up the gap between
    // "St." and "Brown" would be inventing one, and doing it everywhere would
    // let "chasewr" match a player whose position happens to follow his name.
    expect(finds("stbrown", "Amon-Ra St. Brown (WR, DET)")).toBe(false);
    expect(finds("chasewr", "Ja'Marr Chase (WR, CIN)")).toBe(false);
  });

  it("ignores accents", () => {
    expect(finds("kupp", "Cooper Kupp (WR, LAR)")).toBe(true);
    expect(finds("bijan", "B\u00edjan Robinson (RB, ATL)")).toBe(true);
  });

  it("searches the team the player is on and the roster holding him", () => {
    expect(finds("cin", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("bombers", "D'Andre Swift (RB, CHI)", "Bob's Bombers")).toBe(true);
    // The roster name carries an apostrophe too, and it has to answer to the
    // same two readings the player names do.
    expect(finds("bobs", "D'Andre Swift (RB, CHI)", "Bob's Bombers")).toBe(true);
  });

  it("requires every word, in any order", () => {
    expect(finds("chase wr", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("wr chase", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("chase rb", "Ja'Marr Chase (WR, CIN)")).toBe(false);
  });

  it("says no when it means no", () => {
    expect(finds("mahomes", "Ja'Marr Chase (WR, CIN)")).toBe(false);
    expect(finds("zzz", "Justin Jefferson (WR, MIN)")).toBe(false);
  });

  it("matches everything on an empty or punctuation-only query", () => {
    expect(finds("", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("   ", "Ja'Marr Chase (WR, CIN)")).toBe(true);
    expect(finds("...", "Ja'Marr Chase (WR, CIN)")).toBe(true);
  });
});
