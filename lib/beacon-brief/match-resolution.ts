/**
 * The Beacon Brief reference-match resolution.
 *
 * Called from the admin Moderation action when the admin resolves a
 * player_match / team_match row: it writes the chosen real player_id / team_id
 * into article_players / article_teams for that article and closes the row, or
 * dismisses the row with no link. Mirrors the approveDeletion / rejectDeletion
 * shape (throws on error; the action wraps it into an ActionResult).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

/** Link the chosen player/team to the article, then close the moderation row. */
export async function resolveReferenceMatch(
  admin: Admin,
  moderationId: string,
  chosenId: string,
  resolvedBy: string,
): Promise<void> {
  if (!chosenId) throw new Error("Choose a player or team first.");

  const { data: mod } = await admin
    .from("beacon_brief_moderation")
    .select("id, type, status, article_id")
    .eq("id", moderationId)
    .maybeSingle();
  if (!mod || mod.status !== "pending")
    throw new Error("This item is no longer pending.");
  if (mod.type !== "player_match" && mod.type !== "team_match")
    throw new Error("This item is not a reference match.");
  if (!mod.article_id)
    throw new Error(
      "The article is still being written. Try again in a moment.",
    );

  if (mod.type === "player_match") {
    const { data: player } = await admin
      .from("players")
      .select("id")
      .eq("id", chosenId)
      .maybeSingle();
    if (!player) throw new Error("That player no longer exists.");
    const { error } = await admin
      .from("article_players")
      .upsert(
        { article_id: mod.article_id, player_id: chosenId },
        { onConflict: "article_id,player_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  } else {
    const { data: team } = await admin
      .from("nfl_teams")
      .select("id")
      .eq("id", chosenId)
      .maybeSingle();
    if (!team) throw new Error("That team no longer exists.");
    const { error } = await admin
      .from("article_teams")
      .upsert(
        { article_id: mod.article_id, team_id: chosenId },
        { onConflict: "article_id,team_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  }

  await admin
    .from("beacon_brief_moderation")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
      detail: { resolved_ref_id: chosenId } as unknown as Json,
    })
    .eq("id", moderationId)
    .eq("status", "pending");
}

/** Dismiss a reference match: no link is written; the row is closed. */
export async function dismissReferenceMatch(
  admin: Admin,
  moderationId: string,
  resolvedBy: string,
): Promise<void> {
  await admin
    .from("beacon_brief_moderation")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq("id", moderationId)
    .eq("status", "pending")
    .in("type", ["player_match", "team_match"]);
}
