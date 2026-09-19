/**
 * The teaching model behind the playoff guide's worksheet and figures.
 *
 * THIS IS NOT POWER PULSE. Power Pulse simulates a real Sleeper league: real
 * rosters, projected points under the league's own scoring, the real remaining
 * schedule and the league's own bracket. This file answers a smaller question
 * exactly, so a reader can move one input and watch the odds move: in a league
 * of evenly matched opponents, how often does a team with this record and this
 * weekly win chance finish inside the playoff line?
 *
 * The assumptions, which the page states in words wherever the numbers appear:
 *   - Every other team wins each of its games with chance 0.5, so its final win
 *     total is Binomial(seasonWeeks, 0.5), and teams are independent of one
 *     another. A real league is not independent (when two rivals play, one of
 *     them has to lose), which is one reason the real tool simulates instead.
 *   - Your remaining games are won with a fixed chance each week.
 *   - Ties in the standings are broken by a coin flip. Real leagues use points
 *     for, which favours the stronger team, so this slightly understates a good
 *     team and slightly flatters a weak one.
 *   - No median game, no divisions, no byes: one standings table and one line.
 *
 * Everything is closed-form (binomial and multinomial sums), so the output is
 * exact and the same every time, with no seed and nothing to drift.
 */

export type OddsInput = {
  /** Teams in the league, including yours. */
  teams: number;
  /** Teams that make the playoffs. */
  playoffSpots: number;
  /** Regular-season games per team. */
  seasonWeeks: number;
  /** Games already played. */
  weeksPlayed: number;
  /** Your wins so far. Losses are weeksPlayed minus this. */
  wins: number;
  /** Your chance of winning each remaining game, 0 to 1. */
  winChance: number;
};

/** P(X = k) for k = 0..n, X ~ Binomial(n, p). */
export function binomialPmf(n: number, p: number): number[] {
  const out: number[] = [];
  let coeff = 1;
  for (let k = 0; k <= n; k++) {
    out.push(coeff * p ** k * (1 - p) ** (n - k));
    coeff = (coeff * (n - k)) / (k + 1);
  }
  return out;
}

function clampInput(input: OddsInput): OddsInput {
  const teams = Math.max(2, Math.round(input.teams));
  const playoffSpots = Math.min(Math.max(1, Math.round(input.playoffSpots)), teams);
  const seasonWeeks = Math.max(1, Math.round(input.seasonWeeks));
  const weeksPlayed = Math.min(Math.max(0, Math.round(input.weeksPlayed)), seasonWeeks);
  const wins = Math.min(Math.max(0, Math.round(input.wins)), weeksPlayed);
  const winChance = Math.min(Math.max(0, input.winChance), 1);
  return { teams, playoffSpots, seasonWeeks, weeksPlayed, wins, winChance };
}

/**
 * The chance you finish inside the playoff line, 0 to 1.
 *
 * For each final win total w you might reach, each other team independently
 * finishes above you (g), level with you (e) or below you. With G teams above
 * and E level, a coin-flip tiebreak puts you uniformly anywhere in the group of
 * E + 1, so you are in when G plus your place in that group is under the line.
 */
export function playoffOdds(raw: OddsInput): number {
  const input = clampInput(raw);
  const others = input.teams - 1;
  const remaining = input.seasonWeeks - input.weeksPlayed;
  const mine = binomialPmf(remaining, input.winChance);
  const field = binomialPmf(input.seasonWeeks, 0.5);

  // Cumulative tail for the field: above[w] = P(field team finishes with > w).
  const above: number[] = [];
  for (let w = 0; w <= input.seasonWeeks; w++) {
    let s = 0;
    for (let k = w + 1; k <= input.seasonWeeks; k++) s += field[k];
    above.push(s);
  }

  let total = 0;
  for (let extra = 0; extra <= remaining; extra++) {
    const pw = mine[extra];
    if (pw === 0) continue;
    const w = input.wins + extra;
    const g = above[w];
    const e = field[w];
    const l = Math.max(0, 1 - g - e);
    total += pw * chanceInside(others, input.playoffSpots, g, e, l);
  }
  return Math.min(Math.max(total, 0), 1);
}

