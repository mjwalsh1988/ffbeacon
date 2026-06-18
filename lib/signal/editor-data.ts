/**
 * Shared server-side data loaders for the My Signal editor sub-pages and hub.
 * Keeps the owner-signal select in one place (so a column rename is one edit)
 * and centralizes the "which setup steps has the owner completed" logic that
 * drives both the wizard checklist and the card hub.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { hasStoredBlocks } from "@/lib/signal/blocks";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import type { SignalStepKey } from "@/lib/signal/editor-nav";

type Client = SupabaseClient<Database>;

/** The owner's own Signal row, every column the editor surfaces needs. */
export type OwnerSignal = {
  id: string;
  handle: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  accent: string;
  layout: string;
  avatar_path: string | null;
  banner_path: string | null;
  favorite_team: string | null;
  favorite_player_id: string | null;
  links: unknown;
  layout_config: unknown;
  status: "draft" | "published";
  visibility: "public" | "private";
  published_at: string | null;
};

export async function loadOwnerSignal(
  supabase: Client,
  userId: string,
): Promise<OwnerSignal | null> {
  const { data } = await supabase
    .from("signals")
    .select(
      "id, handle, display_name, headline, bio, accent, layout, avatar_path, banner_path, favorite_team, favorite_player_id, links, layout_config, status, visibility, published_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return (data as unknown as OwnerSignal | null) ?? null;
}

export type StepCompletion = Record<SignalStepKey, boolean>;

/**
 * "Has the owner done something meaningful in each step?" These flags power the
 * wizard check marks and the hub card status pills. They are guidance only:
 * nothing here blocks publishing except the handle (without which no other
 * sub-page is reachable). display_name is auto-seeded at claim time, so it does
 * NOT count toward the identity step on its own.
 */
export async function computeStepCompletion(
  supabase: Client,
  userId: string,
  signal: OwnerSignal,
): Promise<StepCompletion> {
  // Featured-league count comes from saved preferences (no Sleeper call).
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", userId)
    .maybeSingle();
  const featuredLeagueCount =
    parseSleeperLeagueSettings(prefs?.sleeper_league_settings).signal_league_ids
      ?.length ?? 0;

  // Wall post count. Owner RLS returns the owner's own posts in any state.
  const { count: wallCount } = await supabase
    .from("signal_posts")
    .select("id", { count: "exact", head: true })
    .eq("signal_id", signal.id);

  // Completion asks "did the owner add anything here", so any link counts. This
  // is deliberately looser than the layout seed (lib/signal/blocks via the
  // layout sub-page), which counts https-only because it must equal what the
  // public resolver renders. Do not reconcile the two; they answer different
  // questions.
  const hasLinks = Array.isArray(signal.links) && signal.links.length > 0;
  const hasFavorites = !!(signal.favorite_team || signal.favorite_player_id);

  return {
    handle: true,
    identity: !!(
      signal.headline ||
      signal.bio ||
      signal.avatar_path ||
      signal.banner_path
    ),
    showcase: hasLinks || hasFavorites || featuredLeagueCount > 0,
    layout: hasStoredBlocks(signal.layout_config),
    wall: (wallCount ?? 0) > 0,
    visibility: signal.status === "published",
  };
}
