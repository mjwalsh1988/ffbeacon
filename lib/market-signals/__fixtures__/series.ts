/**
 * Three value series for the Market Signals tests (plan section 16): steady,
 * trending up through the band, and one with gaps. Each is a Map of UTC day to
 * market value, oldest first, ending on END_DAY.
 */

import { addDays } from "../bollinger";

export const END_DAY = "2026-10-28";

function build(values: Array<number | null>): Map<string, number> {
  const out = new Map<string, number>();
  values.forEach((v, i) => {
    if (v === null) return;
    out.set(addDays(END_DAY, i - (values.length - 1)), v);
  });
  return out;
}

/** 30 days alternating 1000 and 1010: a tight band, latest in the middle. */
export const steadySeries = build(
  Array.from({ length: 30 }, (_, i) => (i === 29 ? 1005 : i % 2 === 0 ? 1000 : 1010)),
);

/** 29 flat days near 1000, then a jump to 1400 on the last day: above the band. */
export const breakoutSeries = build(
  Array.from({ length: 30 }, (_, i) => (i === 29 ? 1400 : 1000 + (i % 3) * 5)),
);

/** 30 days with every third day missing: 20 points. */
export const gappySeries = build(
  Array.from({ length: 30 }, (_, i) => (i % 3 === 1 ? null : 2000 + i * 2)),
);
