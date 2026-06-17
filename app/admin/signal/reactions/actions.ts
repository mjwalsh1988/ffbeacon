"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  REACTION_BUCKET,
  validateReactionType,
  type ReactionKind,
  type ReactionType,
  type ReactionTypeInput,
} from "@/lib/signal/reactions";

/**
 * Admin-only catalog writes for Signal custom reactions. Every action re-validates
 * admin status via requireAdmin (never trusts the client) and writes through the
 * service-role client, since signal_reaction_types has no client write policy.
 *
 * The public Wall is dynamic and the public picker reads the active catalog live,
 * so catalog edits need no cache bust beyond revalidating the admin page itself.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type RowResult = { ok: true; row: ReactionType } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Friendly message for a unique-slug collision. */
function isUniqueViolation(message: string): boolean {
  return /duplicate key value|unique constraint/i.test(message);
}

type RawRow = {
  id: string;
  slug: string;
  label: string;
  kind: string;
  char: string | null;
  image_path: string | null;
  display_order: number;
  is_active: boolean;
};

function toReactionType(r: RawRow): ReactionType {
  return {
    id: r.id,
    slug: r.slug,
    label: r.label,
    kind: r.kind as ReactionKind,
    char: r.char,
    image_path: r.image_path,
    display_order: r.display_order,
    is_active: r.is_active,
  };
}

const ROW_COLUMNS = "id, slug, label, kind, char, image_path, display_order, is_active";

export async function createReactionType(input: ReactionTypeInput): Promise<RowResult> {
  await requireAdmin("/admin/signal/reactions");
  const v = validateReactionType(input);
  if (!v.ok) return fail(v.error);

  const admin = createAdminClient();

  // Append to the end of the display order.
  const { data: last } = await admin
    .from("signal_reaction_types")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.display_order ?? -1) + 1;

  const { data: row, error } = await admin
    .from("signal_reaction_types")
    .insert({
      slug: v.value.slug,
      label: v.value.label,
      kind: v.value.kind,
      char: v.value.char,
      image_path: v.value.image_path,
      display_order: nextOrder,
      is_active: true,
    })
    .select(ROW_COLUMNS)
    .single();
  if (error || !row) {
    if (error && isUniqueViolation(error.message)) {
      return fail("That slug is already taken. Choose a different slug.");
    }
    return fail("Could not create that reaction. Please try again.");
  }
  revalidatePath("/admin/signal/reactions");
  return { ok: true, row: toReactionType(row) };
}

export async function updateReactionType(
  id: string,
  input: ReactionTypeInput,
): Promise<RowResult> {
  await requireAdmin("/admin/signal/reactions");
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that reaction.");
  const v = validateReactionType(input);
  if (!v.ok) return fail(v.error);

  const admin = createAdminClient();

  // If the image is being replaced or the kind switches away from image, clean up
  // the previously stored object so it does not orphan in the bucket.
  const { data: existing } = await admin
    .from("signal_reaction_types")
    .select("kind, image_path")
    .eq("id", id)
    .maybeSingle();

  const { data: row, error } = await admin
    .from("signal_reaction_types")
    .update({
      slug: v.value.slug,
      label: v.value.label,
      kind: v.value.kind,
      char: v.value.char,
      image_path: v.value.image_path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ROW_COLUMNS)
    .single();
  if (error || !row) {
    if (error && isUniqueViolation(error.message)) {
      return fail("That slug is already taken. Choose a different slug.");
    }
    return fail("Could not update that reaction. Please try again.");
  }

  if (
    existing?.image_path &&
    existing.image_path !== v.value.image_path
  ) {
    // Best-effort cleanup; a leftover object is harmless if this fails.
    await admin.storage.from(REACTION_BUCKET).remove([existing.image_path]);
  }

  revalidatePath("/admin/signal/reactions");
  return { ok: true, row: toReactionType(row) };
}

export async function setReactionTypeActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin("/admin/signal/reactions");
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that reaction.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("signal_reaction_types")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail("Could not update that reaction. Please try again.");
  revalidatePath("/admin/signal/reactions");
  return { ok: true };
}

/** Move a reaction one slot up or down. Swaps display_order with the adjacent
 *  row, mirroring moveSource. A no-op at the ends. */
export async function moveReactionType(
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  await requireAdmin("/admin/signal/reactions");
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("signal_reaction_types")
    .select("id, display_order")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !rows) return fail("Could not load reactions.");
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return fail("Unknown reaction.");
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= rows.length) return { ok: true };
  const a = rows[idx];
  const b = rows[targetIdx];

  // display_order can tie (e.g. legacy zeros); use the row index to derive
  // distinct target values so a swap always reorders deterministically.
  const aOrder = a.display_order === b.display_order ? targetIdx : b.display_order;
  const bOrder = a.display_order === b.display_order ? idx : a.display_order;

  const { error: e1 } = await admin
    .from("signal_reaction_types")
    .update({ display_order: aOrder })
    .eq("id", a.id);
  if (e1) return fail("Could not reorder. Please try again.");
  const { error: e2 } = await admin
    .from("signal_reaction_types")
    .update({ display_order: bOrder })
    .eq("id", b.id);
  if (e2) return fail("Could not reorder. Please try again.");
  revalidatePath("/admin/signal/reactions");
  return { ok: true };
}

/**
 * Delete a reaction type. Only succeeds when NO reaction references it (the ON
 * DELETE RESTRICT foreign key from signal_reactions enforces this). A type that
 * has ever been used must be DISABLED instead, so historical counts stay named.
 */
export async function deleteReactionType(id: string): Promise<ActionResult> {
  await requireAdmin("/admin/signal/reactions");
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that reaction.");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("signal_reaction_types")
    .select("kind, image_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await admin.from("signal_reaction_types").delete().eq("id", id);
  if (error) {
    if (/foreign key|violates foreign key constraint|RESTRICT/i.test(error.message)) {
      return fail(
        "This reaction has been used, so it cannot be deleted. Disable it instead to keep its history and counts.",
      );
    }
    return fail("Could not delete that reaction. Please try again.");
  }

  if (existing?.image_path) {
    await admin.storage.from(REACTION_BUCKET).remove([existing.image_path]);
  }

  revalidatePath("/admin/signal/reactions");
  return { ok: true };
}
