/**
 * Risers and fallers on one roster (plan 6.6). Pure.
 *
 * Built on lib/rankings/insights.ts topMoversFrom, the same math the rankings
 * page's Market Movers uses, with one difference: the value floor is five
 * percent of the FORMAT's top value (one head query in data.ts), not of this
 * roster's best player, so a roster's own star does not set the bar.
 *
 * When fewer than `minGated` of the roster's players pass the 30-day window
 * gate, the 7-day window is used instead and the page says so.
 */

import { moverFloorFor, topMoversFrom, type MoverInput } from "@/lib/rankings/insights";
import type { LeagueBlueprintSettings } from "./default-settings";
import type { BlueprintMovers, Mover } from "./types";

export type RosterTrend = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
  value: number;
  change7d: number | null;
  change7dPct: number | null;
  show7d: boolean;
  rankChange7d: number | null;
  change30d: number | null;
  change30dPct: number | null;
  show30d: boolean;
  rankChange30d: number | null;
};

export const MOVERS_FALLBACK_NOTE = "7 days (30-day history is still building)";

function inputs(rows: readonly RosterTrend[], window: "7d" | "30d"): MoverInput[] {
  return rows.map((r) => ({
    slug: r.playerId,
    name: r.name,
    position: r.position,
    team: r.team,
    sleeper_id: r.sleeperId,
    value: r.value,
    pct: window === "7d" ? r.change7dPct : r.change30dPct,
    rankChange: window === "7d" ? r.rankChange7d : r.rankChange30d,
    show: window === "7d" ? r.show7d : r.show30d,
  }));
}

export function computeMovers(
  rows: readonly RosterTrend[],
  formatTopValue: number,
  settings: LeagueBlueprintSettings["movers"],
): BlueprintMovers {
  let window = settings.window;
  let fallbackNote: string | null = null;
  if (window === "30d" && rows.filter((r) => r.show30d).length < settings.minGated) {
    window = "7d";
    fallbackNote = MOVERS_FALLBACK_NOTE;
  }
  const result = topMoversFrom(inputs(rows, window), {
    limit: settings.limit,
    floor: moverFloorFor(formatTopValue),
  });
  const byId = new Map(rows.map((r) => [r.playerId, r]));
  const toMover = (m: { slug: string; pct: number; rankChange: number | null }): Mover => {
    const r = byId.get(m.slug)!;
    return {
      playerId: m.slug,
      pct: Math.round(m.pct * 10) / 10,
      delta: window === "7d" ? r.change7d : r.change30d,
      rankChange: m.rankChange,
    };
  };
  return {
    risers: result.risers.map(toMover),
    fallers: result.fallers.map(toMover),
    window,
    windowLabel: window === "7d" ? "7 days" : "30 days",
    fallbackNote,
  };
}
