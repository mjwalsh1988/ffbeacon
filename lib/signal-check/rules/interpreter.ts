/**
 * Signal Check rule interpreter (deterministic, no code execution).
 *
 * Pure functions: condition matching, value/side action application, the
 * stackability/stack-group selection, and the max-adjustment guardrail. The
 * interpreter NEVER evaluates strings. Every effect is a switch over the
 * enumerated action types validated by rules/schema.ts.
 *
 * Matching uses BASE values for determinism (a rule's threshold does not move
 * as earlier rules adjust the running value). Application moves the RUNNING
 * value, honoring the compounding mode.
 */

import type {
  RuleConditionParsed,
  RuleActionParsed,
  ParsedRule,
} from "./schema";
import type { AssetKind } from "../types";

export interface ConditionContext {
  formatSlug: string;
  assetKind?: AssetKind;
  position?: string | null;
  /** Base value used for threshold matching (not the running value). */
  value?: number;
  pickRound?: number;
  pickSeason?: number;
  assetCount?: number;
  sideTotal?: number;
  /** Fraction 0..1 of the side total held by its single best asset. */
  bestAssetShare?: number;
  tradeShape?: string | null;
}

/**
 * A rule matches when every PRESENT filter passes. A filter that references a
 * field the context does not provide fails the match: rules must be scoped to
 * data they can actually see. This is intentional and conservative.
 */
export function matchCondition(
  cond: RuleConditionParsed,
  ctx: ConditionContext,
): boolean {
  if (cond.formats && !cond.formats.includes(ctx.formatSlug)) return false;

  if (cond.assetKinds) {
    if (!ctx.assetKind || !cond.assetKinds.includes(ctx.assetKind)) return false;
  }

  if (cond.positions) {
    if (!ctx.position || !cond.positions.includes(ctx.position)) return false;
  }

  if (cond.minValue !== undefined) {
    if (ctx.value === undefined || ctx.value < cond.minValue) return false;
  }
  if (cond.maxValue !== undefined) {
    if (ctx.value === undefined || ctx.value > cond.maxValue) return false;
  }

  if (cond.pickRounds) {
    if (ctx.pickRound === undefined || !cond.pickRounds.includes(ctx.pickRound)) {
      return false;
    }
  }
  if (cond.pickSeasons) {
    if (ctx.pickSeason === undefined || !cond.pickSeasons.includes(ctx.pickSeason)) {
      return false;
    }
  }

  if (cond.minAssetCount !== undefined) {
    if (ctx.assetCount === undefined || ctx.assetCount < cond.minAssetCount) return false;
  }
  if (cond.maxAssetCount !== undefined) {
    if (ctx.assetCount === undefined || ctx.assetCount > cond.maxAssetCount) return false;
  }

  if (cond.minSideTotal !== undefined) {
    if (ctx.sideTotal === undefined || ctx.sideTotal < cond.minSideTotal) return false;
  }
  if (cond.maxSideTotal !== undefined) {
    if (ctx.sideTotal === undefined || ctx.sideTotal > cond.maxSideTotal) return false;
  }

  if (cond.minBestAssetShare !== undefined) {
    if (ctx.bestAssetShare === undefined || ctx.bestAssetShare < cond.minBestAssetShare) {
      return false;
    }
  }
  if (cond.maxBestAssetShare !== undefined) {
    if (ctx.bestAssetShare === undefined || ctx.bestAssetShare > cond.maxBestAssetShare) {
      return false;
    }
  }

  if (cond.tradeShape) {
    if (!ctx.tradeShape || !cond.tradeShape.includes(ctx.tradeShape)) return false;
  }

  return true;
}

export type CompoundingMode = "sequential" | "against_base";

export interface AppliedAdjustment {
  /** Signed delta in points applied to the running value. */
  adjustment: number;
  /** Running value after the adjustment. */
  valueAfter: number;
}

/**
 * Clamp a proposed delta against a rule's max_adjustment guardrail. The cap is
 * relative to `base` for pct caps, absolute for points caps.
 */
function clampDelta(delta: number, base: number, max: ParsedRule["maxAdjustment"]): number {
  if (!max) return delta;
  const cap = max.type === "pct" ? Math.abs(base) * (max.value / 100) : max.value;
  if (delta > cap) return cap;
  if (delta < -cap) return -cap;
  return delta;
}

/**
 * Apply an asset-level value action (multiply_pct | add_points | cap_value).
 * Returns null for non-value actions. Never produces a negative value.
 */
export function applyValueAction(
  action: RuleActionParsed,
  base: number,
  running: number,
  mode: CompoundingMode,
  max: ParsedRule["maxAdjustment"],
): AppliedAdjustment | null {
  let rawDelta: number;
  switch (action.type) {
    case "multiply_pct": {
      const ref = mode === "against_base" ? base : running;
      rawDelta = ref * (action.value / 100);
      break;
    }
    case "add_points": {
      rawDelta = action.value;
      break;
    }
    case "cap_value": {
      const capped = Math.min(running, action.value);
      rawDelta = capped - running;
      break;
    }
    default:
      return null;
  }
  const delta = clampDelta(rawDelta, base, max);
  const valueAfter = Math.max(0, running + delta);
  return { adjustment: valueAfter - running, valueAfter };
}

/**
 * Apply a side-level action (side_penalty_pct | side_boost_pct) to a side
 * total. Returns null for non-side actions. Never produces a negative total.
 */
export function applySideAction(
  action: RuleActionParsed,
  sideTotal: number,
  max: ParsedRule["maxAdjustment"],
): AppliedAdjustment | null {
  let rawDelta: number;
  switch (action.type) {
    case "side_penalty_pct":
      rawDelta = -(sideTotal * (action.value / 100));
      break;
    case "side_boost_pct":
      rawDelta = sideTotal * (action.value / 100);
      break;
    default:
      return null;
  }
  const delta = clampDelta(rawDelta, sideTotal, max);
  const valueAfter = Math.max(0, sideTotal + delta);
  return { adjustment: valueAfter - sideTotal, valueAfter };
}

export interface RuleSelection {
  applied: ParsedRule[];
  /** Non-stackable rules dropped because an earlier rule in their group won. */
  skipped: ParsedRule[];
}

/**
 * From a set of rules that already MATCHED a target, decide which actually
 * apply. Stackable rules always apply. Among non-stackable rules that share a
 * non-null stack_group, only the first (by sort_order, then id) applies; the
 * rest are skipped. Non-stackable rules with a null stack_group always apply
 * (they simply do not combine with anything by group).
 */
export function selectApplicableRules(matched: ParsedRule[]): RuleSelection {
  const ordered = [...matched].sort(
    (x, y) => x.sortOrder - y.sortOrder || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  const claimedGroups = new Set<string>();
  const applied: ParsedRule[] = [];
  const skipped: ParsedRule[] = [];
  for (const rule of ordered) {
    if (rule.stackable || rule.stackGroup === null) {
      applied.push(rule);
      continue;
    }
    if (claimedGroups.has(rule.stackGroup)) {
      skipped.push(rule);
      continue;
    }
    claimedGroups.add(rule.stackGroup);
    applied.push(rule);
  }
  return { applied, skipped };
}
