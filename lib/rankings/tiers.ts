/**
 * Positional tiers for the rankings board, computed from value cliffs.
 *
 * WHY THIS EXISTS. `rankings.tier` in the database is not a tier. It is a
 * percentile sixth of the whole board: `lib/seed-rankings.ts` writes
 * `ceil((index + 1) / total * 6)`, so on a 500-row dynasty board tier 1 runs
 * from rank 1 to rank 102. A reader looking at the 52nd best player and
 * reading "T1" learns nothing, and the two things a tier is supposed to tell
 * them (where the position runs out, and whether waiting one more round costs
 * anything) are exactly what a percentile bucket cannot say.
 *
 * What a fantasy tier actually means is a group of players who are close
 * enough in value that which one you end up with barely matters, ending at the
 * point where the next player down is meaningfully worse. That is a property
 * of the GAPS between values, not of a player's place in a list, and it is
 * per POSITION: the question is always "how many more running backs like this
 * one are there", never "how many more players".
 *
 * THE RULE, IN TWO PASSES. Inside one position, walking down by value:
 *   1. Cut wherever the step down from the player above is at least
 *      STEP_BREAK_PCT and clears `minGap`. Those are the cliffs.
 *   2. Any run left over that still spans more than TIER_SPAN_PCT of its own
 *      top, or holds more than MAX_TIER_SIZE players, is cut again AT ITS
 *      LARGEST INTERNAL GAP, and each half is reconsidered the same way.
 *
 * Pass two has to find the largest gap rather than cut where a running total
 * happens to cross a line, and that is not a refinement, it is the whole
 * point. A cumulative-span rule cuts at the first player past the threshold,
 * which on a real board put a tier boundary between two running backs 221
 * points apart while leaving the 884-point cliff four rows further down inside
 * a tier. A tier boundary drawn anywhere other than the biggest nearby gap is
 * telling a reader a cliff exists where there is none.
 *
 * `minGap` is what keeps the bottom of a board sane. Below the startable
 * players every value is tiny, so a two-point step is a 10% step and a pure
 * percentage rule would slice the tail into dozens of one-man tiers that mean
 * nothing. Scaling the floor to the position's own top value handles kickers
 * and defenses (whose whole range is 242 down to 66) on the same rule as
 * quarterbacks, without a special case for either.
 *
 * The size cap is the one rule allowed to cut where no gap qualifies, because
 * a run of forty players a tenth of a percent apart has no cliff in it and
 * still cannot be called one tier. With nothing to choose between the gaps it
 * cuts down the middle, which is why the tie-break below prefers the candidate
 * nearest the midpoint.
 *
 * Everything here is pure and clock-free: same rows in, same tiers out. It
 * runs on the FULL board before any position filter is applied, so a player's
 * tier is the same number whether a reader is looking at every position or
 * just their own.
 */

/** A step down at least this large opens a new tier. */
const STEP_BREAK_PCT = 0.1;
/** A tier holding a wider spread than this is cut at its largest gap. */
const TIER_SPAN_PCT = 0.25;
/** Floor on a qualifying drop, as a fraction of the position's best value. */
const MIN_GAP_FRACTION = 0.004;
/** Absolute floor, for a position whose whole scale is small. */
const MIN_ABSOLUTE_GAP = 1;
/** No tier runs longer than this, however shallow the run. */
const MAX_TIER_SIZE = 12;

export type TierInput = {
  position: string;
  /** Current market value. Null when no value resolved for this player. */
  value: number | null;
};

export type TierResult = {
  /** 1-based tier within the player's own position. Null with no value. */
  tier: number | null;
  /** How many players share this tier. Null with no value. */
  tierSize: number | null;
  /** True for the best player in the tier, the one just past a cliff. */
  startsTier: boolean;
  /** Value drop to the next player at the same position. Null for the last. */
  gapToNext: number | null;
  /** That drop as a percentage of this player's own value. */
  gapToNextPct: number | null;
  /**
   * True when the next player at this position is in a LOWER tier, so this gap
   * is the tier boundary itself.
   *
   * The board's Gap column used to highlight on a percentage threshold of its
   * own, which meant the cyan "a cliff" gaps and the tier rings marked
   * different rows: a pass-two cut opens a tier at whatever the largest gap in
   * an over-wide run happens to be, which can be well under any fixed
   * percentage, and a big percentage step that fails the minimum-gap floor
   * opens no tier at all. One boundary, one flag, so the ring and the
   * highlight can never point at different places.
   */
  opensNextTier: boolean;
};

