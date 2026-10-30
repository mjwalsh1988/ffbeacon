import { describe, expect, it } from "vitest";
import { isPartitionFresh, listPartitions, type FormatRow, type SourceRow } from "./partitions";

const formats: FormatRow[] = [
  { id: "f-sf", slug: "dynasty-ppr-sflex", display_name: "Dynasty SF", display_order: 2 },
  { id: "f-1qb", slug: "dynasty-ppr-std", display_name: "Dynasty 1QB", display_order: 1 },
  { id: "f-rd", slug: "redraft-ppr", display_name: "Redraft PPR", display_order: 3 },
];

const source = (over: Partial<SourceRow>): SourceRow => ({
  slug: "x",
  display_name: "X",
  priority: 10,
  is_default: false,
  data_type: ["player_value_history"],
  supported_format_slugs: null,
  ...over,
});

describe("listPartitions", () => {
  it("treats NULL supported_format_slugs as every active format", () => {
    const out = listPartitions(formats, [source({ slug: "ffbeacon" })]);
    expect(out.map((p) => p.formatSlug)).toEqual([
      "dynasty-ppr-std",
      "dynasty-ppr-sflex",
      "redraft-ppr",
    ]);
  });

  it("respects a declared format list", () => {
    const out = listPartitions(formats, [
      source({ slug: "ktc", supported_format_slugs: ["dynasty-ppr-sflex", "dynasty-ppr-std"] }),
    ]);
    expect(out.map((p) => p.formatSlug)).toEqual(["dynasty-ppr-std", "dynasty-ppr-sflex"]);
  });

  it("puts the default source first, then by priority", () => {
    const out = listPartitions(
      [formats[1]],
      [
        source({ slug: "b", priority: 1 }),
        source({ slug: "default", priority: 5, is_default: true }),
        source({ slug: "a", priority: 2 }),
      ],
    );
    expect(out.map((p) => p.source)).toEqual(["default", "b", "a"]);
  });

  it("skips a source that publishes no value history", () => {
    const out = listPartitions(formats, [source({ data_type: ["projections"] })]);
    expect(out).toEqual([]);
  });
});

describe("isPartitionFresh", () => {
  it("is fresh only when the latest day is stamped", () => {
    expect(isPartitionFresh("2026-10-28", new Set(["2026-10-28"]))).toBe(true);
    expect(isPartitionFresh("2026-10-29", new Set(["2026-10-28"]))).toBe(false);
    expect(isPartitionFresh(null, new Set(["2026-10-28"]))).toBe(false);
  });
});
