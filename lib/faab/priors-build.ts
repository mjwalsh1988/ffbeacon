/**
 * What a waiver claim actually clears at, measured across every league we hold.
 *
 * This is the only part of the calculator that speaks for the wider market
 * rather than for one league. It turns real auctions into quantile cells:
 * "a running back, weeks 2 to 6, three teams bidding" clears at this share of
 * budget half the time, this much a quarter of the time, and so on. Manual mode
 * prices straight off these cells, league mode uses them to judge whether a
 * room bids high or low, and the public tables on the calculator and the guides
 * publish them.
 *
 * TWO RULES HOLD EVERYTHING ELSE UP.
 *
 * Every figure is a SHARE OF THE LEAGUE'S FULL BUDGET, 0 to 100. A $12 bid in a
 * $100 league and a $120 bid in a $1,000 league are the same decision, and
 * mixing dollars would let one $1,000 league drown out a hundred $100 ones.
 *
 * NOTHING IDENTIFYING SURVIVES. A cell is a distribution and a count. League
 * ids are read only to count distinct leagues and are never stored; no roster,
 * manager or player id reaches the output. That is what makes the table safe to
 * publish, and it is enforced here rather than at the edge, because the edge is
 * where somebody eventually forgets.
 *
 * Pure: no client, no clock, no I/O.
 */

export type PriorLeagueKind = "redraft" | "dynasty" | "chopped";
export type PriorBidders = "1" | "2" | "3" | "4p";

/** One auction, already reduced to the numbers a price distribution needs. */
export type PriorAuction = {
  leagueKind: PriorLeagueKind;
  superflex: boolean;
  /** Uppercase position, or null when we hold no position for the player. */
  position: string | null;
  week: number;
  /** Chopped only: rosters still alive that week over rosters at the start. */
  aliveFraction: number | null;
  bidderCount: number;
  /** Winning bid as a share of the league's full budget, 0 to 100. */
  winningPct: number;
  /** Second-highest bid on the same terms, null when nobody else bid. */
  runnerUpPct: number | null;
  leagueId: string;
  season: number;
};

export type PriorCellRow = {
  cell_key: string;
  league_kind: PriorLeagueKind | "any";
  superflex: "yes" | "no" | "any";
  position: string;
  phase: string;
  bidders: PriorBidders | "any";
  sample_size: number;
  zero_share: number;
  p05: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  runner_up_ratio_p50: number | null;
  leagues_count: number;
  seasons: number[];
};

/**
 * The positions a prior cell is filed under. DL, LB and DB joined in IDP-124:
 * an IDP auction used to fall into "any" only, which blended linebacker
 * prices into every other position's league-wide rollup with nothing of its
 * own to read (migration 0300 widened the table's CHECK to match).
 */
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);

/** Nearest-rank, matching lib/faab/market.ts. Interpolation on 30 samples is false precision. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(Math.min(1, Math.max(0, p)) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

/**
 * Which stretch of the season an auction belongs to.
 *
 * The bands come from our own priced winning bids: weeks 2 to 6 are the
 * dearest in-season stretch, 7 to 10 the cheapest, and week 14 on the dearest
 * of all because leftover budget is about to be worth nothing.
 */
export function standardPhase(week: number): string | null {
  if (!Number.isFinite(week)) return null;
  if (week <= 0) return null;
  if (week === 1) return "wk1";
  if (week <= 6) return "wk2_6";
  if (week <= 10) return "wk7_10";
  if (week <= 13) return "wk11_13";
  return "wk14p";
}

/** Which stretch of a chopped season, measured by how much of the field is left. */
export function choppedPhase(aliveFraction: number | null): string | null {
  if (aliveFraction === null || !Number.isFinite(aliveFraction)) return null;
  if (aliveFraction >= 0.5) return "alive_50p";
  if (aliveFraction >= 0.3) return "alive_30_50";
  return "alive_lt30";
}

