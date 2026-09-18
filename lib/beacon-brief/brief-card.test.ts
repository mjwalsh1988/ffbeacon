import { describe, expect, it } from "vitest";
import { briefAnnouncement, buildBriefCard, contentsField, statFields } from "./brief-card";

const BASE = {
  title: "Week 3 of the 2026 season, read through trade value and projected wins",
  url: "https://ffbeacon.com/brief/week-3-2026",
  tlDr: "Three running backs changed hands and two of them were overpaid for.",
  periodChip: "Week 3, 2026",
  periodCovered: "Covers Sep 9 to Sep 15, 2026",
  statTiles: [
    { label: "Trades graded", value: "14" },
    { label: "Biggest riser", value: "Jayden Daniels, +9%" },
  ],
  sectionHeadings: ["The trades", "The waiver wire", "What the model changed its mind about"],
  imageUrl: "https://ffbeacon.com/api/og/brief/week-3-2026",
  formatsPhrase: "Dynasty Superflex PPR and Redraft PPR",
};

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

describe("contentsField", () => {
  it("lists the headings as a bullet list", () => {
    const field = contentsField(["The trades", "The waiver wire"]);
    expect(field?.value).toBe("- The trades\n- The waiver wire");
    expect(field?.inline).toBe(false);
  });

  it("counts what it does not list rather than trailing off", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Section ${i + 1}`);
    const field = contentsField(many);
    expect(field?.value.split("\n")).toHaveLength(9);
    expect(field?.value.endsWith("and 4 more")).toBe(true);
  });

  it("never exceeds Discord's field value cap", () => {
    const huge = Array.from({ length: 20 }, () => "x".repeat(140));
    const field = contentsField(huge);
    expect(field!.value.length).toBeLessThanOrEqual(1024);
  });

  it("is absent when the edition has no sections", () => {
    expect(contentsField([])).toBeNull();
  });
});

describe("statFields", () => {
  it("renders three across at most", () => {
    const fields = statFields([
      { label: "a", value: "1" },
      { label: "b", value: "2" },
      { label: "c", value: "3" },
      { label: "d", value: "4" },
    ]);
    expect(fields).toHaveLength(3);
    expect(fields.every((f) => f.inline)).toBe(true);
  });

  it("drops a tile with no value rather than printing an empty one", () => {
    expect(statFields([{ label: "Trades", value: "  " }])).toHaveLength(0);
  });
});

describe("buildBriefCard", () => {
  it("puts the link on the embed and never in the content", () => {
    const card = buildBriefCard(BASE);
    expect(card.content).not.toContain("http");
    expect(card.embeds[0].url).toBe(BASE.url);
    expect(card.embeds[0].title).toBe(BASE.title);
  });

  it("carries the tl;dr as the description and the OG card as the image", () => {
    const card = buildBriefCard(BASE);
    expect(card.embeds[0].description).toBe(BASE.tlDr);
    expect(card.embeds[0].image?.url).toBe(BASE.imageUrl);
  });

  it("puts the period and the formats in the footer", () => {
    const card = buildBriefCard(BASE);
    expect(card.embeds[0].footer?.text).toBe(
      "Covers Sep 9 to Sep 15, 2026 | Dynasty Superflex PPR and Redraft PPR | ffbeacon.com",
    );
  });

  it("stays inside Discord's 6000 character embed budget on a huge edition", () => {
    const card = buildBriefCard({
      ...BASE,
      tlDr: "y".repeat(1500),
      statTiles: Array.from({ length: 3 }, (_, i) => ({
        label: "L".repeat(80),
        value: `${i}`.repeat(80),
      })),
      sectionHeadings: Array.from({ length: 20 }, () => "z".repeat(140)),
    });
    const embed = card.embeds[0];
    const cost =
      (embed.title?.length ?? 0) +
      (embed.description?.length ?? 0) +
      (embed.author?.name.length ?? 0) +
      (embed.footer?.text.length ?? 0) +
      (embed.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    expect(cost).toBeLessThanOrEqual(6000);
  });

  it("still posts when the edition has no tl;dr, tiles or sections", () => {
    const card = buildBriefCard({
      ...BASE,
      tlDr: null,
      statTiles: [],
      sectionHeadings: [],
      formatsPhrase: null,
    });
    expect(card.embeds[0].description).toBeUndefined();
    expect(card.embeds[0].fields).toBeUndefined();
    expect(card.embeds[0].title).toBe(BASE.title);
  });
});