/** Sum over the multinomial split of the other teams into above, level, below. */
function chanceInside(
  others: number,
  spots: number,
  g: number,
  e: number,
  l: number,
): number {
  let total = 0;
  // Multinomial coefficient built from factorials; others is at most ~20.
  const fact = [1];
  for (let i = 1; i <= others; i++) fact.push(fact[i - 1] * i);
  for (let nAbove = 0; nAbove <= others; nAbove++) {
    if (nAbove >= spots) break; // Already outside the line whatever the ties do.
    for (let nLevel = 0; nLevel + nAbove <= others; nLevel++) {
      const nBelow = others - nAbove - nLevel;
      const prob =
        (fact[others] / (fact[nAbove] * fact[nLevel] * fact[nBelow])) *
        g ** nAbove *
        e ** nLevel *
        l ** nBelow;
      if (prob === 0) continue;
      const placesLeft = spots - nAbove;
      const inside = Math.min(placesLeft, nLevel + 1) / (nLevel + 1);
      total += prob * inside;
    }
  }
  return total;
}

/** The expected final win total. */
export function expectedWins(raw: OddsInput): number {
  const input = clampInput(raw);
  return input.wins + (input.seasonWeeks - input.weeksPlayed) * input.winChance;
}

/** Odds as a whole percent, never rounding a real chance to 0 or 100. */
export function oddsPercent(odds: number): number {
  const pct = Math.round(odds * 100);
  if (pct === 0 && odds > 0) return 1;
  if (pct === 100 && odds < 1) return 99;
  return pct;
}

export type SwingRow = {
  /** The week the game is played. */
  week: number;
  /** Record going into that week, as wins and losses. */
  winsBefore: number;
  lossesBefore: number;
  oddsBefore: number;
  oddsIfWin: number;
  oddsIfLoss: number;
  /** oddsIfWin minus oddsIfLoss, 0 to 1. */
  swing: number;
};

/**
 * What one game is worth, week by week, to a team that is exactly .500 going
 * into it. Only odd weeks qualify, because .500 needs an even number of games
 * already played.
 */
export function swingByWeek(opts: {
  teams: number;
  playoffSpots: number;
  seasonWeeks: number;
  winChance: number;
}): SwingRow[] {
  const rows: SwingRow[] = [];
  for (let week = 1; week <= opts.seasonWeeks; week += 2) {
    const played = week - 1;
    const half = played / 2;
    const base = {
      teams: opts.teams,
      playoffSpots: opts.playoffSpots,
      seasonWeeks: opts.seasonWeeks,
      winChance: opts.winChance,
    };
    const oddsBefore = playoffOdds({ ...base, weeksPlayed: played, wins: half });
    const oddsIfWin = playoffOdds({ ...base, weeksPlayed: week, wins: half + 1 });
    const oddsIfLoss = playoffOdds({ ...base, weeksPlayed: week, wins: half });
    rows.push({
      week,
      winsBefore: half,
      lossesBefore: half,
      oddsBefore,
      oddsIfWin,
      oddsIfLoss,
      swing: oddsIfWin - oddsIfLoss,
    });
  }
  return rows;
}

/* ---------- The deadline call ---------- */

export type OddsBand = "out" | "long-shot" | "bubble" | "likely" | "safe";

export const ODDS_BANDS: { key: OddsBand; label: string; range: string; min: number }[] = [
  { key: "out", label: "Out of it", range: "under 10 percent", min: 0 },
  { key: "long-shot", label: "Long shot", range: "10 to 35 percent", min: 0.1 },
  { key: "bubble", label: "Bubble", range: "35 to 65 percent", min: 0.35 },
  { key: "likely", label: "Likely in", range: "65 to 90 percent", min: 0.65 },
  { key: "safe", label: "Safe", range: "90 percent and up", min: 0.9 },
];

export function oddsBand(odds: number): OddsBand {
  let band: OddsBand = "out";
  for (const b of ODDS_BANDS) if (odds >= b.min) band = b.key;
  return band;
}

/** What kind of league the roster lives in, which decides what "later" is worth. */
export type RosterWindow = "redraft" | "dynasty-young" | "dynasty-veteran";