const EMPTY: TierResult = {
  tier: null,
  tierSize: null,
  startsTier: false,
  gapToNext: null,
  gapToNextPct: null,
  opensNextTier: false,
};

/**
 * Tier every row, by position, and return the results in INPUT ORDER so the
 * caller can zip them straight back onto its own rows.
 *
 * Input order is also the tie-break inside a position: the board arrives
 * sorted by overall rank, so two players on the same value keep the order the
 * rankings table already put them in rather than swapping between runs.
 */
export function assignPositionalTiers(rows: TierInput[]): TierResult[] {
  const out: TierResult[] = rows.map(() => EMPTY);

  const byPosition = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i += 1) {
    // Number.isFinite, not a null check. A NaN would sail through every
    // comparison below as false, which quietly defeats the size cap: the
    // split scan finds no best candidate and abandons a run of any length.
    if (!Number.isFinite(rows[i].value)) continue;
    const key = rows[i].position;
    const bucket = byPosition.get(key);
    if (bucket) bucket.push(i);
    else byPosition.set(key, [i]);
  }

  for (const indices of byPosition.values()) {
    // Value descending, input order as the stable tie-break.
    const ordered = [...indices].sort((a, b) => {
      const va = rows[a].value as number;
      const vb = rows[b].value as number;
      return vb - va || a - b;
    });

    const values = ordered.map((idx) => rows[idx].value as number);
    const minGap = Math.max(MIN_ABSOLUTE_GAP, values[0] * MIN_GAP_FRACTION);

    // Pass one: the cliffs. `cuts` holds the positions AFTER which a tier ends.
    const cuts = new Set<number>();
    for (let n = 1; n < values.length; n += 1) {
      const prev = values[n - 1];
      const drop = prev - values[n];
      if (drop >= minGap && prev > 0 && drop / prev >= STEP_BREAK_PCT) {
        cuts.add(n - 1);
      }
    }

    // Pass two: cut anything still too wide or too long at its largest gap.
    splitRuns(values, cuts, minGap);

    const tierOf = new Map<number, number>();
    let tier = 1;
    for (let n = 0; n < ordered.length; n += 1) {
      tierOf.set(ordered[n], tier);
      if (cuts.has(n)) tier += 1;
    }

    // Sizes, the tier-opening flag, and the gap to the next player at this
    // position.
    const sizes = new Map<number, number>();
    for (const t of tierOf.values()) sizes.set(t, (sizes.get(t) ?? 0) + 1);

    for (let n = 0; n < ordered.length; n += 1) {
      const idx = ordered[n];
      const value = rows[idx].value as number;
      const t = tierOf.get(idx) as number;
      const nextIdx = ordered[n + 1];
      const nextValue = nextIdx === undefined ? null : (rows[nextIdx].value as number);
      const gapToNext = nextValue === null ? null : value - nextValue;
      out[idx] = {
        tier: t,
        tierSize: sizes.get(t) ?? 1,
        startsTier: n === 0 || tierOf.get(ordered[n - 1]) !== t,
        gapToNext,
        gapToNextPct:
          gapToNext === null || value <= 0 ? null : (gapToNext / value) * 100,
        opensNextTier: nextIdx !== undefined && tierOf.get(nextIdx) !== t,
      };
    }
  }

  return out;
}

/**
 * Pass two: walk every run the cliffs left behind and cut the ones that are
 * still too wide or too long, at their largest internal gap, repeatedly.
 *
 * Iterative rather than recursive, over a worklist, so a 500-row position
 * cannot put 500 frames on the stack. `cuts` is mutated in place: it holds the
 * index AFTER which a tier ends, so a cut at `k` separates [lo..k] from
 * [k+1..hi].
 */
