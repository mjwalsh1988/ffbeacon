/**
 * Tallies and the room (plan 9). Hurry-Up answers only: incrementTally is
 * called from inside a mode === "hurry_up" branch every time
 * (lib/long-shot/film-room-guard.test.ts). The room figures read tallies
 * for any mode, because Film Room shows that day's Hurry-Up room.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readSleeperId } from "@/lib/ranking-boards";
import type { AnswerEntry, MostGivenDto } from "./types";

type Client = SupabaseClient<Database>;

export const MOST_GIVEN_LIMIT = 5;

export async function incrementTally(admin: Client, promptId: string, playerId: string | null): Promise<void> {
  const { error } = await admin.rpc("long_shot_increment_tally", {
    p_prompt_id: promptId,
    // The RPC treats a null player as a timeout: answered_total moves, no tally row.
    p_player_id: playerId as string,
  });
  if (error) throw new Error(`tally increment failed: ${error.message}`);
}

/** Pure: the top correct answers by count, ties broken by name, count 0 excluded. */
export function rankMostGiven(
  tallies: ReadonlyArray<{ player_id: string; count: number }>,
  answers: readonly AnswerEntry[],
  names: ReadonlyMap<string, { name: string; slug: string | null; sleeperId: string | null; teamCode: string | null }>,
  limit = MOST_GIVEN_LIMIT,
): MostGivenDto[] {
  const tierOf = new Map(answers.map((a) => [a.player_id, a.tier]));
  return tallies
    .filter((t) => t.count > 0 && tierOf.has(t.player_id))
    .map((t) => {
      const info = names.get(t.player_id);
      return {
        playerName: info?.name ?? "Unknown player",
        slug: info?.slug ?? null,
        sleeperId: info?.sleeperId ?? null,
        teamCode: info?.teamCode ?? null,
        tier: tierOf.get(t.player_id)!,
        count: t.count,
      };
    })
    .sort((a, b) => b.count - a.count || a.playerName.localeCompare(b.playerName))
    .slice(0, limit);
}

export interface PlayerInfo {
  name: string;
  slug: string | null;
  sleeperId: string | null;
  teamCode: string | null;
}

export async function loadPlayerInfo(admin: Client, ids: readonly string[]): Promise<Map<string, PlayerInfo>> {
  const out = new Map<string, PlayerInfo>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await admin
      .from("players")
      .select("id, full_name, first_name, last_name, slug, team, external_ids")
      .in("id", unique.slice(i, i + 200));
    if (error) throw new Error(`player info read failed: ${error.message}`);
    for (const p of data ?? []) {
      out.set(p.id, {
        name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        slug: p.slug ?? null,
        sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
        teamCode: p.team ?? null,
      });
    }
  }
  return out;
}

export async function loadRoom(
  admin: Client,
  promptId: string,
  playerId: string | null,
  answers: readonly AnswerEntry[],
): Promise<{ roomCount: number; roomTotal: number; mostGiven: MostGivenDto[] }> {
  const answerIds = answers.map((a) => a.player_id);
  const [promptRes, talliesRes, mineRes] = await Promise.all([
    admin.from("long_shot_prompts").select("answered_total").eq("id", promptId).maybeSingle(),
    answerIds.length > 0
      ? admin
          .from("long_shot_answer_tallies")
          .select("player_id, count")
          .eq("prompt_id", promptId)
          .in("player_id", answerIds)
          .gt("count", 0)
      : Promise.resolve({ data: [] as { player_id: string; count: number }[], error: null }),
    playerId
      ? admin
          .from("long_shot_answer_tallies")
          .select("count")
          .eq("prompt_id", promptId)
          .eq("player_id", playerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (promptRes.error) throw new Error(`room total read failed: ${promptRes.error.message}`);
  if (talliesRes.error) throw new Error(`room tallies read failed: ${talliesRes.error.message}`);
  const tallies = (talliesRes.data ?? []) as { player_id: string; count: number }[];
  // Names only for the candidates that can reach the top five, ties at the
  // boundary included, so the tie-break by name is exact.
  const sorted = tallies.slice().sort((a, b) => b.count - a.count);
  const floor = sorted[MOST_GIVEN_LIMIT - 1]?.count ?? 0;
  const candidates = sorted.filter((t) => t.count >= floor);
  const names = await loadPlayerInfo(
    admin,
    candidates.map((t) => t.player_id),
  );
  return {
    roomCount: (mineRes.data as { count: number } | null)?.count ?? 0,
    roomTotal: promptRes.data?.answered_total ?? 0,
    mostGiven: rankMostGiven(candidates, answers, names),
  };
}
