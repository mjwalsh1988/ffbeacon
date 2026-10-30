/**
 * Trade strategy board: downtier, uptier, pivot (plan 6.10).
 *
 * The trade finder's own suggestions, classified by shape, the best one per
 * shape kept. An empty downtier or uptier gets ONE more finder run with the
 * matching goal ("split-assets" or "consolidate", which the engine enforces
 * with the same TIER_JUMP this file classifies with); a pivot has no goal and
 * stays empty when the base run had none. At most `maxRuns` finder runs per
 * build. The chosen cards are graded in one Signal Check batch.
 *
 * The finder and the grader are injected so this file is testable; data.ts
 * wires the real ones. Nothing here decides who the reader is: the build runs
 * for the viewed roster with no per-viewer inputs (see types.ts rule 3).
 */

import { noticeText } from "@/lib/trade-finder/notice";
import { TIER_JUMP } from "@/lib/trade-finder/rank";
import type {
  FinderPick,
  SuggestionAsset,
  TradeFinderResult,
  TradeGoal,
  TradeSuggestion,
} from "@/lib/trade-finder/types";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { BuildAsset } from "@/lib/trade-impact/types";
import type { StrategyAsset, StrategyCard, StrategyEntry, TradeShape } from "./types";

export const SHAPE_LABEL: Record<TradeShape, string> = {
  downtier: "Downtier: one star out, two starters back.",
  uptier: "Uptier: two pieces out, one difference-maker in.",
  pivot: "Pivot: one for one at a position you need.",
};

const SHAPE_WORD: Record<TradeShape, string> = {
  downtier: "downtier",
  uptier: "uptier",
  pivot: "pivot",
};

const SHAPES: TradeShape[] = ["downtier", "uptier", "pivot"];

const topValue = (assets: SuggestionAsset[]) => assets.reduce((m, a) => Math.max(m, a.value), 0);

export function classifyShape(s: TradeSuggestion, pivotGapPct: number): TradeShape | null {
  const out = s.outgoing;
  const inc = s.incoming;
  if (out.length === 1 && inc.length >= 2) return "downtier";
  if (out.length >= 2 && inc.length === 1 && topValue(inc) >= TIER_JUMP * topValue(out)) return "uptier";
  if (
    out.length === 1 &&
    inc.length === 1 &&
    out[0].kind === "player" &&
    inc[0].kind === "player" &&
    inc[0].position !== out[0].position &&
    Math.abs(inc[0].value - out[0].value) <= pivotGapPct * out[0].value
  ) {
    return "pivot";
  }
  return null;
}

/** Highest score per shape. */
export function bestByShape(
  suggestions: readonly TradeSuggestion[],
  pivotGapPct: number,
): Partial<Record<TradeShape, TradeSuggestion>> {
  const out: Partial<Record<TradeShape, TradeSuggestion>> = {};
  for (const s of suggestions) {
    const shape = classifyShape(s, pivotGapPct);
    if (!shape) continue;
    if (!out[shape] || s.score > out[shape]!.score) out[shape] = s;
  }
  return out;
}

function toBuildAsset(a: SuggestionAsset, picks: ReadonlyMap<string, FinderPick>): BuildAsset | null {
  if (a.kind === "player") return { kind: "player", playerId: a.playerId };
  const p = picks.get(a.key);
  if (!p) return null;
  return {
    kind: "pick",
    season: p.season,
    round: p.round,
    pickPosition: p.pickPosition,
    originalRosterId: p.originalRosterId,
  };
}

function toStrategyAsset(a: SuggestionAsset): StrategyAsset {
  return a.kind === "player"
    ? { playerId: a.playerId, label: a.name, position: a.position, value: a.value }
    : { playerId: null, label: a.label, position: null, value: a.value };
}

/**
 * Signal Check names the sides "Side A" (what the reader receives, so the
 * reader) and "Side B". On this page the reader is "you".
 */
export function readerVerdict(label: string): string {
  return label
    .replace(/\bSide A wins\b/g, "You win")
    .replace(/\bSide B wins\b/g, "They win")
    .replace(/\bSide A\b/g, "you")
    .replace(/\bSide B\b/g, "them");
}

export type StrategyDeps = {
  /** One finder run for the viewed roster; `goal` undefined is the base run. */
  run: (goal?: TradeGoal) => TradeFinderResult;
  grade: (suggestions: TradeSuggestion[]) => Promise<(SuggestionGrade | null)[]>;
  myRosterId: number;
  picks: ReadonlyMap<string, FinderPick>;
  maxRuns: number;
  pivotGapPct: number;
};

export type StrategyBuild = {
  entries: StrategyEntry[];
  /** Every player id the cards name, so data.ts can store them once. */
  playerIds: string[];
  runs: number;
};

export async function buildStrategy(deps: StrategyDeps): Promise<StrategyBuild> {
  let runs = 1;
  const base = deps.run();
  const chosen = bestByShape(base.suggestions, deps.pivotGapPct);
  const notices: Partial<Record<TradeShape, string | null>> = {};

  for (const [shape, goal] of [
    ["downtier", "split-assets"],
    ["uptier", "consolidate"],
  ] as const) {
    if (chosen[shape] || runs >= deps.maxRuns) continue;
    runs += 1;
    const extra = deps.run(goal);
    const best = bestByShape(extra.suggestions, deps.pivotGapPct)[shape];
    if (best) chosen[shape] = best;
    else notices[shape] = noticeText(extra.notice);
  }
  if (!chosen.pivot) notices.pivot = noticeText(base.notice);

  const picked = SHAPES.map((s) => chosen[s]).filter((s): s is TradeSuggestion => !!s);
  const grades = picked.length > 0 ? await deps.grade(picked) : [];
  const gradeOf = new Map(picked.map((s, i) => [s.key, grades[i] ?? null]));

  const playerIds = new Set<string>();
  const entries: StrategyEntry[] = SHAPES.map((shape) => {
    const s = chosen[shape];
    if (!s) {
      const notice = notices[shape];
      return {
        shape,
        label: SHAPE_LABEL[shape],
        card: null,
        emptyText: `No ${SHAPE_WORD[shape]} worth proposing this week.${notice ? ` ${notice}` : ""}`,
      };
    }
    const incoming = s.incoming.map((a) => toBuildAsset(a, deps.picks));
    const outgoing = s.outgoing.map((a) => toBuildAsset(a, deps.picks));
    for (const a of [...s.incoming, ...s.outgoing]) if (a.kind === "player") playerIds.add(a.playerId);
    const g = gradeOf.get(s.key) ?? null;
    const card: StrategyCard = {
      headline: s.headline,
      counterpartyRosterId: s.counterparty.rosterId,
      counterpartyTeamName: s.counterparty.teamName,
      counterpartyHandle: s.counterparty.ownerHandle,
      outgoing: s.outgoing.map(toStrategyAsset),
      incoming: s.incoming.map(toStrategyAsset),
      verdictLabel: g ? readerVerdict(g.verdictLabel) : null,
      confidenceLabel: g?.confidenceLabel ?? null,
      winsDelta: s.mine.winsDelta,
      valueDelta: Math.round(s.mine.valueDelta),
      acceptance: s.acceptance,
      proposal: {
        myRosterId: deps.myRosterId,
        theirRosterId: s.counterparty.rosterId,
        incoming: incoming.filter((a): a is BuildAsset => a !== null),
        outgoing: outgoing.filter((a): a is BuildAsset => a !== null),
      },
    };
    return { shape, label: SHAPE_LABEL[shape], card, emptyText: null };
  });
  return { entries, playerIds: [...playerIds], runs };
}
