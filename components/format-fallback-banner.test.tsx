import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { reconcileFormatWithSource, type SourceRegistryRow } from "@/lib/source";
import { FormatFallbackBanner } from "./format-fallback-banner";

const REGISTRY: SourceRegistryRow[] = [
  {
    slug: "ktc",
    display_name: "KTC",
    description: null,
    priority: 1,
    is_default: false,
    data_type: ["rankings", "player_value_history"],
    supported_format_slugs: ["redraft-ppr-std", "dynasty-ppr-sflex"],
    update_cadence: "daily",
  },
];
const FORMATS = [
  {
    slug: "redraft-ppr-std",
    display_name: "Redraft PPR",
    league_type: "redraft",
    scoring_type: "ppr",
    is_superflex: false,
    display_order: 1,
  },
  {
    slug: "redraft-half-std",
    display_name: "Redraft Half PPR",
    league_type: "redraft",
    scoring_type: "half_ppr",
    is_superflex: false,
    display_order: 2,
  },
];

describe("format fall-through keeps the source and moves the format", () => {
  it("moves an uncovered format and names the swap", () => {
    const out = reconcileFormatWithSource(REGISTRY, FORMATS, "ktc", "redraft-half-std");
    expect(out.formatSlug).toBe("redraft-ppr-std");
    const html = renderToStaticMarkup(<FormatFallbackBanner fallback={out.fallback} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Switched to Redraft PPR");
    expect(html).toContain("KTC doesn&#x27;t provide values for Redraft Half PPR");
  });

  it("renders nothing when the source covers the format", () => {
    const out = reconcileFormatWithSource(REGISTRY, FORMATS, "ktc", "redraft-ppr-std");
    expect(out.fallback).toBeNull();
    expect(renderToStaticMarkup(<FormatFallbackBanner fallback={out.fallback} />)).toBe("");
  });
});
