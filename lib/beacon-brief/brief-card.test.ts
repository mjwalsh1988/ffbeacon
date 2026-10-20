import { describe, expect, it } from "vitest";
import { briefAnnouncement, briefBody, buildBriefCard } from "./brief-card";

const BASE = {
  title: "Week 3 of the 2026 season, read through trade value and projected wins",
  url: "https://ffbeacon.com/brief/week-3-2026",
  editorTake: "What a week.\n\nThe Packers won again.",
  tlDr: "Three running backs changed hands and two of them were overpaid for.",
  periodChip: "Week 3, 2026",
  periodCovered: "Covers Sep 9 to Sep 15, 2026",
  imageUrl: "https://ffbeacon.com/api/og/brief/week-3-2026",
  formatsPhrase: "Dynasty Superflex PPR and Redraft PPR",
};

const READ_MORE = `[Read more](${BASE.url})`;

describe("briefAnnouncement", () => {
  it("names the period and pings the channel", () => {
    expect(briefAnnouncement("Week 3, 2026")).toBe(
      "@everyone The Week 3, 2026 Beacon Brief is live.",
    );
  });

  it("stays a sentence when the period is unknown", () => {
    expect(briefAnnouncement(null)).toBe("@everyone A new Beacon Brief is live.");
  });
});

describe("briefBody", () => {
  it("uses the editor's take first and keeps its paragraphs", () => {
    expect(briefBody({ editorTake: "One.  \r\n\r\n\r\n\r\nTwo.", tlDr: "Gist." })).toEqual({
      text: "One.\n\nTwo.",
      source: "editor_take",
    });
  });

  it("falls back to the gist when the take is missing or blank", () => {
    expect(briefBody({ editorTake: null, tlDr: "The  gist." })).toEqual({ text: "The gist.", source: "tl_dr" });
    expect(briefBody({ editorTake: "  \n ", tlDr: "The gist." }).source).toBe("tl_dr");
  });

  it("says so when there is neither", () => {
    expect(briefBody({ editorTake: null, tlDr: null })).toEqual({ text: null, source: "none" });
  });
});

describe("buildBriefCard", () => {
  it("puts the link on the embed and never in the content", () => {
    const card = buildBriefCard(BASE);
    expect(card.content).not.toContain("http");
    expect(card.embeds[0].url).toBe(BASE.url);
    expect(card.embeds[0].title).toBe(BASE.title);
  });

  it("carries the editor's take and a Read more link, and nothing else in the body", () => {
    const card = buildBriefCard(BASE);
    expect(card.embeds[0].description).toBe(`What a week.\n\nThe Packers won again.\n\n${READ_MORE}`);
    expect(card.embeds[0].fields).toBeUndefined();
    expect(card.bodySource).toBe("editor_take");
  });

  it("carries the gist when there is no take", () => {
    const card = buildBriefCard({ ...BASE, editorTake: null });
    expect(card.embeds[0].description).toBe(`${BASE.tlDr}\n\n${READ_MORE}`);
    expect(card.bodySource).toBe("tl_dr");
  });

  it("still links when there is no take and no gist", () => {
    const card = buildBriefCard({ ...BASE, editorTake: null, tlDr: null });
    expect(card.embeds[0].description).toBe(READ_MORE);
  });

  it("keeps the OG card and the footer", () => {
    const card = buildBriefCard(BASE);
    expect(card.embeds[0].image?.url).toBe(BASE.imageUrl);
    expect(card.embeds[0].footer?.text).toBe(
      "Covers Sep 9 to Sep 15, 2026 | Dynasty Superflex PPR and Redraft PPR | ffbeacon.com",
    );
  });

  it("never pushes the link off a body at Discord's cap", () => {
    const card = buildBriefCard({ ...BASE, editorTake: "y".repeat(5000) });
    const description = card.embeds[0].description!;
    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description.endsWith(READ_MORE)).toBe(true);
  });
});
