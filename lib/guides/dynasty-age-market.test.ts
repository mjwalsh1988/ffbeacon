import { describe, expect, it } from "vitest";
import {
  ageOn,
  pickDynastyFormat,
  summarizeAgeMarket,
  type AgeMarketInputRow,
} from "./dynasty-age-market";

const ON = new Date("2026-09-18T12:00:00Z");

describe("ageOn", () => {
  it("counts whole years and respects the birthday", () => {
    expect(ageOn("2000-09-18", ON)).toBe(26);
    expect(ageOn("2000-09-19", ON)).toBe(25);
    expect(ageOn("1998-01-01", ON)).toBe(28);
  });

  it("returns null for a malformed or implausible date", () => {
    expect(ageOn("not a date", ON)).toBeNull();
    expect(ageOn("2020-01-01", ON)).toBeNull();
  });
});

function row(
  position: string,
  value: number | null,
  birthDate: string | null,
): AgeMarketInputRow {
  return { position, value, birthDate };
}

describe("summarizeAgeMarket", () => {
  it("counts only the top N by value at each position", () => {
    const rows = [
      row("RB", 900, "2003-01-01"), // 23
      row("RB", 800, "1996-01-01"), // 30
      row("RB", 100, "2004-01-01"), // outside top 2
    ];
    const rb = summarizeAgeMarket(rows, ON, 2).find((p) => p.position === "RB")!;
    expect(rb.counted).toBe(2);
    expect(rb.bands.young).toBe(1);
    expect(rb.bands.veteran).toBe(1);
    expect(rb.veteranCount).toBe(1);
    // 800 of 1700.
    expect(rb.veteranValueSharePct).toBe(47);
  });

  it("keeps a player with no birth date in the top N as unknown rather than promoting the next one", () => {
    const rows = [
      row("WR", 900, null),
      row("WR", 800, "2001-01-01"), // 25
      row("WR", 700, "1990-01-01"), // would be promoted if the unknown were dropped
    ];
    const wr = summarizeAgeMarket(rows, ON, 2).find((p) => p.position === "WR")!;
    expect(wr.unknownAge).toBe(1);
    expect(wr.bands.prime).toBe(1);
    expect(wr.veteranCount).toBe(0);
    // The unknown player's value stays in the denominator.
    expect(wr.veteranValueSharePct).toBe(0);
  });

  it("ignores rows without a positive value and positions outside the four", () => {
    const rows = [
      row("TE", null, "2000-01-01"),
      row("TE", 0, "2000-01-01"),
      row("K", 500, "1990-01-01"),
    ];
    const out = summarizeAgeMarket(rows, ON);
    expect(out.map((p) => p.position)).toEqual(["QB", "RB", "WR", "TE"]);
    expect(out.every((p) => p.counted === 0)).toBe(true);
    expect(out.find((p) => p.position === "TE")!.veteranValueSharePct).toBeNull();
  });

  it("reports the median age of the known ages", () => {
    const rows = [
      row("QB", 3, "2002-01-01"), // 24
      row("QB", 2, "1998-01-01"), // 28
      row("QB", 1, "1994-01-01"), // 32
    ];
    const qb = summarizeAgeMarket(rows, ON).find((p) => p.position === "QB")!;
    expect(qb.medianAge).toBe(28);
  });
});

describe("pickDynastyFormat", () => {
  const formats = [
    { id: "1", slug: "redraft-ppr-std", display_name: "Redraft 1QB", league_type: "redraft", is_superflex: false, is_bestball: false, display_order: 1 },
    { id: "2", slug: "dynasty-ppr-std", display_name: "Dynasty 1QB", league_type: "dynasty", is_superflex: false, is_bestball: false, display_order: 5 },
    { id: "3", slug: "dynasty-ppr-sflex", display_name: "Dynasty SF", league_type: "dynasty", is_superflex: true, is_bestball: false, display_order: 6 },
    { id: "4", slug: "dynasty-ppr-tep-sflex", display_name: "Dynasty SF TEP", league_type: "dynasty", is_superflex: true, is_bestball: false, display_order: 4, te_premium_bonus: 0.5 },
    { id: "5", slug: "bestball-dynasty-ppr-sflex", display_name: "BB Dynasty SF", league_type: "dynasty", is_superflex: true, is_bestball: true, display_order: 8 },
    { id: "6", slug: "redraft-ppr-sflex", display_name: "Redraft SF", league_type: "redraft", is_superflex: true, is_bestball: false, display_order: 2 },
  ];

  it("keeps the reader's own dynasty format", () => {
    expect(pickDynastyFormat(formats, "dynasty-ppr-tep-sflex")?.slug).toBe(
      "dynasty-ppr-tep-sflex",
    );
  });

  it("maps a redraft reader to the dynasty format with the same quarterback count", () => {
    expect(pickDynastyFormat(formats, "redraft-ppr-std")?.slug).toBe(
      "dynasty-ppr-std",
    );
    expect(pickDynastyFormat(formats, "redraft-ppr-sflex")?.slug).toBe(
      "dynasty-ppr-sflex",
    );
  });

  it("never picks a best ball format, even for a best ball dynasty reader", () => {
    expect(pickDynastyFormat(formats, "bestball-dynasty-ppr-sflex")?.slug).toBe(
      "dynasty-ppr-sflex",
    );
  });

  it("defaults to superflex with no reader format", () => {
    expect(pickDynastyFormat(formats, null)?.slug).toBe("dynasty-ppr-sflex");
  });

  it("returns null when no dynasty format is active", () => {
    expect(pickDynastyFormat(formats.slice(0, 1), null)).toBeNull();
  });
});
