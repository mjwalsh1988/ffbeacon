import { describe, expect, it } from "vitest";
import {
  DISCORD_CONTENT_LIMIT,
  handleWithAt,
  renderRelayCard,
  renderRetractedDiscordText,
} from "./render";

const BASE = {
  headline: "Eagles place RB Saquon Barkley on injured reserve with a high ankle sprain.",
  facts: [
    { label: "Injury", value: "high ankle sprain" },
    { label: "Timeline", value: "4 to 6 weeks" },
  ],
  sourceHandle: "AdamSchefter",
  sourcePostedAt: "2026-09-16T11:30:00Z",
};

describe("handleWithAt", () => {
  it("adds exactly one at sign", () => {
    expect(handleWithAt("AdamSchefter")).toBe("@AdamSchefter");
    expect(handleWithAt("@AdamSchefter")).toBe("@AdamSchefter");
    expect(handleWithAt("@@x")).toBe("@x");
  });
});

describe("renderRelayCard", () => {
  it("builds the source line through the Eastern formatter", () => {
    const card = renderRelayCard(BASE);
    expect(card.sourceLine).toBe(
      "Original report: @AdamSchefter on X, Sep 16, 2026, 7:30 AM EDT",
    );
  });

  it("writes the Discord text as headline, facts one per line, then the via line", () => {
    const card = renderRelayCard(BASE);
    expect(card.discordText).toBe(
      [
        BASE.headline,
        "",
        "Injury: high ankle sprain",
        "Timeline: 4 to 6 weeks",
        "",
        "via @AdamSchefter",
      ].join("\n"),
    );
    expect(card.discordFitted).toBe(true);
  });

  it("carries no link and no mention, whatever the input held", () => {
    const card = renderRelayCard({
      ...BASE,
      headline: "Read more at https://x.com/AdamSchefter/status/1 and www.espn.com @everyone <@&123>",
      facts: [{ label: "Link", value: "[here](https://example.com)" }],
    });
    expect(card.discordText).not.toMatch(/https?:|www\.|<@|@everyone/);
    expect(card.discordText).toContain("Link: here");
  });

  it("drops the facts rather than a fact when the card cannot fit", () => {
    const facts = Array.from({ length: 6 }, (_, i) => ({
      label: `Fact ${i + 1}`,
      value: "x".repeat(400),
    }));
    const card = renderRelayCard({ ...BASE, facts });
    expect(card.discordFitted).toBe(false);
    expect(card.discordText.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
    expect(card.discordText).toBe(`${BASE.headline}\n\nvia @AdamSchefter`);
    // The site card still carries every fact; only Discord was shortened.
    expect(card.facts).toHaveLength(6);
  });

  it("omits the facts block entirely when there are none", () => {
    const card = renderRelayCard({ ...BASE, facts: [] });
    expect(card.discordText).toBe(`${BASE.headline}\n\nvia @AdamSchefter`);
  });
});

describe("renderRetractedDiscordText", () => {
  it("says the report was removed, keeps the headline and the via line, and no link", () => {
    const text = renderRetractedDiscordText({
      headline: BASE.headline,
      sourceHandle: "@AdamSchefter",
    });
    expect(text.startsWith("Retracted: the original report was removed by its author.")).toBe(true);
    expect(text).toContain(BASE.headline);
    expect(text.endsWith("via @AdamSchefter")).toBe(true);
    expect(text).not.toMatch(/https?:/);
  });
});
