/**
 * Turning "these two teams should talk" into an actual offer.
 *
 * Two jobs live here. Deciding which assets are even on the table, and building
 * a package that balances against one.
 *
 * WHAT IS ON THE TABLE
 *   A trade suggestion that opens with "give me your best player" is not a
 *   suggestion, it is a joke, and it is the failure mode every naive version of
 *   this feature falls into. So the pool of things a team might part with is
 *   built from what that team's own situation says it can afford to lose:
 *
 *     Anyone who does not make their optimal lineup. He is the piece that can
 *     leave without the team getting worse this week, whoever he is.
 *
 *     A rebuilding team's older starters. A 29-year-old on a team going nowhere
 *     is the asset most likely to be worth less by the time that team is good.
 *
 *     A contending team's young stashes. A 22-year-old who cannot crack the
 *     lineup is exactly what a team chasing January will convert into help.
 *
 *   Everything else stays off the table, which is why the reader never sees an
 *   offer for the other team's best back.
 *
 *   The one exception is deliberate. When the reader names a player they want,
 *   that player is on the table by definition, however untouchable he looks.
 *   Answering "what would it take?" honestly is the whole point of that mode,
 *   and the acceptance band downstream is what says whether the answer is
 *   realistic.
 *
 * BALANCING
 *   Packages are assembled to land inside a band around the target rather than
 *   on an exact number, because trade value is an estimate and pretending
 *   otherwise would reject good deals over rounding. The search is bounded and
 *   deterministic: the same league produces the same packages every time, so a
 *   passed deal stays passed and does not resurface under a new fingerprint.
 *
 *   The search gathers alternatives and then chooses between them, rather than
 *   returning the first three that fit. Returning the first three meant walking
 *   one ordered pool from the same end for every target in the league, which
 *   produced the same answer every time: against real leagues a reader could
 *   hold fourteen tradeable assets and be shown three of them. Given a tally of
 *   what has already been offered, the choice falls on the piece they have not
 *   seen yet.
 *
 * Pure. Every function here takes plain data and returns plain data.
 */

import { qualityBalance, type TradeQualityConfig } from "@/lib/trade-quality";
import type { FinderPick, FinderPlayer, TradeGoal } from "./types";
import type { TeamProfile } from "./profile";

export type AssetRef =
  | { kind: "player"; player: FinderPlayer }
  | { kind: "pick"; pick: FinderPick };

/** Ages past which a position group's decline is the thing everyone can see. */
const SELL_AGE: Record<string, number> = { RB: 26, WR: 28, TE: 29, QB: 32 };
const DEFAULT_SELL_AGE = 28;

/** Age at or under which a player reads as a stash rather than a contributor. */
const STASH_AGE = 24;

/** How many assets from one team the engine will consider acquiring. */
const ACQUIRE_LIMIT = 10;
/** How many of the reader's own assets are eligible currency in one run. */
const GIVE_LIMIT = 18;
/** Of those, how many come from the expensive end rather than the cheap one. */
const GIVE_TOP_SLICE = 4;
/** And how many from the cheap end, which is where most packages are built. */
const GIVE_BOTTOM_SLICE = 8;
/** Packages returned per (counterparty, target) pair. */
const MAX_PACKAGES = 3;
/** Assets allowed on the outgoing side. Beyond three it stops being a trade. */
const MAX_OUTGOING = 3;
/**
 * Packages one target may collect before the search stops looking.
 *
 * The search used to stop at the first three that fit, which is why the same
 * one or two assets paid for nearly every deal in a league: walking one ordered
 * pool from the same end every time returns the same answer every time. It now
 * gathers alternatives first and chooses between them, so this bounds the cost
 * of gathering. Twenty-four is far more than the three it will return, and
 * enough to hold several distinct lead assets on any real roster.
 */
const CANDIDATE_SCAN_CAP = 24;

/**
 * How far off the target a package may land, as a share of the target.
 *
 * Asymmetric on purpose. Overpaying slightly is how trades actually get done, so
 * the ceiling is looser than the floor; a package that comes in under the target
 * is not a deal the other manager takes, it is a lowball.
 *
 * The floor was 12% in the first version and that was too generous, which
 * production data made obvious rather than argument: against real rosters, 12%
 * of a league-winning tight end is a thousand points of value, and the engine
 * cheerfully built three-for-ones where the reader came out a full first-round
 * pick ahead and the top suggestion in two of three test leagues was a deal
 * nobody would answer. Five percent is inside the noise of a value estimate.
 * Beyond that, somebody is being asked to lose on purpose.
 */
