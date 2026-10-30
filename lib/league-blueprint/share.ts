/**
 * The share card model and its one-line description (plan 11.4). Pure.
 *
 * Built FROM a stored BlueprintView and nothing else, so the two image routes
 * draw exactly what the page shows and never run an engine.
 */

import { callLabel } from "./calls";
import type { BlueprintView, StrategyAsset } from "./types";

export type ShareLineupRow = {
  slotLabel: string;
  name: string | null;
  position: string | null;
  sleeperId: string | null;
  value: number | null;
  positionRank: number | null;
  call: string | null;
};

export type BlueprintShareCard = {
  teamName: string;
  /** The league the team plays in; null when the caller did not have it. */
  leagueName: string | null;
  season: string;
  ownerHandle: string | null;
  record: string;
  formatTags: string[];
  statusLabel: string | null;
  valueArchetype: string | null;
  rosterArchetype: string;
  outlook: string | null;
  overall: number;
  grades: Array<{ code: string; grade: number | null }>;
  lineup: ShareLineupRow[];
  valueShare: { pct: number | null; rank: number | null };
  productionShare: { pct: number | null; rank: number | null };
  teamCount: number;
  activity: { band: string; score: number; sellsPct: number; buildsPct: number; holdsPct: number };
  sells: Array<{ name: string; position: string }>;
  buys: Array<{ name: string; position: string }>;
  risers: Array<{ name: string; pct: number }>;
  fallers: Array<{ name: string; pct: number }>;
  moversWindow: string;
  capital: Array<{ season: number; value: number; rank: number | null }> | null;
  priorities: string[];
  strategy: Array<{ label: string; out: string; in: string; verdict: string | null; empty: string | null }>;
  partners: Array<{ teamName: string; handle: string | null }>;
  formatDisplay: string;
  sourceDisplay: string;
  generatedAt: string;
  hasDefenders: boolean;
};

const GRADE_CODE: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  bench: "BN",
  picks: "DC",
};

const names = (assets: StrategyAsset[]) => assets.map((a) => a.label).join(", ");

export function buildBlueprintShareCard(
  view: BlueprintView,
  opts: { leagueName?: string | null } = {},
): BlueprintShareCard {
  const p = (id: string | null) => (id ? (view.players[id] ?? null) : null);
  const r = view.header.record;
  const sells = Object.entries(view.calls)
    .filter(([, c]) => c.call === "sell")
    .map(([id]) => view.players[id])
    .filter(Boolean)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3)
    .map((x) => ({ name: x.name, position: x.position }));
  const buys = view.buys
    .flatMap((g) => g.targets)
    .map((t) => view.players[t.playerId])
    .filter(Boolean)
    .slice(0, 3)
    .map((x) => ({ name: x.name, position: x.position }));
  return {
    teamName: view.header.teamName,
    leagueName: opts.leagueName ?? null,
    season: view.season,
    ownerHandle: view.header.ownerHandle,
    record: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`,
    formatTags: view.header.formatTags.map((t) => t.label),
    statusLabel: view.standing.status?.label ?? null,
    valueArchetype: view.standing.valueArchetype,
    rosterArchetype: view.standing.rosterArchetype,
    outlook: view.standing.outlook?.text ?? null,
    overall: view.standing.overall,
    grades: view.grades.map((g) => ({ code: GRADE_CODE[g.key] ?? g.key, grade: g.grade })),
    lineup: view.lineup.map((l) => {
      const pl = p(l.playerId);
      const call = l.playerId ? view.calls[l.playerId] : undefined;
      return {
        slotLabel: l.slotLabel,
        name: pl?.name ?? null,
        position: pl?.position ?? null,
        sleeperId: pl?.sleeperId ?? null,
        value: pl?.value ?? null,
        positionRank: pl?.positionRank ?? null,
        call: call ? callLabel(call) : null,
      };
    }),
    valueShare: view.shares.value,
    productionShare: view.shares.production,
    teamCount: view.header.teamCount,
    activity: {
      band: view.activity.band,
      score: view.activity.score,
      sellsPct: view.activity.sellsPct,
      buildsPct: view.activity.buildsPct,
      holdsPct: view.activity.holdsPct,
    },
    sells,
    buys,
    risers: view.movers.risers.map((m) => ({ name: view.players[m.playerId]?.name ?? "", pct: m.pct })),
    fallers: view.movers.fallers.map((m) => ({ name: view.players[m.playerId]?.name ?? "", pct: m.pct })),
    moversWindow: view.movers.windowLabel,
    capital: view.capital ? view.capital.seasons.map((s) => ({ season: s.season, value: s.value, rank: s.rank })) : null,
    priorities: view.priorities.map((x) => x.text),
    strategy: view.strategy.map((s) => ({
      label: s.label.split(":")[0],
      out: s.card ? names(s.card.outgoing) : "",
      in: s.card ? names(s.card.incoming) : "",
      verdict: s.card?.verdictLabel ?? null,
      empty: s.card ? null : s.emptyText,
    })),
    partners: view.partners.map((x) => ({ teamName: x.teamName, handle: x.ownerHandle })),
    formatDisplay: view.header.formatDisplay,
    sourceDisplay: view.header.sourceDisplay,
    generatedAt: view.generatedAt,
    hasDefenders: view.hasDefenders,
  };
}

/** One sentence for the Copy image button (plan 11.4). */
export function describeBlueprint(view: BlueprintView): string {
  const parts = [`overall grade ${view.standing.overall.toFixed(1)} of 10`];
  if (view.standing.status) parts.push(view.standing.status.label);
  if (view.standing.valueArchetype) parts.push(view.standing.valueArchetype);
  const first = view.priorities[0]?.text;
  return `${view.header.teamName}'s blueprint: ${parts.join(", ")}${first ? `; first priority: ${first}` : "."}`;
}
