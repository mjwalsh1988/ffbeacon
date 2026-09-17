import { describe, expect, it } from "vitest";
import { parseDataset, parseEditionMetadata } from "./edition-metadata";
import { formatColumnsFor, formatCell, formatSigned, readPlayer } from "./dataset-read";
import { formatPeriod, formatsPhrase, periodChipLabel } from "./period";

describe("parseEditionMetadata", () => {
  it("reads the keys the drafts route writes and ignores everything else", () => {
    const meta = parseEditionMetadata({
      period_start: "2026-09-08T13:00:00.000Z",
      period_end: "2026-09-15T13:00:00.000Z",
      cadence: "weekly",
      formats: [
        { slug: "dynasty-ppr-sflex", display: "Dynasty Superflex PPR" },
        { slug: "redraft-ppr-std", display: "Redraft PPR (1QB)" },
      ],
      source_display: "FF Beacon",
      stat_tiles: [{ label: "Reports", value: 41 }],
      research_log: [{ claim: "must never be read here" }],
      datasets: {
        week_stat_tiles: {
          kind: "week_stat_tiles",
          title: "The week in six numbers",
          columns: ["label", "value"],
          rows: [{ label: "Reports", value: 41 }, { label: "bad", value: { nested: true } }],
          source_note: "Counted from the period's Relays.",
          computed_at: "2026-09-15T13:05:00.000Z",
        },
        junk: { kind: "not_a_kind", rows: [] },
      },
    });
    expect(meta.periodStart).toBe("2026-09-08T13:00:00.000Z");
    expect(meta.cadence).toBe("weekly");
    expect(meta.formats).toHaveLength(2);
    expect(meta.sourceDisplay).toBe("FF Beacon");
    expect(meta.statTiles).toEqual([{ label: "Reports", value: "41" }]);
    expect(Object.keys(meta.datasets)).toEqual(["week_stat_tiles"]);
    // A nested object is not a cell and is dropped; the row survives.
    expect(meta.datasets.week_stat_tiles.rows[1]).toEqual({ label: "bad" });
  });

  it("falls back to the tiles dataset for the card figures", () => {
    const meta = parseEditionMetadata({
      datasets: {
        tiles: {
          kind: "week_stat_tiles",
          columns: ["label", "value"],
          rows: [{ label: "Injuries", value: 12 }],
          source_note: "",
          computed_at: "",
        },
      },
    });
    expect(meta.statTiles).toEqual([{ label: "Injuries", value: "12" }]);
  });

  it("treats a missing or malformed metadata as empty rather than throwing", () => {
    expect(parseEditionMetadata(null).datasets).toEqual({});
    expect(parseEditionMetadata("nope").formats).toEqual([]);
    expect(parseDataset("x", { kind: "top_scorers" })?.rows).toEqual([]);
  });
});

describe("dataset-read", () => {
  it("finds a format's columns whatever separator the producer used", () => {
    const cols = formatColumnsFor(
      ["name", "dynasty-ppr-sflex.current", "dynasty-ppr-sflex:change_7d", "redraft-ppr-std_current"],
      "dynasty-ppr-sflex",
    );
    expect(cols.map((c) => c.column)).toEqual(["dynasty-ppr-sflex.current", "dynasty-ppr-sflex:change_7d"]);
    expect(cols.map((c) => c.label)).toEqual(["Value", "7-day change"]);
  });

  it("signs a change and never turns a null into a zero", () => {
    expect(formatSigned(12)).toBe("+12");
    expect(formatSigned(-3.14)).toBe("-3.1");
    expect(formatCell(null)).toBe("n/a");
    expect(formatCell(4.25, "change_7d")).toBe("+4.3");
  });

  it("reads a player's identity from the spellings the producers use", () => {
    expect(readPlayer({ player_id: "p1", player_slug: "a-b", player_name: "A B", pos: "RB", team: "PHI" })).toEqual({
      id: "p1",
      slug: "a-b",
      name: "A B",
      position: "RB",
      team: "PHI",
    });
  });
});

describe("period", () => {
  it("shortens the first date when both fall in one year", () => {
    expect(formatPeriod("2026-09-09T13:00:00Z", "2026-09-15T13:00:00Z")).toBe("Sep 9 to Sep 15, 2026");
    expect(formatPeriod("2025-12-30T13:00:00Z", "2026-01-06T13:00:00Z")).toBe("Dec 30, 2025 to Jan 6, 2026");
    expect(formatPeriod(null, "2026-01-06T13:00:00Z")).toBeNull();
  });

  it("names the period and the formats", () => {
    expect(periodChipLabel("2026", 2)).toBe("Week 2, 2026");
    expect(periodChipLabel("2026", null)).toBe("Off-season, 2026");
    expect(formatsPhrase([{ display: "A" }, { display: "B" }])).toBe("A and B");
    expect(formatsPhrase([])).toBeNull();
  });
});
