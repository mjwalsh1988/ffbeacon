import { describe, expect, it } from "vitest";
import { RELAY_PROMPT_MARKER, RELAY_PROMPT_SECTION, withRelaySection } from "./extract";

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