export function biddersKey(count: number): PriorBidders {
  if (count <= 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "3";
  return "4p";
}

/**
 * Is this auction usable for a phase cell?
 *
 * Dynasty weeks 0 and 1 are excluded from the standard phases. In our data
 * 4,570 of them are offseason rookie and startup claims filed months before a
 * game is played, and they would set the price of a week 1 waiver claim in a
 * league that is actually mid-season. They still count toward the `any` phase,
 * where they are a fair part of "what dynasty leagues pay".
 */
function phaseForAuction(auction: PriorAuction): string | null {
  if (auction.leagueKind === "chopped") return choppedPhase(auction.aliveFraction);
  if (auction.leagueKind === "dynasty" && auction.week <= 1) return null;
  return standardPhase(auction.week);
}

function positionKey(position: string | null): string | null {
  if (!position) return null;
  const upper = position.toUpperCase();
  return POSITIONS.has(upper) ? upper : null;
}

type Bucket = {
  amounts: number[];
  ratios: number[];
  zeros: number;
  leagues: Set<string>;
  seasons: Set<number>;
};

function emptyBucket(): Bucket {
  return { amounts: [], ratios: [], zeros: 0, leagues: new Set(), seasons: new Set() };
}

function addTo(bucket: Bucket, auction: PriorAuction): void {
  bucket.amounts.push(auction.winningPct);
  if (auction.winningPct <= 0) bucket.zeros += 1;
  if (auction.runnerUpPct !== null && auction.runnerUpPct > 0 && auction.winningPct > 0) {
    bucket.ratios.push(auction.winningPct / auction.runnerUpPct);
  }
  bucket.leagues.add(auction.leagueId);
  bucket.seasons.add(auction.season);
}

/**
 * Turn auctions into cells.
 *
 * Every dimension is emitted at its own value AND at "any", so a reader whose
 * exact situation is thin can fall back to a coarser cell that still has
 * samples. That is 2 x 2 x 2 x 2 x 2 assignments per auction, which is cheap,
 * and it is what makes the fallback ladder in priors-read.ts possible without
 * a second pass over the data.
 *
 * `minCellSamples` is deliberately NOT applied here. Every cell with at least
 * one auction is emitted and the sample size travels with it, because the
 * reader decides what is enough and the admin can change the threshold without
 * a rebuild.
 */
export function buildPriorCells(
  auctions: PriorAuction[],
  _opts: { minCellSamples: number } = { minCellSamples: 0 },
): PriorCellRow[] {
  const buckets = new Map<string, Bucket>();

  for (const auction of auctions) {
    if (!Number.isFinite(auction.winningPct)) continue;
    // A bid above the league's own budget is a data error, not a 300% bid.
    const pct = Math.min(100, Math.max(0, auction.winningPct));
    const runnerUp =
      auction.runnerUpPct === null || !Number.isFinite(auction.runnerUpPct)
        ? null
        : Math.min(100, Math.max(0, auction.runnerUpPct));
    const clean: PriorAuction = { ...auction, winningPct: pct, runnerUpPct: runnerUp };

    const phase = phaseForAuction(clean);
    const position = positionKey(clean.position);

    const kinds: Array<PriorLeagueKind | "any"> = [clean.leagueKind, "any"];
    const superflexes: Array<"yes" | "no" | "any"> = [clean.superflex ? "yes" : "no", "any"];
    const positions = position ? [position, "any"] : ["any"];
    const phases = phase ? [phase, "any"] : ["any"];
    const bidders: Array<PriorBidders | "any"> = [biddersKey(clean.bidderCount), "any"];

    for (const kind of kinds) {
      for (const sflex of superflexes) {
        for (const pos of positions) {
          for (const ph of phases) {
            for (const bid of bidders) {
              const key = `${kind}|${sflex}|${pos}|${ph}|${bid}`;
              const bucket = buckets.get(key) ?? emptyBucket();
              addTo(bucket, clean);
              buckets.set(key, bucket);
            }
          }
        }
      }
    }
  }

  const rows: PriorCellRow[] = [];
  for (const [key, bucket] of buckets) {
    const [league_kind, superflex, position, phase, bidders] = key.split("|");
    const sorted = [...bucket.amounts].sort((a, b) => a - b);
    const ratios = [...bucket.ratios].sort((a, b) => a - b);
    rows.push({
      cell_key: key,
      league_kind: league_kind as PriorCellRow["league_kind"],
      superflex: superflex as PriorCellRow["superflex"],
      position,
      phase,
      bidders: bidders as PriorCellRow["bidders"],
      sample_size: sorted.length,
      zero_share: sorted.length === 0 ? 0 : bucket.zeros / sorted.length,
      p05: percentile(sorted, 0.05),
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      runner_up_ratio_p50: ratios.length === 0 ? null : percentile(ratios, 0.5),
      leagues_count: bucket.leagues.size,
      seasons: Array.from(bucket.seasons).sort((a, b) => a - b),
    });
  }

  rows.sort((a, b) => a.cell_key.localeCompare(b.cell_key));
  return rows;
}