const UNDER_TOLERANCE = 0.05;
const OVER_TOLERANCE = 0.15;

/**
 * The raw band once quality scoring is doing the real work.
 *
 * A two-for-one that balances on quality has to overpay on raw value by roughly
 * a third, because that is what consolidation costs. Holding the old 15% raw
 * ceiling alongside the quality test would make every multi-piece package
 * impossible and reduce this feature to suggesting one-for-ones. So the raw band
 * widens to a sanity bound (it exists to stop the search wandering, not to judge
 * fairness) and the quality band below is what decides whether an offer is real.
 */
const QUALITY_RAW_OVER_TOLERANCE = 0.6;

/**
 * How far off level a package may land in quality terms.
 *
 * Under the floor, the reader is paying with pieces that do not add up to the
 * player they are asking for, which is the shape of every lowball this engine
 * used to produce. Over the ceiling, the reader is being told to hand over a
 * clearly better asset, which is the same mistake pointing the other way.
 */
const QUALITY_UNDER_TOLERANCE = 0.08;
const QUALITY_OVER_TOLERANCE = 0.18;

export function assetValue(asset: AssetRef): number {
  return asset.kind === "player" ? asset.player.value : asset.pick.value;
}

export function assetId(asset: AssetRef): string {
  return asset.kind === "player" ? asset.player.playerId : asset.pick.key;
}

function packageValue(assets: AssetRef[]): number {
  return assets.reduce((sum, a) => sum + assetValue(a), 0);
}

/**
 * Would this team's own situation let it move a player it would actually miss?
 *
 * Only asked about players the profile did NOT already call surplus, so this is
 * the second tier: a piece with a real cost attached, where the team's direction
 * is the argument for selling anyway.
 */
function wouldMoveStarter(player: FinderPlayer, profile: TeamProfile): boolean {
  if (profile.direction === "rebuild") {
    const threshold = SELL_AGE[player.position] ?? DEFAULT_SELL_AGE;
    return player.age !== null && player.age >= threshold;
  }
  if (profile.direction === "win-now") {
    return player.age !== null && player.age <= STASH_AGE;
  }
  return false;
}

/**
 * How much the reader wants this player, before any package exists.
 *
 * Value is the floor of it, because a better player is a better player. The
 * position need multiplies it, so a fringe starter at the position the reader
 * actually leaks points from outranks a slightly better player at a position
 * already three deep. Both parts are needed: need alone would chase the
 * cheapest body at the thinnest position.
 */
function appetite(player: FinderPlayer, mine: TeamProfile, goal: TradeGoal): number {
  if (!player.hasValue || player.value <= 0) return 0;
  const need = mine.positionNeed[player.position] ?? 0;
  // Need is in points per week; the scale here turns a two-point-a-week hole
  // into a 1.5x multiplier rather than letting it swamp the value term.
  const needMultiplier = 1 + Math.min(need, 6) * 0.25;

  let goalMultiplier = 1;
  if (goal === "win-now") {
    goalMultiplier = player.projPoints !== null && player.projPoints > 0 ? 1.25 : 0.5;
  } else if (goal === "get-younger") {
    goalMultiplier = player.age !== null && player.age <= 25 ? 1.4 : 0.7;
  } else if (goal === "add-picks") {
    goalMultiplier = 0.8;
  }

  return player.value * needMultiplier * goalMultiplier;
}

/**
 * The assets the reader could plausibly get from one team, best fit first.
 *
 * `targetPlayerId` overrides everything: when the reader has named a player, the
 * only question is what he costs, so the pool is exactly him.
 */
