import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

/**
 * The slug rules, tested against the strings that actually broke.
 *
 * The Cyrillic case is the reason this file exists, so it is written the way the
 * failure arrived: a string built from a codepoint, not a literal anyone could
 * mistake for the Latin letter while reading the test.
 */

/** U+043E, Cyrillic small letter o. Drawn exactly like the Latin o. */
const CYRILLIC_O = String.fromCodePoint(0x043e);
/** U+2019, the curly apostrophe a phone keyboard produces. */
const CURLY_APOSTROPHE = String.fromCodePoint(0x2019);

describe("slugify", () => {
  it("does the ordinary thing to an ordinary headline", () => {
    expect(slugify("Kyler Murray named Vikings starting QB")).toBe(
      "kyler-murray-named-vikings-starting-qb",
    );
  });

  it("repairs the Cyrillic lookalike that split Ja'Kobi Lane in half", () => {
    // What the writer returned on 2026-08-04, character for character.
    const written = `jak${CYRILLIC_O}bi-lane-ravens-training-camp`;
    expect(slugify(written)).toBe("jakobi-lane-ravens-training-camp");
  });

  it("deletes an apostrophe instead of breaking the name on it", () => {
    expect(slugify("Ja'Kobi Lane starring at Ravens training camp")).toBe(
      "jakobi-lane-starring-at-ravens-training-camp",
    );
    expect(slugify("De'Von Achane sets goal to lead NFL in rushing")).toBe(
      "devon-achane-sets-goal-to-lead-nfl-in-rushing",
    );
    expect(slugify(`Qwan${CURLY_APOSTROPHE}tez Stiggers collapses`)).toBe(
      "qwantez-stiggers-collapses",
    );
    expect(slugify("Henry To'oTo'o signs two-year $16M Texans extension")).toBe(
      "henry-tootoo-signs-two-year-16m-texans-extension",
    );
  });

  it("folds an accent to its base letter", () => {
    // Composed and decomposed spellings of the same name must not produce two URLs.
    const composed = String.fromCodePoint(0x00e9); // e with acute
    const decomposed = `e${String.fromCodePoint(0x0301)}`; // e + combining acute
    expect(slugify(`Andr${composed} Dozier`)).toBe("andre-dozier");
    expect(slugify(`Andr${decomposed} Dozier`)).toBe("andre-dozier");
  });

  it("still treats real punctuation as a word break", () => {
    expect(slugify("Emeka Egbuka injury: Buccaneers WR toe issue")).toBe(
      "emeka-egbuka-injury-buccaneers-wr-toe-issue",
    );
    expect(slugify("J.J. McCarthy wants to stay with Vikings")).toBe(
      "j-j-mccarthy-wants-to-stay-with-vikings",
    );
  });

  it("never ends on a hyphen, even when the cut lands mid-word", () => {
    const long = slugify(
      "Commanders sign Brunskill, Petit-Frere and Scharping in a round of offensive line moves",
    );
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
    expect(long.startsWith("commanders-sign-brunskill")).toBe(true);
  });

  it("falls back rather than returning an empty slug", () => {
    expect(slugify("!!!")).toBe("beacon-brief");
    expect(slugify("")).toBe("beacon-brief");
  });
});
