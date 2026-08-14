"use server";

/**
 * Admin write paths for BEAM.
 *
 * Every one of these re-checks requireAdmin() itself rather than trusting the
 * page that rendered the form. A server action is a public endpoint with a
 * generated name: the fact that the only button pointing at it lives behind an
 * admin gate is a UI detail, not a security boundary.
 *
 * All writes go through the service-role client, because beam_settings,
 * beam_queries, and beam_learning_requests have no client policies at all.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BEAM_SETTINGS_ID, validateBeamSettings } from "@/lib/beam/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_STATUSES = ["pending", "planned", "shipped", "declined"] as const;
const ALIAS_KINDS = ["nickname", "shorthand", "misspelling", "initials"] as const;

export async function saveBeamSettings(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beam");

  const validated = validateBeamSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("beam_settings")
    .update({
      settings: validated.settings as never,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", BEAM_SETTINGS_ID);

  if (error) {
    console.error("[admin/beam] settings save failed", error);
    return { ok: false, error: "Could not save. Try again." };
  }
  revalidatePath("/admin/beam");
  return { ok: true };
}

export async function setLearningRequestStatus(
  id: string,
  status: string,
  adminNote?: string,
): Promise<ActionResult> {
  await requireAdmin("/admin/beam/requests");

  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown request." };
  if (!(REQUEST_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Unknown status." };
  }
  const note = (adminNote ?? "").trim();
  if (note.length > 1000) return { ok: false, error: "Keep the note under 1000 characters." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("beam_learning_requests")
    .update({
      status,
      admin_note: note || null,
      // 'pending' means still open, so it clears any earlier resolution stamp
      // rather than leaving a resolved date on an unresolved row.
      resolved_at: status === "pending" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[admin/beam] request status update failed", error);
    return { ok: false, error: "Could not update. Try again." };
  }
  revalidatePath("/admin/beam/requests");
  return { ok: true };
}

export async function deleteLearningRequest(id: string): Promise<ActionResult> {
  await requireAdmin("/admin/beam/requests");
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown request." };

  const admin = createAdminClient();
  const { error } = await admin.from("beam_learning_requests").delete().eq("id", id);
  if (error) {
    console.error("[admin/beam] request delete failed", error);
    return { ok: false, error: "Could not delete. Try again." };
  }
  revalidatePath("/admin/beam/requests");
  return { ok: true };
}

/**
 * Add a nickname.
 *
 * The alias is normalized here with the SAME function the resolver uses on the
 * reader's input. An alias stored with punctuation or a capital letter would
 * simply never match, and the admin would have no way to see why.
 */
export async function addPlayerAlias(input: {
  playerSlug: string;
  alias: string;
  aliasKind: string;
  note?: string;
}): Promise<ActionResult> {
  await requireAdmin("/admin/beam/aliases");

  const { normalizeName } = await import("@/lib/beam/interpret/normalize");
  const alias = normalizeName(input.alias ?? "");
  if (alias.length < 2 || alias.length > 60) {
    return { ok: false, error: "An alias must be between 2 and 60 characters." };
  }
  if (!(ALIAS_KINDS as readonly string[]).includes(input.aliasKind)) {
    return { ok: false, error: "Pick a valid alias kind." };
  }
  const slug = (input.playerSlug ?? "").trim();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    return { ok: false, error: "Pick a player." };
  }
  const note = (input.note ?? "").trim();
  if (note.length > 300) return { ok: false, error: "Keep the note under 300 characters." };

  const admin = createAdminClient();
  const { data: player } = await admin
    .from("players")
    .select("id, search_last_name, full_name")
    .eq("slug", slug)
    .maybeSingle();
  if (!player) return { ok: false, error: "No player with that slug." };

  // A bare surname must not become an alias.
  //
  // An alias sits in a higher resolver tier than the algorithmic surname match,
  // so it wins outright and the collision that should have produced a
  // clarification never gets to argue. The seed data did exactly this and
  // "cook" answered for James Cook with six other Cooks in the table. Tier 4
  // already matches every surname for every player, and it asks when the
  // surname is shared, which is the behaviour an alias would override.
  if (player.search_last_name && alias === player.search_last_name) {
    return {
      ok: false,
      error: `BEAM already matches "${alias}" as a surname on its own, and it asks when more than one player shares it. Adding it as an alias would answer for ${player.full_name ?? "this player"} without asking. Use a real nickname instead.`,
    };
  }

  const { error } = await admin.from("beam_player_aliases").insert({
    player_id: player.id,
    alias,
    alias_kind: input.aliasKind,
    source: "admin",
    note: note || null,
  });

  if (error) {
    // 23505 is the unique violation on (alias, player_id).
    if (error.code === "23505") {
      return { ok: false, error: "That alias already exists for this player." };
    }
    console.error("[admin/beam] alias insert failed", error);
    return { ok: false, error: "Could not add that alias. Try again." };
  }
  revalidatePath("/admin/beam/aliases");
  return { ok: true };
}

export async function setPlayerAliasActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin("/admin/beam/aliases");
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown alias." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("beam_player_aliases")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[admin/beam] alias toggle failed", error);
    return { ok: false, error: "Could not update that alias. Try again." };
  }
  revalidatePath("/admin/beam/aliases");
  return { ok: true };
}

export async function deletePlayerAlias(id: string): Promise<ActionResult> {
  await requireAdmin("/admin/beam/aliases");
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown alias." };

  const admin = createAdminClient();
  const { error } = await admin.from("beam_player_aliases").delete().eq("id", id);
  if (error) {
    console.error("[admin/beam] alias delete failed", error);
    return { ok: false, error: "Could not delete that alias. Try again." };
  }
  revalidatePath("/admin/beam/aliases");
  return { ok: true };
}
