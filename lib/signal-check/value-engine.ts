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
  /** null => no FF Beacon value row for this player+format. */
  value: number | null;
  capturedAt: string | null;
}

export interface ResolvedPickValue {
  /** null => no pick value row for this season+round (+bucket). */
  value: number | null;
  capturedAt: string | null;
}

export interface ValueResolver {
  /** null => player id did not resolve to a known player. */
  player(playerId: string): ResolvedPlayerValue | null;
  /**
   * Resolve a pick value. For pos="unknown", the resolver returns a generic
   * season+round value (e.g. an average of available buckets), NOT a guessed
   * bucket. A bucket is only assumed when evidence supplies one.
   */
  pick(season: number, round: number, pos: PickPosition | "unknown"): ResolvedPickValue;
}

export interface PricedSides {
  sides: Record<SideKey, PricedAsset[]>;
  trace: RuleTraceEntry[];
  valueCapturedAt: string | null;
  hasMissingValues: boolean;
  hasAssumedPicks: boolean;
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
      // We never silently guess a bucket: "unknown" stays generic. assumed is
      // reserved for evidence-derived bucket inference (Sleeper import path).
      assumed: false,
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
  let hasAssumedPicks = false;

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
      if (asset.kind === "pick" && asset.assumed) hasAssumedPicks = true;

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

  return { sides, trace, valueCapturedAt, hasMissingValues, hasAssumedPicks };
}
