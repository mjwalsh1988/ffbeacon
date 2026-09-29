import { describe, expect, it } from "vitest";
import {
  RELAY_PROMPT_MARKER,
  RELAY_PROMPT_SECTION,
  clampAtWord,
  normalizeRelayExtraction,
  withRelaySection,
} from "./extract";
import { checkRelayGrounding } from "./grounding";

const CATEGORIZE = "Classify this post. Categories: {categories}.";

describe("withRelaySection", () => {
  it("appends the setting's section to a categorize prompt without one", () => {
    expect(withRelaySection(CATEGORIZE, RELAY_PROMPT_SECTION)).toBe(`${CATEGORIZE}\n\n${RELAY_PROMPT_SECTION}`);
  });

  it("sends the edited setting, not an older copy left in the categorize prompt", () => {
    const stale = `${CATEGORIZE}\n\n${RELAY_PROMPT_MARKER}\nOld rules the admin has since replaced.`;
    const edited = `${RELAY_PROMPT_MARKER}\nNew rules from the admin field.`;
    const out = withRelaySection(stale, edited);
    expect(out).toBe(`${CATEGORIZE}\n\n${edited}`);
    expect(out).not.toContain("Old rules");
    expect(out.split(RELAY_PROMPT_MARKER)).toHaveLength(2);
  });

  it("uses the section alone when the categorize prompt is empty", () => {
    expect(withRelaySection("", RELAY_PROMPT_SECTION)).toBe(RELAY_PROMPT_SECTION);
    expect(withRelaySection(`${RELAY_PROMPT_MARKER}\nold`, RELAY_PROMPT_SECTION)).toBe(RELAY_PROMPT_SECTION);
  });
});

describe("clampAtWord", () => {
  it("leaves a string inside the limit alone", () => {
    expect(clampAtWord("torn ACL", 80)).toBe("torn ACL");
  });

  it("drops a half word, an unclosed parenthesis and a dangling connective", () => {
    expect(
      clampAtWord("Josh Allen (2024), Dak Prescott (2019), Peyton Manning (2013), and Tom Brady (2007)", 80),
    ).toBe("Josh Allen (2024), Dak Prescott (2019), Peyton Manning (2013), and Tom Brady");
    expect(
      clampAtWord("Most teams to win without their Week 1 starting QB through 3 weeks since the 1970 merger", 80),
    ).toBe("Most teams to win without their Week 1 starting QB through 3 weeks");
  });

  it("falls back to a hard cut when one word is longer than the limit", () => {
    expect(clampAtWord("a".repeat(30), 24)).toBe("a".repeat(24));
  });
});

describe("normalizeRelayExtraction, fact clamping", () => {
  // Five of the nine Relays held for review between 2026-09-25 and 2026-09-29
  // failed on a fragment the old slice made, not on anything the model wrote.
  it("never leaves a fragment the grounding check will fail", () => {
    const post =
      "Quarterbacks on the Giants' list of options include free agent Jimmy Garoppolo, Cardinals backup Gardner Minshew II, Vikings reserve J.J. McCarthy, 49ers backup Mac Jones and Chiefs backup Justin Fields.";
    const relay = normalizeRelayExtraction({
      headline: "Giants exploring quarterback options including free agent Jimmy Garoppolo.",
      kind: "transaction",
      facts: [
        {
          label: "Candidates",
          value: "Jimmy Garoppolo (free agent), Gardner Minshew II (Cardinals), J.J. McCarthy (Vikings), Mac Jones (49ers)",
        },
      ],
      timeline: null,
      availability: "none",
    });
    expect(relay?.facts[0].value).toBe("Jimmy Garoppolo (free agent), Gardner Minshew II (Cardinals), J.J. McCarthy");
    const out = checkRelayGrounding(
      {
        text: post,
        playerNames: ["Jimmy Garoppolo", "Gardner Minshew", "J.J. McCarthy"],
        teamNames: ["New York Giants", "NYG", "Arizona Cardinals", "ARI", "Minnesota Vikings", "MIN"],
      },
      relay!,
    );
    expect(out.failures).toEqual([]);
  });
});

describe("normalizeRelayExtraction, headline clamping", () => {
  it("never clamps a headline below the table's minimum", () => {
    const headline = `Nick Bosa (hamstring, ${"expected to miss time ".repeat(12)}`;
    const relay = normalizeRelayExtraction({ headline, kind: "injury", facts: [], timeline: null, availability: "none" });
    expect(relay!.headline.length).toBeGreaterThanOrEqual(20);
    expect(relay!.headline.length).toBeLessThanOrEqual(240);
  });
});
