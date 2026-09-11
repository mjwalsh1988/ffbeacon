import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReliabilityWeek } from "@/lib/breakdown/types";
import { RECENT_FORM_WEEKS, RecentFormChart, selectRecentFormWeeks } from "./recent-form-chart";

describe("RecentFormChart markup", () => {
  it("prints every drawn value as visible table text, not only for a screen reader", () => {
    const html = renderToStaticMarkup(
      createElement(RecentFormChart, {
        form: { season: 2025, weeks: [week(14, 18.4, 12.1), week(15, null, 13, true), week(16, 9.2, 11.3)] },
      }),
    );
    expect(html).toContain("<table");
    expect(html).toContain("Last 3 weeks, 2025");
    expect(html).toContain("Met or beat the projection in 1 of 2 graded weeks.");
    expect(html).toContain(">18.4<");
    expect(html).toContain(">12.1<");
    expect(html).toContain("Out<span class=\"sr-only\">, did not play</span>");
    expect(html).toContain('aria-hidden="true"');
  });

  it("says so in words when there is nothing to draw", () => {
    const html = renderToStaticMarkup(createElement(RecentFormChart, { form: null }));
    expect(html).toContain("Not enough graded weeks to chart yet.");
    expect(html).not.toContain("<table");
  });
});

function week(n: number, actual: number | null, projected: number | null = 12, missed = false): ReliabilityWeek {
  return { week: n, actual, projected, missed };
}

describe("selectRecentFormWeeks", () => {
  it("drops a trailing week whose stats have not synced, however the loader flagged it", () => {
    // The loader marks a projected week with no stats row as missed, which is
    // also exactly what a week with no stats YET looks like.
    const weeks = [week(1, 14.2), week(2, 9.8), week(3, null, 13, true)];
    expect(selectRecentFormWeeks(weeks).map((w) => w.week)).toEqual([1, 2]);
  });

  it("returns nothing when no week has a real score yet", () => {
    const weeks = [week(1, null, 17.2, true)];
    expect(selectRecentFormWeeks(weeks)).toEqual([]);
  });

  it("keeps a genuine absence in the middle of a run", () => {
    const weeks = [week(4, 11), week(5, null, 12, true), week(6, 15)];
    const out = selectRecentFormWeeks(weeks);
    expect(out.map((w) => w.week)).toEqual([4, 5, 6]);
    expect(out[1].missed).toBe(true);
  });

  it("caps at the most recent weeks, in week order", () => {
    const weeks = Array.from({ length: 10 }, (_, i) => week(10 - i, 10 + i));
    const out = selectRecentFormWeeks(weeks);
    expect(out).toHaveLength(RECENT_FORM_WEEKS);
    expect(out.map((w) => w.week)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("handles an empty list", () => {
    expect(selectRecentFormWeeks([])).toEqual([]);
  });
});