export function acquirablePool(
  theirs: TeamProfile,
  mine: TeamProfile,
  opts: {
    goal: TradeGoal;
    targetPlayerId: string | null;
    allowPicks: boolean;
    /**
     * Value of the single asset the reader is offering, when they are offering
     * one specific piece.
     *
     * This admits the other team's comparable players, whatever their situation
     * says. It is NOT the "give me your best player" failure mode this pool
     * exists to prevent: that shape is a reader paying with spare parts, and
     * this is a reader putting up an equal piece of their own. A swap of two
     * comparable starters is a normal trade and refusing to name it means a
     * roster's best assets can never be traded at all.
     */
    comparableTo?: number | null;
  },
): AssetRef[] {
  if (opts.targetPlayerId) {
    const hit = theirs.team.players.find(
      (p) => p.playerId === opts.targetPlayerId && p.hasValue,
    );
    return hit ? [{ kind: "player", player: hit }] : [];
  }

  const seen = new Set<string>();
  const players: FinderPlayer[] = [];
  for (const p of theirs.surplus) {
    if (seen.has(p.playerId)) continue;
    seen.add(p.playerId);
    players.push(p);
  }
  // Then the expensive ones: players this team would genuinely miss, but whose
  // own situation says they should be selling anyway.
  for (const p of theirs.team.players) {
    if (seen.has(p.playerId) || !p.hasValue || p.value <= 0) continue;
    if (!wouldMoveStarter(p, theirs)) continue;
    seen.add(p.playerId);
    players.push(p);
  }

  // And anyone who simply matches what is being offered.
  if (opts.comparableTo && opts.comparableTo > 0) {
    const floor = opts.comparableTo * (1 - QUALITY_UNDER_TOLERANCE);
    const ceiling = opts.comparableTo * (1 + OVER_TOLERANCE);
    for (const p of theirs.team.players) {
      if (seen.has(p.playerId) || !p.hasValue) continue;
      if (p.value < floor || p.value > ceiling) continue;
      seen.add(p.playerId);
      players.push(p);
    }
  }

  const pool: AssetRef[] = players
    .map((player) => ({ ref: { kind: "player" as const, player }, score: appetite(player, mine, opts.goal) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.ref.player.playerId.localeCompare(b.ref.player.playerId))
    .slice(0, ACQUIRE_LIMIT)
    .map((entry) => entry.ref);

  // Their picks are worth asking for only when the reader is actually collecting
  // them. Otherwise a pick on the incoming side is noise on a roster trying to
  // win games.
  const wantsPicks =
    opts.allowPicks && (opts.goal === "add-picks" || (opts.goal === "balanced" && mine.direction === "rebuild"));
  if (wantsPicks) {
    const picks = [...theirs.team.picks]
      .filter((p) => p.hasValue && p.value > 0)
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
      .slice(0, 3)
      .map((pick) => ({ kind: "pick" as const, pick }));
    pool.push(...picks);
  }

  return pool;
}

/**
 * The assets the reader would part with, cheapest useful currency first.
 *
 * Ordered ascending by value rather than descending, because the balancing
 * search below prefers the smallest package that clears the target, and paying
 * with the least you can get away with is what a good offer looks like.
 */
/**
 * Trim the currency pool to GIVE_LIMIT without capping what the reader can pay.
 *
 * The pool is sorted ascending because the balancing search wants to try the
 * cheapest package that clears the target first. Taking the first N off that
 * list, which is what this used to do, keeps the N CHEAPEST assets and silently
 * discards everything above them. On a deep dynasty roster with more than
 * fourteen tradeable pieces that is a value ceiling nobody intended: the engine
 * could not offer a good player because the good players were never in the pool.
 *
 * So the cut takes from both ends. The cheap end is where most real packages are
 * assembled, so it keeps the larger share; the expensive end is what makes a
 * one-for-one possible at all. Ascending order is preserved on the way out,
 * because the search below depends on it.
 */
function spreadByValue(ascending: AssetRef[]): AssetRef[] {
  if (ascending.length <= GIVE_LIMIT) return ascending;
  const bottom = ascending.slice(0, GIVE_BOTTOM_SLICE);
  const top = ascending.slice(ascending.length - GIVE_TOP_SLICE);
  const middle = ascending.slice(GIVE_BOTTOM_SLICE, ascending.length - GIVE_TOP_SLICE);

  // Taking only the two ends leaves a hole where a deep roster keeps most of its
  // tradeable pieces, and an asset that is not in the pool can never be offered
  // to anybody. So the middle is sampled evenly rather than dropped.
  const want = GIVE_LIMIT - GIVE_BOTTOM_SLICE - GIVE_TOP_SLICE;
  const step = middle.length / want;
  const sampled: AssetRef[] = [];
  for (let i = 0; i < want; i += 1) sampled.push(middle[Math.floor(i * step)]);

  return [...bottom, ...sampled, ...top];
}

export function givablePool(
  mine: TeamProfile,
  opts: { goal: TradeGoal; offerPlayerId: string | null; allowPicks: boolean },
): AssetRef[] {
  const seen = new Set<string>();
  const out: AssetRef[] = [];

  const push = (player: FinderPlayer) => {
    if (seen.has(player.playerId) || !player.hasValue || player.value <= 0) return;
    seen.add(player.playerId);
    out.push({ kind: "player", player });
  };

  for (const p of mine.surplus) push(p);
  for (const p of mine.team.players) {
    if (!wouldMoveStarter(p, mine)) continue;
    push(p);
  }

  // Picks are currency when the reader is buying, and are kept when the reader
  // is collecting them. A rebuilding team trading away its own firsts is the one
  // move this feature should never suggest.
  const spendsPicks =
    opts.allowPicks && opts.goal !== "add-picks" && mine.direction !== "rebuild";
  if (spendsPicks) {
    for (const pick of mine.team.picks) {
      if (!pick.hasValue || pick.value <= 0) continue;
      out.push({ kind: "pick", pick });
    }
  }

  const sorted = spreadByValue(
    out
      .filter((a) => assetId(a) !== opts.offerPlayerId)
      .sort((a, b) => assetValue(a) - assetValue(b) || assetId(a).localeCompare(assetId(b))),
  );

  // A named player the reader wants to move leads the pool, so every package
  // built from it contains him.
  if (opts.offerPlayerId) {
    const offered = mine.team.players.find(
      (p) => p.playerId === opts.offerPlayerId && p.hasValue,
    );
    if (!offered) return [];
    return [{ kind: "player", player: offered }, ...sorted];
  }
  return sorted;
}

/**
 * Every asset the reader could put on the table, best first.
 *
 * Different question from givablePool, and the difference is the whole point.
 * givablePool is CURRENCY: what may be spent to pay for somebody else, which is
 * deliberately restricted to pieces a roster can afford to lose. This is what
 * the reader could OFFER as the headline of a deal, which is anything they own.
 *
 * A manager wondering what their best player is worth is asking a reasonable
 * question, and an engine that can only ever answer it about bench pieces has
 * nothing to say about most of the roster. The pieces here are never used as
 * filler: each one anchors a deal built around it, and the same fairness bands
 * apply, so putting a star on the table still has to come back level.
 *
 * Picks follow the currency rule: a rebuilding team's own picks are never on
 * the table, because that is the one move this feature should not suggest.
 */
export function anchorCandidates(
  mine: TeamProfile,
  opts: { goal: TradeGoal; allowPicks: boolean },
): AssetRef[] {
  const out: AssetRef[] = mine.team.players
    .filter((p) => p.hasValue && p.value > 0)
    .map((player) => ({ kind: "player" as const, player }));

  const spendsPicks =
    opts.allowPicks && opts.goal !== "add-picks" && mine.direction !== "rebuild";
  if (spendsPicks) {
    for (const pick of mine.team.picks) {
      if (!pick.hasValue || pick.value <= 0) continue;
      out.push({ kind: "pick", pick });
    }
  }

  return out.sort(
    (a, b) => assetValue(b) - assetValue(a) || assetId(a).localeCompare(assetId(b)),
  );
}

/** How the balancing search is allowed to judge a candidate package. */
export type QualityGate = {
  config: TradeQualityConfig;
  poolMax: number | null;
  /** Values of the side already fixed, which the package must match. */
  incomingValues: number[];
  /**
   * The package being assembled is what the reader RECEIVES, not what they pay.
   *
   * Used by the coverage search, which starts from an asset the reader is
   * offering and builds the return around it. Without this the band would be
   * read from the wrong seat: a return worth 15% more than the asset would be
   * scored as the reader underpaying by 13%, which is the same trade described
   * backwards. Flipping it here keeps one orientation everywhere, so a quality
   * ratio means the same thing on every suggestion the engine emits.
   */
  reversed?: boolean;
};

function withinBand(total: number, target: number, overTolerance = OVER_TOLERANCE): boolean {
  if (target <= 0) return false;
  return total >= target * (1 - UNDER_TOLERANCE) && total <= target * (1 + overTolerance);
}

/**
 * Does this package actually pay for what it is being offered for?
 *
 * The raw sum says three depth pieces buy a starter. This says they do not, and
 * it is the whole reason the feature stopped suggesting them.
 */
function withinQualityBand(assets: AssetRef[], gate: QualityGate): boolean {
  const values = assets.map(assetValue);
  // qualityBalance reports the SECOND argument over the first, so the reversed
  // gate simply swaps which side is which. The band itself never changes.
  const { ratio } = gate.reversed
    ? qualityBalance(values, gate.incomingValues, gate.poolMax, gate.config)
    : qualityBalance(gate.incomingValues, values, gate.poolMax, gate.config);
  return ratio >= 1 - QUALITY_UNDER_TOLERANCE && ratio <= 1 + QUALITY_OVER_TOLERANCE;
}

/**
 * Packages from `pool` whose combined value lands near `target`.
 *
 * Singles first, then pairs, then triples, and the search stops as soon as it
 * has enough: the smallest package that clears the target is almost always the
 * one a manager would actually send, and a three-for-one that could have been a
 * one-for-one reads as an attempt to bury something.
 *
 * `required` is the named player in "what can I get for him" mode. He appears in
 * every package, and the rest of the pool fills the gap he leaves.
 */
export function balancePackages(
  target: number,
  pool: AssetRef[],
  opts: {
    required?: AssetRef | null;
    maxAssets?: number;
    quality?: QualityGate | null;
    /**
     * How often each asset has already led a suggestion in this run.
     *
     * Variety is decided here rather than by reordering the finished list,
     * because reordering cannot invent an offer the search never built. Given
     * the tally, a target that could be paid for three different ways is paid
     * for with the asset the reader has not been shown yet.
     */
    usage?: ReadonlyMap<string, number>;
  } = {},
): AssetRef[][] {
  const required = opts.required ?? null;
  const maxAssets = Math.min(opts.maxAssets ?? MAX_OUTGOING, MAX_OUTGOING);
  if (target <= 0 || maxAssets < 1) return [];

  const gate = opts.quality ?? null;
  // With a quality gate the raw band stops being the fairness test and becomes
  // a search bound, so it widens: consolidation genuinely costs a raw premium
  // and the old ceiling would reject every package that pays one.
  const overTolerance = gate ? QUALITY_RAW_OVER_TOLERANCE : OVER_TOLERANCE;

  const rest = pool.filter((a) => !required || assetId(a) !== assetId(required));
  const requiredValue = required ? assetValue(required) : 0;
  const candidates: AssetRef[][] = [];
  const seenKeys = new Set<string>();
  const full = () => candidates.length >= CANDIDATE_SCAN_CAP;

  const consider = (assets: AssetRef[]) => {
    if (full()) return;
    const total = packageValue(assets);
    if (!withinBand(total, target, overTolerance)) return;
    if (gate && !withinQualityBand(assets, gate)) return;
    const key = assets.map(assetId).sort().join("|");
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    candidates.push(assets);
  };

  // The required asset on its own, when it already balances.
  if (required) consider([required]);

  // One more asset alongside whatever is required.
  const gap = target - requiredValue;
  if (gap > 0 || !required) {
    for (const a of rest) {
      if (full()) break;
      consider(required ? [required, a] : [a]);
    }
  }

  // Two more. Pool is ascending, so the inner scan walks up from the outer
  // asset and stops once the total has clearly overshot the band.
  const roomForTwo = maxAssets >= (required ? 3 : 2);
  if (roomForTwo) {
    for (let i = 0; i < rest.length && !full(); i += 1) {
      for (let j = i + 1; j < rest.length && !full(); j += 1) {
        const combo = required
          ? [required, rest[i], rest[j]]
          : [rest[i], rest[j]];
        const total = packageValue(combo);
        if (total > target * (1 + overTolerance)) break;
        consider(combo);
      }
    }
  }

  // Three, only when nothing smaller worked and the shape allows it.
  if (candidates.length === 0 && !required && maxAssets >= 3) {
    for (let i = 0; i < rest.length && !full(); i += 1) {
      for (let j = i + 1; j < rest.length && !full(); j += 1) {
        if (packageValue([rest[i], rest[j]]) > target * (1 + overTolerance)) break;
        for (let k = j + 1; k < rest.length && !full(); k += 1) {
          const combo = [rest[i], rest[j], rest[k]];
          if (packageValue(combo) > target * (1 + overTolerance)) break;
          consider(combo);
        }
      }
    }
  }

  return chooseVaried(candidates, target, required, opts.usage);
}

/** The piece a package leads with: the most valuable thing in it. */
export function anchorOf(assets: AssetRef[]): AssetRef | null {
  let best: AssetRef | null = null;
  for (const a of assets) {
    if (!best) {
      best = a;
      continue;
    }
    const diff = assetValue(a) - assetValue(best);
    // Ties resolve by id so the anchor of a package never depends on the order
    // the search happened to build it in.
    if (diff > 0 || (diff === 0 && assetId(a) < assetId(best))) best = a;
  }
  return best;
}

/**
 * Pick which of the balanced packages to return.
 *
 * Ordered by how often the reader has already been shown the package's lead
 * asset, then by the qualities that made the old first-fit search reasonable:
 * fewer pieces beats more, and closer to the target beats further away. So a
 * clean one-for-one still wins whenever the lead asset is equally fresh, and
 * the tie is broken by the asset nobody has seen yet rather than by whichever
 * one happened to sit lowest in the list.
 *
 * The returned packages lead with DIFFERENT assets wherever the roster allows
 * it, so the alternatives behind a suggestion are real alternatives rather than
 * the same player at three slightly different prices.
 *
 * When the caller has pinned an asset (the "what can I get for him" mode), the
 * pinned piece is in every package by definition, so variety is measured on
 * what comes with it instead.
 */
function chooseVaried(
  candidates: AssetRef[][],
  target: number,
  required: AssetRef | null,
  usage?: ReadonlyMap<string, number>,
): AssetRef[][] {
  if (candidates.length === 0) return [];

  const requiredId = required ? assetId(required) : null;
  const leadOf = (assets: AssetRef[]): string => {
    const varying = requiredId
      ? assets.filter((a) => assetId(a) !== requiredId)
      : assets;
    const anchor = anchorOf(varying.length > 0 ? varying : assets);
    return anchor ? assetId(anchor) : "";
  };

  const scored = candidates.map((assets) => {
    const lead = leadOf(assets);
    return {
      assets,
      lead,
      uses: usage?.get(lead) ?? 0,
      size: assets.length,
      distance: Math.abs(packageValue(assets) - target),
      key: assets.map(assetId).sort().join("|"),
    };
  });

  scored.sort(
    (a, b) =>
      a.uses - b.uses ||
      a.size - b.size ||
      a.distance - b.distance ||
      a.key.localeCompare(b.key),
  );

  const out: AssetRef[][] = [];
  const takenLeads = new Set<string>();
  for (const s of scored) {
    if (out.length >= MAX_PACKAGES) break;
    if (takenLeads.has(s.lead)) continue;
    takenLeads.add(s.lead);
    out.push(s.assets);
  }
  // A roster with only one asset in the right range still gets its alternatives,
  // it just cannot vary the piece they lead with.
  for (const s of scored) {
    if (out.length >= MAX_PACKAGES) break;
    if (out.includes(s.assets)) continue;
    out.push(s.assets);
  }
  return out;
}

/**
 * Incoming pairs, for the reader who wants one big name turned into two
 * starters. Bounded to the top of the pool because a depth trade is only
 * interesting when both pieces are worth starting.
 */
export function incomingPairs(
  pool: AssetRef[],
  target: number,
  overTolerance = OVER_TOLERANCE,
): AssetRef[][] {
  const players = pool.filter((a) => a.kind === "player").slice(0, 6);
  const out: AssetRef[][] = [];
  for (let i = 0; i < players.length && out.length < MAX_PACKAGES; i += 1) {
    for (let j = i + 1; j < players.length && out.length < MAX_PACKAGES; j += 1) {
      const pair = [players[i], players[j]];
      if (withinBand(packageValue(pair), target, overTolerance)) out.push(pair);
    }
  }
  return out;
}

export const PACKAGE_LIMITS = {
  ACQUIRE_LIMIT,
  GIVE_LIMIT,
  GIVE_TOP_SLICE,
  GIVE_BOTTOM_SLICE,
  CANDIDATE_SCAN_CAP,
  MAX_PACKAGES,
  MAX_OUTGOING,
  UNDER_TOLERANCE,
  OVER_TOLERANCE,
  QUALITY_RAW_OVER_TOLERANCE,
  QUALITY_UNDER_TOLERANCE,
  QUALITY_OVER_TOLERANCE,
};