function splitRuns(values: number[], cuts: Set<number>, minGap: number): void {
  const runs: [number, number][] = [];
  let lo = 0;
  for (let n = 0; n < values.length; n += 1) {
    if (cuts.has(n) || n === values.length - 1) {
      runs.push([lo, n]);
      lo = n + 1;
    }
  }

  while (runs.length > 0) {
    const [start, end] = runs.pop() as [number, number];
    const length = end - start + 1;
    if (length < 2) continue;

    const top = values[start];
    const tooWide = top > 0 && (top - values[end]) / top > TIER_SPAN_PCT;
    const tooLong = length > MAX_TIER_SIZE;
    if (!tooWide && !tooLong) continue;

    // The steepest RELATIVE step inside the run, tie-broken toward the
    // midpoint.
    //
    // Relative, not absolute, and that is what stops this degenerating. On a
    // board that decays at a roughly constant percentage there is no cliff
    // anywhere, but the absolute gaps shrink all the way down, so scoring by
    // absolute size makes the topmost gap the winner every single time and
    // the run gets shaved one player at a time from the top: dozens of
    // singleton tiers at the head and one blob at the tail. Scored by
    // percentage, that same curve ties everywhere and the midpoint rule
    // splits it evenly, which is the honest answer for a curve with no cliff
    // in it. Where a real cliff exists it is also the steepest relative step,
    // so nothing changes on a board that has one.
    //
    // The minimum-gap floor below stays ABSOLUTE, because its whole job is to
    // stop a two-point step at the bottom of the board counting as a cliff,
    // and in percentage terms a two-point step down there is enormous.
    const mid = (start + end) / 2;
    let bestAt = -1;
    let bestScore = -1;
    let bestGap = 0;
    let bestDistance = Infinity;
    for (let n = start; n < end; n += 1) {
      const gap = values[n] - values[n + 1];
      const score = values[n] > 0 ? gap / values[n] : 0;
      const distance = Math.abs(n + 0.5 - mid);
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        bestAt = n;
        bestScore = score;
        bestGap = gap;
        bestDistance = distance;
      }
    }

    // A run that is merely wide needs a gap worth calling a cliff. One that is
    // over the size cap is cut whatever the gap looks like, because leaving it
    // whole is not an option.
    if (bestAt < 0) continue;
    if (!tooLong && bestGap < minGap) continue;

    cuts.add(bestAt);
    runs.push([start, bestAt], [bestAt + 1, end]);
  }
}

export type TierBand = {
  tier: number;
  count: number;
  topValue: number;
  bottomValue: number;
  /** Drop from this tier's floor to the next tier's ceiling. Null for the last. */
  cliff: number | null;
};

/**
 * The tier bands for ONE position, for the legend under the board.
 *
 * Takes rows already carrying their tier (the output of the function above
 * zipped back on) and rolls them up. The caller filters to one position first;
 * mixing positions here would produce bands that describe nobody, since tier 2
 * at quarterback and tier 2 at tight end are unrelated groups.
 */
export function tierBands(
  rows: { tier: number | null; value: number | null }[],
): TierBand[] {
  const byTier = new Map<number, number[]>();
  for (const row of rows) {
    if (row.tier === null || row.value === null) continue;
    const bucket = byTier.get(row.tier);
    if (bucket) bucket.push(row.value);
    else byTier.set(row.tier, [row.value]);
  }

  const bands = [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, values]) => ({
      tier,
      count: values.length,
      topValue: Math.max(...values),
      bottomValue: Math.min(...values),
      cliff: null as number | null,
    }));

  for (let i = 0; i < bands.length - 1; i += 1) {
    bands[i].cliff = bands[i].bottomValue - bands[i + 1].topValue;
  }
  return bands;
}

/**
 * The steepest cliff on a board, as "the drop between tier N and tier N+1".
 *
 * Returned in value terms rather than as a percentage because the board's
 * other numbers are values, and a reader comparing "wait one more round" to
 * "trade up" is comparing values. Null when there is no second tier to fall
 * into.
 *
 * A DROP OF ZERO IS NOT A CLIFF and returns null rather than itself. The size
 * cap can force a boundary between two players on identical values (the live
 * receiver list has a run of twelve at 101), and "the fall from tier 4 to
 * tier 5 is 0 points of value, that is the cliff worth reaching a round early
 * for" is a sentence the FAQ would otherwise print.
 */
export function steepestCliff(
  bands: TierBand[],
): { tier: number; drop: number } | null {
  let best: { tier: number; drop: number } | null = null;
  for (const band of bands) {
    if (band.cliff === null || band.cliff <= 0) continue;
    if (!best || band.cliff > best.drop) best = { tier: band.tier, drop: band.cliff };
  }
  return best;
}