export const ROSTER_WINDOWS: { key: RosterWindow; label: string }[] = [
  { key: "redraft", label: "Redraft or keeper" },
  { key: "dynasty-young", label: "Dynasty, young core" },
  { key: "dynasty-veteran", label: "Dynasty, veteran core" },
];

export type DeadlineCall = "buy" | "buy-small" | "hold" | "sell";

export const DEADLINE_CALL_LABEL: Record<DeadlineCall, string> = {
  buy: "Buy",
  "buy-small": "Buy small",
  hold: "Hold",
  sell: "Sell",
};

/**
 * The guide's rule of thumb for the deadline, from playoff odds and the kind
 * of roster. It is the page's opinion written as a function so the grid and
 * the worksheet cannot disagree, not a model of anything.
 */
export function deadlineCall(
  band: OddsBand,
  window: RosterWindow,
): { call: DeadlineCall; why: string } {
  if (window === "redraft") {
    switch (band) {
      case "out":
        return {
          call: "hold",
          why: "Nothing carries over and the season is gone, so there is nothing to buy for and nothing worth selling for. Do not hand your best players to a friend. Set a real lineup every week and let the race stay fair.",
        };
      case "long-shot":
        return {
          call: "buy",
          why: "In redraft nothing you hold is worth anything in January, so a long shot has little to lose. Trade depth and bench stashes for starters and push.",
        };
      case "bubble":
        return {
          call: "buy",
          why: "This is where one starter moves the odds the most. Buy the player who fills your weakest lineup slot, and pay with bench depth.",
        };
      case "likely":
        return {
          call: "buy",
          why: "You are probably in, so buy for the playoff weeks rather than for the standings: a starter who raises your ceiling in a one-game round.",
        };
      case "safe":
        return {
          call: "buy-small",
          why: "Your spot is settled. Spend only on upgrades that change your starting lineup in the playoff weeks, and add injury cover at your thinnest position.",
        };
    }
  }
  if (window === "dynasty-young") {
    switch (band) {
      case "out":
      case "long-shot":
        return {
          call: "sell",
          why: "Sell anything older than your core to a contender, and keep the young players. Your season is next year, and your own pick is climbing.",
        };
      case "bubble":
        return {
          call: "hold",
          why: "A young bubble team should not sell youth to chase this season. Add a cheap veteran if one is there, and let next season arrive.",
        };
      case "likely":
      case "safe":
        return {
          call: "buy-small",
          why: "Push, but pay with far-off picks and older depth rather than the young core that makes you good next year too.",
        };
    }
  }
  switch (band) {
    case "out":
    case "long-shot":
      return {
        call: "sell",
        why: "An old roster outside the picture is losing value every week. Sell the veterans now, while contenders are still paying for this season.",
      };
    case "bubble":
      return {
        call: "sell",
        why: "A veteran core on the bubble is the one team with no good reason to wait. Unless one trade puts you clearly in, sell before the price falls.",
      };
    case "likely":
    case "safe":
      return {
        call: "buy",
        why: "This may be your window's last good season. Buy points with picks two years out, and keep one first so the next rebuild is not from zero.",
      };
  }
}

/* ---------- Floor or ceiling in a one-game week ---------- */

export type LineupOption = {
  label: string;
  /** Projected points. */
  mean: number;
  /** Spread of the projection, one standard deviation, in points. */
  sigma: number;
};

/**
 * The invented matchup Lesson 7 uses. Both of your lineups project for the
 * same total; one is steady and one is streaky. The odds come from
 * winProbability in lib/power-pulse/math.ts, the function the Schedules board
 * and the Lineups what-if use for a weekly matchup (Power Pulse computes the
 * same formula inline), so the figure's arithmetic is the product's arithmetic
 * even though the teams are made up.
 */
export const VARIANCE_EXAMPLE = {
  opponentMean: 120,
  opponentSigma: 20,
  underdog: [
    { label: "Steady lineup", mean: 108, sigma: 14 },
    { label: "Streaky lineup", mean: 108, sigma: 28 },
  ] satisfies LineupOption[],
  favorite: [
    { label: "Steady lineup", mean: 132, sigma: 14 },
    { label: "Streaky lineup", mean: 132, sigma: 28 },
  ] satisfies LineupOption[],
} as const;
