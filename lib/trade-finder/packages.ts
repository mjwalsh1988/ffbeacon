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
const GIVE_LIMIT = 14;
/** Of those, how many come from the expensive end rather than the cheap one. */
const GIVE_TOP_SLICE = 6;
/** Packages returned per (counterparty, target) pair. */
const MAX_PACKAGES = 3;
/** Assets allowed on the outgoing side. Beyond three it stops being a trade. */
const MAX_OUTGOING = 3;

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
  opts: { goal: TradeGoal; targetPlayerId: string | null; allowPicks: boolean },
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
  const fromTop = Math.min(GIVE_TOP_SLICE, GIVE_LIMIT);
  const fromBottom = GIVE_LIMIT - fromTop;
  return [...ascending.slice(0, fromBottom), ...ascending.slice(ascending.length - fromTop)];
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

/** How the balancing search is allowed to judge a candidate package. */
export type QualityGate = {
  config: TradeQualityConfig;
  poolMax: number | null;
  /** Values of what the reader would receive, which the package must match. */
  incomingValues: number[];
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
  const { ratio } = qualityBalance(
    gate.incomingValues,
    assets.map(assetValue),
    gate.poolMax,
    gate.config,
  );
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
  opts: { required?: AssetRef | null; maxAssets?: number; quality?: QualityGate | null } = {},
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
  const found: AssetRef[][] = [];
  const seenKeys = new Set<string>();

  const consider = (assets: AssetRef[]) => {
    if (found.length >= MAX_PACKAGES) return;
    const total = packageValue(assets);
    if (!withinBand(total, target, overTolerance)) return;
    if (gate && !withinQualityBand(assets, gate)) return;
    const key = assets.map(assetId).sort().join("|");
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    found.push(assets);
  };

  // The required asset on its own, when it already balances.
  if (required) consider([required]);

  // One more asset alongside whatever is required.
  const gap = target - requiredValue;
  if (gap > 0 || !required) {
    for (const a of rest) {
      if (found.length >= MAX_PACKAGES) break;
      consider(required ? [required, a] : [a]);
    }
  }

  // Two more. Pool is ascending, so the inner scan walks up from the outer
  // asset and stops once the total has clearly overshot the band.
  const roomForTwo = maxAssets >= (required ? 3 : 2);
  if (found.length < MAX_PACKAGES && roomForTwo) {
    for (let i = 0; i < rest.length && found.length < MAX_PACKAGES; i += 1) {
      for (let j = i + 1; j < rest.length && found.length < MAX_PACKAGES; j += 1) {
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
  if (found.length === 0 && !required && maxAssets >= 3) {
    for (let i = 0; i < rest.length && found.length < MAX_PACKAGES; i += 1) {
      for (let j = i + 1; j < rest.length && found.length < MAX_PACKAGES; j += 1) {
        if (packageValue([rest[i], rest[j]]) > target * (1 + overTolerance)) break;
        for (let k = j + 1; k < rest.length && found.length < MAX_PACKAGES; k += 1) {
          const combo = [rest[i], rest[j], rest[k]];
          if (packageValue(combo) > target * (1 + overTolerance)) break;
          consider(combo);
        }
      }
    }
  }

  return found;
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
  MAX_PACKAGES,
  MAX_OUTGOING,
  UNDER_TOLERANCE,
  OVER_TOLERANCE,
  QUALITY_RAW_OVER_TOLERANCE,
  QUALITY_UNDER_TOLERANCE,
  QUALITY_OVER_TOLERANCE,
};
