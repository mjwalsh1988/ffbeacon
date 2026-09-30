import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { accessibleFormatName, FormatNameText, splitFormatName } from "./format-name-text";

describe("splitFormatName", () => {
  it("leaves a name with nothing to abbreviate as one plain part", () => {
    expect(splitFormatName("Redraft PPR")).toEqual([{ text: "Redraft PPR", expansion: null }]);
  });

  it("keeps the visible SF and carries the full word as its expansion", () => {
    expect(splitFormatName("Dynasty PPR Superflex")).toEqual([
      { text: "Dynasty PPR ", expansion: null },
      { text: "SF", expansion: "Superflex" },
    ]);
  });

  it("handles text after the abbreviation", () => {
    expect(splitFormatName("Dynasty Superflex TEP")).toEqual([
      { text: "Dynasty ", expansion: null },
      { text: "SF", expansion: "Superflex" },
      { text: " TEP", expansion: null },
    ]);
  });
});

describe("accessibleFormatName", () => {
  it("contains the visible abbreviation, so a voice command naming it matches", () => {
    const name = accessibleFormatName("Dynasty PPR Superflex");
    expect(name).toBe("Dynasty PPR SF (Superflex)");
    expect(name).toContain("Dynasty PPR SF");
  });
});

describe("FormatNameText", () => {
  it("renders the expansion sr-only and hides nothing from assistive technology", () => {
    const html = renderToStaticMarkup(<FormatNameText displayName="Dynasty PPR Superflex" />);
    expect(html).toBe('Dynasty PPR SF<span class="sr-only"> (Superflex)</span>');
    expect(html).not.toContain("aria-hidden");
  });
});
