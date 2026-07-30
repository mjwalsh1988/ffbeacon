import { describe, expect, it } from "vitest";
import { formatRfc822Eastern } from "@/lib/datetime";

/**
 * RSS pubDate formatting.
 *
 * Hand-rolled because RSS 2.0 requires RFC 822, which Intl cannot emit directly, so
 * the pieces are assembled from formatToParts. Worth testing: a malformed date makes a
 * feed fail validation, and some readers silently drop items they cannot parse, which
 * would look like the feed working while quietly losing articles.
 */
describe("formatRfc822Eastern", () => {
  const RFC_822 =
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/;

  it("formats a summer timestamp in daylight time", () => {
    // 2026-07-29T22:13:23Z is 18:13:23 on the 29th in New York, offset -0400.
    expect(formatRfc822Eastern("2026-07-29T22:13:23.000Z")).toBe(
      "Wed, 29 Jul 2026 18:13:23 -0400",
    );
  });

  it("formats a winter timestamp in standard time", () => {
    // Offset shifts to -0500 on its own. Nothing about EST/EDT is hardcoded.
    expect(formatRfc822Eastern("2026-01-15T22:13:23.000Z")).toBe(
      "Thu, 15 Jan 2026 17:13:23 -0500",
    );
  });

  it("rolls the date back when UTC is past midnight but Eastern is not", () => {
    // 00:30Z on the 30th is still 20:30 on the 29th in New York.
    expect(formatRfc822Eastern("2026-07-30T00:30:00.000Z")).toBe(
      "Wed, 29 Jul 2026 20:30:00 -0400",
    );
  });

  it("renders Eastern midnight as 00, never 24", () => {
    // hour12: false returns "24" for midnight in some runtimes, which is not valid
    // RFC 822 and would break parsing.
    const out = formatRfc822Eastern("2026-07-29T04:00:00.000Z");
    expect(out).toBe("Wed, 29 Jul 2026 00:00:00 -0400");
    expect(out).toMatch(RFC_822);
  });

  it("matches the RFC 822 shape across a full year", () => {
    for (let month = 0; month < 12; month++) {
      const iso = new Date(Date.UTC(2026, month, 15, 12, 34, 56)).toISOString();
      expect(formatRfc822Eastern(iso)).toMatch(RFC_822);
    }
  });

  it("returns null for missing or unparseable input so the element can be omitted", () => {
    expect(formatRfc822Eastern(null)).toBeNull();
    expect(formatRfc822Eastern(undefined)).toBeNull();
    expect(formatRfc822Eastern("")).toBeNull();
    expect(formatRfc822Eastern("not a date")).toBeNull();
  });
});
