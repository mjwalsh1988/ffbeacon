/**
 * Signal Check value engine (Phase 1 of the pipeline).
 *
 * Resolves each input asset to its FF Beacon base value via an injected
 * ValueResolver (DB-backed in production, faked in tests), and emits one trace
 * entry per asset. FF Beacon values are already format-specific, so there is no
 * format-weighting math here: the "format" step is resolution + provenance, and
 * the trace records which format produced each value.
 *
 * Draft picks are DYNASTY-ONLY. If a pick reaches this engine when the resolved
 * format does not allow picks, that is a server-side validation failure upstream
 * and we throw rather than silently dropping or zero-valuing it.
 */

import type {
  AssetInput,
  PricedAsset,
  PricedPick,
  PricedPlayer,
  PickPosition,
  ResolvedFormat,
  RuleTraceEntry,
  SideKey,
  SidesInput,
} from "./types";
import { SignalCheckError } from "./errors";

export interface ResolvedPlayerValue {
  name: string;
  position: string | null;
  team: string | null;
  /** Sleeper id for the headshot CDN. Optional; defaults to null. */
  sleeperId?: string | null;
  /** null => no FF Beacon value row for this player+format. */
  value: number | null;
  capturedAt: string | null;
}

export interface ResolvedPickValue {
  /** null => no pick value row for this season+round (+bucket). */
  value: number | null;
  capturedAt: string | null;
  /**
   * True when the value is the season+round blend across early/mid/late rather
   * than one slot's own value. The spread is wide (a 2027 1st runs ~6,000 early
   * against ~4,200 late), so this is not a rounding detail: it is the single
   * biggest reason an imported trade and the same trade typed by hand can
   * disagree, and every surface showing the result has to be able to say it.
   */
  blended: boolean;
}

export interface ValueResolver {
  /** null => player id did not resolve to a known player. */
  player(playerId: string): ResolvedPlayerValue | null;
  /**
   * Resolve a pick value. For pos="unknown", the resolver returns a generic
   * season+round value (an average of the current buckets), NOT a guessed
   * bucket, and reports it via `blended`.
   */
  pick(season: number, round: number, pos: PickPosition | "unknown"): ResolvedPickValue;
}

export interface PricedSides {
  sides: Record<SideKey, PricedAsset[]>;
  trace: RuleTraceEntry[];
  valueCapturedAt: string | null;
  hasMissingValues: boolean;
  hasBlendedPicks: boolean;
  hasEstimatedPicks: boolean;
}

const ORDINALS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
  6: "6th",
  7: "7th",
};

function roundOrdinal(round: number): string {
  return ORDINALS[round] ?? `Round ${round}`;
}

function pickLabel(season: number, round: number, pos: PickPosition | "unknown"): string {
  const base = `${season} ${roundOrdinal(round)}`;
  return pos === "unknown" ? base : `${base} (${pos})`;
}

function laterCaptured(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function pricePlayer(
  input: Extract<AssetInput, { kind: "player" }>,
  resolver: ValueResolver,
): { asset: PricedPlayer; capturedAt: string | null } {
  const resolved = resolver.player(input.playerId);
  if (!resolved) {
    return {
      asset: {
        kind: "player",
        assetId: input.playerId,
        playerId: input.playerId,
        name: "Unknown player",
        position: null,
        team: null,
        sleeperId: null,
        baseValue: 0,
        noValue: true,
      },
      capturedAt: null,
    };
  }
  const noValue = resolved.value === null;
  return {
    asset: {
      kind: "player",
      assetId: input.playerId,
      playerId: input.playerId,
      name: resolved.name,
      position: resolved.position,
      team: resolved.team,
      sleeperId: resolved.sleeperId ?? null,
      baseValue: resolved.value ?? 0,
      noValue,
    },
    capturedAt: resolved.capturedAt,
  };
}

function pricePick(
  input: Extract<AssetInput, { kind: "pick" }>,
  resolver: ValueResolver,
): { asset: PricedPick; capturedAt: string | null } {
  const pos: PickPosition | "unknown" = input.pickPosition ?? "unknown";
  const resolved = resolver.pick(input.season, input.round, pos);
  const noValue = resolved.value === null;
  return {
    asset: {
      kind: "pick",
      assetId: `pick:${input.season}:${input.round}:${pos}`,
      season: input.season,
      round: input.round,
      pickPosition: pos,
      label: pickLabel(input.season, input.round, pos),
      baseValue: resolved.value ?? 0,
      noValue,
      // We never silently guess a bucket: "unknown" stays generic, and this
      // records that the price is that blend. It used to be hardcoded false
      // with no code path setting it, so the "treat that pick as an estimate"
      // note it gates could never render and the confidence penalty for a
      // slotless pick never applied.
      blendedValue: resolved.blended,
      // A slot the caller estimated from projected standings. Only meaningful
      // alongside a real bucket; a blend is not an estimated slot, it is no
      // slot, and the two carry different wording and different confidence.
      slotEstimated: input.slotEstimated === true && pos !== "unknown",
    },
    capturedAt: resolved.capturedAt,
  };
}

export function priceSides(
  sidesInput: SidesInput,
  resolver: ValueResolver,
  format: ResolvedFormat,
): PricedSides {
  const sides: Record<SideKey, PricedAsset[]> = { a: [], b: [] };
  const trace: RuleTraceEntry[] = [];
  let valueCapturedAt: string | null = null;
  let hasMissingValues = false;
  let hasBlendedPicks = false;
  let hasEstimatedPicks = false;

  (["a", "b"] as SideKey[]).forEach((side) => {
    for (const input of sidesInput[side]) {
      if (input.kind === "pick" && !format.allowsPicks) {
        throw new SignalCheckError(
          "redraft_picks_not_allowed",
          "Draft picks are dynasty-only and cannot be analyzed in a redraft format.",
        );
      }
      const priced = input.kind === "player" ? pricePlayer(input, resolver) : pricePick(input, resolver);
      const asset = priced.asset;
      sides[side].push(asset);
      valueCapturedAt = laterCaptured(valueCapturedAt, priced.capturedAt);
      if (asset.noValue) hasMissingValues = true;
      if (asset.kind === "pick" && asset.blendedValue) hasBlendedPicks = true;
      if (asset.kind === "pick" && asset.slotEstimated) hasEstimatedPicks = true;

      const display = asset.kind === "player" ? asset.name : asset.label;
      trace.push({
        ruleId: "value-engine",
        ruleVersion: null,
        ruleLabel: "FF Beacon value",
        phase: "value_engine",
        scope: "value",
        side,
        assetId: asset.assetId,
        valueBefore: null,
        adjustment: null,
        valueAfter: asset.baseValue,
        publicExplanation: asset.noValue
          ? `${display} has no FF Beacon value in ${format.display} and is excluded.`
          : `${display} valued in ${format.display}.`,
        adminDebug: `base=${asset.baseValue} format=${format.slug} noValue=${asset.noValue}`,
      });
    }
  });

  return { sides, trace, valueCapturedAt, hasMissingValues, hasBlendedPicks, hasEstimatedPicks };
}
