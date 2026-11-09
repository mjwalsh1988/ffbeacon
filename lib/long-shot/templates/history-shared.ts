/**
 * Helpers for the history families (plan 31.3). Pure except where noted.
 *
 * Positions by era follow what the rosters hold: QB and RB from the start, WR
 * from 1950 (the 1950 roster lists 30 receivers, the 1935 one a handful) and
 * TE from 1960 (the position first appears on the 1960 roster).
 */

import { positionNoun } from "@/lib/site";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { historyAnswerIds, type HistoryRef } from "../history/answers";
import { FRANCHISES, type Franchise } from "../history/franchises";
import { ELIGIBLE_POSITIONS } from "../types";
import type { Client, GenerationContext } from "./types";

export interface Window {
  from: number;
  to: number;
}

/** Ten-season windows from the floor's decade to the last complete decade. */
export function decadeWindows(floor: number, season: number): Window[] {
  const out: Window[] = [];
  for (let from = Math.ceil(floor / 10) * 10; from + 9 < season; from += 10) out.push({ from, to: from + 9 });
  return out;
}

/** Positions a window may ask about. */
export function eraPositions(from: number): string[] {
  if (from < 1950) return ["QB", "RB"];
  if (from < 1960) return ["QB", "RB", "WR"];
  return [...ELIGIBLE_POSITIONS];
}

/** The four positions, for restricting a history read to people the typeahead can find. */
export const SKILL_POSITIONS: string[] = [...ELIGIBLE_POSITIONS];

export function decadeLabel(w: Window): string {
  return `between ${w.from} and ${w.to}`;
}

export function noun(position: unknown): string {
  return positionNoun(String(position));
}

/** "the Raiders", or the name the franchise carried in that era; both names when a window straddles the change. */
export function franchiseLabel(f: Franchise, to: number, from: number = to): string {
  if (f.key === "commanders" && to < 2022) return "Washington";
  if (f.key === "titans") {
    if (to < 1997) return "the Oilers";
    if (from < 1997) return "the Oilers or Titans";
  }
  return `the ${f.short}`;
}

/** Franchises that existed inside a window. */
export function franchisesIn(w: Window): Franchise[] {
  return FRANCHISES.filter((f) => f.since <= w.to);
}

/** Ran when the pool is synced and the floor allows anything. */
export function historyOpen(ctx: GenerationContext): boolean {
  return ctx.historyReady;
}

type RefRow = { history_player_id: string; history_players: { player_id: string | null } | null };

/** A paged query whose rows are read as T. The builders' own row types carry the embed as an array or object, so the caller's query is read through T here. */
type Page = (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
type TypedPage<T> = Parameters<typeof fetchAllRows<T>>[1];

/** Page a query that returns (history_player_id, history_players(player_id)) and apply the id rule. */
export async function historyIdsFrom(label: string, ctx: GenerationContext, page: Page): Promise<string[]> {
  const rows = await fetchAllRows<RefRow>(label, page as unknown as TypedPage<RefRow>);
  const refs: HistoryRef[] = rows.map((r) => ({ id: r.history_player_id, player_id: r.history_players?.player_id ?? null }));
  return historyAnswerIds(refs, ctx.modernPool);
}

type PlayerRow = { id: string; player_id: string | null };

/** The same for a query straight off history_players. */
export async function historyPlayersFrom(label: string, ctx: GenerationContext, page: Page): Promise<string[]> {
  const rows = await fetchAllRows<PlayerRow>(label, page as unknown as TypedPage<PlayerRow>);
  return historyAnswerIds(rows, ctx.modernPool);
}

export type { Client };
