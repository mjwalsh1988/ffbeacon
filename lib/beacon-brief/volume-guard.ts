/**
 * The per-player daily article cap: a backstop, not a feature.
 *
 * Every other duplicate defence in the pipeline is a judgement about one post. This
 * one is a judgement about the shape of a day, and it is here because the 2026-08
 * incident ran for four days before anyone noticed. Six articles about one Jonathan
 * Taylor contract is not a story the site would ever want, whatever the reason, so the
 * pipeline should be able to notice that on its own and stop.
 *
 * It deliberately does NOT try to work out whether the articles are duplicates. That
 * is what the event key is for. This asks a much dumber question, which is why it
 * still works when the smart machinery is broken: has this player already had more
 * articles today than any real news day would produce?
 *
 * WHAT HAPPENS WHEN IT TRIPS
 *
 * The article is not written. The post keeps its Discord card, which has already gone
 * out and stays out, so nothing is lost to the channel. The ingestion is marked
 * filtered with reason 'volume_cap', which puts it in the admin Filtered queue with
 * the existing force-push button, so an override is one click. One email goes out per
 * cooldown window rather than one per capped post.
 *
 * The cap counts articles, not posts, and only articles the Brief itself wrote.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BeaconBriefSettings } from "./settings";

type Admin = SupabaseClient<Database>;

export interface VolumeVerdict {
  /** True when this post must not become an article. */
  capped: boolean;
  /** The player who tripped it, for the log line and the email. */
  playerId?: string;
  playerName?: string;
  /** How many articles that player already has inside the window. */
  count?: number;
  cap?: number;
}

const NOT_CAPPED: VolumeVerdict = { capped: false };

/**
 * Would writing an article for this post push any of its players past the cap?
 *
 * Returns not-capped when the cap is off (0 or less), when the post resolved no
 * players, or on any query error. A failure here must never block publishing: this is
 * a safety net, and a safety net that fails closed is just an outage.
 */
export async function checkArticleVolume(
  admin: Admin,
  settings: BeaconBriefSettings,
  playerIds: string[],
): Promise<VolumeVerdict> {
  const cap = settings.playerArticleCapPerDay;
  if (!Number.isFinite(cap) || cap <= 0) return NOT_CAPPED;
  if (playerIds.length === 0) return NOT_CAPPED;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: recent, error } = await admin
      .from("articles")
      .select("id, article_players!inner(player_id)")
      .eq("origin", "beacon_brief")
      .in("status", ["published", "draft"])
      .gte("created_at", cutoff)
      .in("article_players.player_id", playerIds);
    if (error || !recent) return NOT_CAPPED;

    const counts = new Map<string, number>();
    for (const row of recent) {
      const links = (row.article_players ?? []) as Array<{ player_id: string }>;
      for (const link of links) {
        if (!playerIds.includes(link.player_id)) continue;
        counts.set(link.player_id, (counts.get(link.player_id) ?? 0) + 1);
      }
    }

    let worstId: string | null = null;
    let worstCount = 0;
    for (const [playerId, count] of counts) {
      if (count > worstCount) {
        worstCount = count;
        worstId = playerId;
      }
    }
    if (!worstId || worstCount < cap) return NOT_CAPPED;

    const { data: player } = await admin
      .from("players")
      .select("full_name")
      .eq("id", worstId)
      .maybeSingle();

    return {
      capped: true,
      playerId: worstId,
      playerName: player?.full_name ?? "this player",
      count: worstCount,
      cap,
    };
  } catch {
    return NOT_CAPPED;
  }
}
