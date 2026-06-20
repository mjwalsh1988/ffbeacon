"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { GuideEntry, GuideEntryKind } from "@/lib/guide/types";
import {
  validateEntryInput,
  validatePageMeta,
  type GuideEntryInput,
  type GuidePageMetaInput,
} from "@/lib/guide/validate";

/**
 * Admin-only writes for the Signal Guide. Every action re-validates admin status
 * via requireAdmin (never trusts the client) and writes through the service-role
 * client, since guide_pages / guide_entries have no client write policy. The
 * pageKey arguments drive cache revalidation only; they are not a security
 * boundary (requireAdmin is).
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type RowResult = { ok: true; row: GuideEntry } | { ok: false; error: string };

const ADMIN_ROOT = "/admin/signal-guide";
const ENTRY_COLUMNS =
  "id, page_id, kind, heading, body, display_order, is_published, is_global";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function managePath(pageKey: string): string {
  return `${ADMIN_ROOT}/${encodeURIComponent(pageKey)}`;
}

function revalidate(pageKey: string) {
  revalidatePath(ADMIN_ROOT);
  revalidatePath(managePath(pageKey));
}

type RawEntry = {
  id: string;
  page_id: string;
  kind: string;
  heading: string;
  body: string;
  display_order: number;
  is_published: boolean;
  is_global: boolean;
};

function toEntry(r: RawEntry): GuideEntry {
  return {
    id: r.id,
    page_id: r.page_id,
    kind: r.kind as GuideEntryKind,
    heading: r.heading,
    body: r.body,
    display_order: r.display_order,
    is_published: r.is_published,
    is_global: r.is_global,
  };
}

/**
 * Next display_order at the end of an ordering group. Page-specific entries are
 * grouped by (page_id, kind, is_global=false); global entries are grouped by
 * (is_global=true, kind) across all pages.
 */
async function nextOrderForGroup(
  admin: ReturnType<typeof createAdminClient>,
  pageId: string,
  kind: GuideEntryKind,
  isGlobal: boolean,
): Promise<number> {
  let q = admin
    .from("guide_entries")
    .select("display_order")
    .eq("kind", kind)
    .eq("is_global", isGlobal);
  q = isGlobal ? q : q.eq("page_id", pageId);
  const { data: last } = await q
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (last?.display_order ?? -1) + 1;
}

/** Resolve a page_key to its row id, or null when unknown. */
async function pageIdForKey(
  admin: ReturnType<typeof createAdminClient>,
  pageKey: string,
): Promise<string | null> {
  const { data } = await admin
    .from("guide_pages")
    .select("id")
    .eq("page_key", pageKey)
    .maybeSingle();
  return data?.id ?? null;
}

export async function createEntry(
  pageKey: string,
  input: GuideEntryInput,
): Promise<RowResult> {
  await requireAdmin(ADMIN_ROOT);
  const v = validateEntryInput(input);
  if (!v.ok) return fail(v.error);

  const admin = createAdminClient();
  const pageId = await pageIdForKey(admin, pageKey);
  if (!pageId) return fail("Could not find that page.");

  // Append to the end of the correct ordering group (page-specific vs global).
  const nextOrder = await nextOrderForGroup(admin, pageId, v.value.kind, v.value.isGlobal);

  const { data: row, error } = await admin
    .from("guide_entries")
    .insert({
      page_id: pageId,
      kind: v.value.kind,
      heading: v.value.heading,
      body: v.value.body,
      display_order: nextOrder,
      is_published: true,
      is_global: v.value.isGlobal,
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error || !row) return fail("Could not save that entry. Please try again.");

  revalidate(pageKey);
  return { ok: true, row: toEntry(row) };
}

export async function updateEntry(
  id: string,
  pageKey: string,
  input: GuideEntryInput,
): Promise<RowResult> {
  await requireAdmin(ADMIN_ROOT);
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that entry.");
  const v = validateEntryInput(input);
  if (!v.ok) return fail(v.error);

  const admin = createAdminClient();

  // Load the current row so we can tell whether the global flag is changing.
  const { data: current } = await admin
    .from("guide_entries")
    .select("page_id, kind, is_global")
    .eq("id", id)
    .maybeSingle();
  if (!current) return fail("Could not find that entry.");

  // kind is intentionally NOT updated here: the manager edits an entry within its
  // fixed section, so kind never changes. Writing it would risk a display_order
  // that collides in the other kind's sequence.
  const update: {
    heading: string;
    body: string;
    updated_at: string;
    is_global?: boolean;
    display_order?: number;
  } = {
    heading: v.value.heading,
    body: v.value.body,
    updated_at: new Date().toISOString(),
  };

  // If the entry is moving between page-specific and global, re-flag it and append
  // it to the end of the destination ordering group so orders never collide.
  if (current.is_global !== v.value.isGlobal) {
    update.is_global = v.value.isGlobal;
    update.display_order = await nextOrderForGroup(
      admin,
      current.page_id,
      current.kind as GuideEntryKind,
      v.value.isGlobal,
    );
  }

  const { data: row, error } = await admin
    .from("guide_entries")
    .update(update)
    .eq("id", id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error || !row) return fail("Could not update that entry. Please try again.");

  revalidate(pageKey);
  return { ok: true, row: toEntry(row) };
}

export async function setEntryPublished(
  id: string,
  pageKey: string,
  isPublished: boolean,
): Promise<ActionResult> {
  await requireAdmin(ADMIN_ROOT);
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that entry.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("guide_entries")
    .update({ is_published: isPublished, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail("Could not update that entry. Please try again.");
  revalidate(pageKey);
  return { ok: true };
}

/**
 * Move an entry one slot up or down within its own page+kind ordering. Swaps
 * display_order with the adjacent sibling, mirroring moveReactionType. A no-op at
 * the ends.
 */
export async function moveEntry(
  id: string,
  pageKey: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  await requireAdmin(ADMIN_ROOT);
  const admin = createAdminClient();

  const { data: self } = await admin
    .from("guide_entries")
    .select("id, page_id, kind, is_global")
    .eq("id", id)
    .maybeSingle();
  if (!self) return fail("Unknown entry.");

  // Reorder within the entry's own group: global entries order across all pages by
  // (is_global, kind); page-specific entries order within (page_id, kind).
  let groupQuery = admin
    .from("guide_entries")
    .select("id, display_order")
    .eq("kind", self.kind)
    .eq("is_global", self.is_global);
  groupQuery = self.is_global ? groupQuery : groupQuery.eq("page_id", self.page_id);
  const { data: rows, error } = await groupQuery
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !rows) return fail("Could not load entries.");

  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return fail("Unknown entry.");
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= rows.length) return { ok: true };

  const a = rows[idx];
  const b = rows[targetIdx];
  // display_order can tie on legacy rows; derive distinct targets from index so a
  // swap always reorders deterministically.
  const aOrder = a.display_order === b.display_order ? targetIdx : b.display_order;
  const bOrder = a.display_order === b.display_order ? idx : a.display_order;

  const { error: e1 } = await admin
    .from("guide_entries")
    .update({ display_order: aOrder })
    .eq("id", a.id);
  if (e1) return fail("Could not reorder. Please try again.");
  const { error: e2 } = await admin
    .from("guide_entries")
    .update({ display_order: bOrder })
    .eq("id", b.id);
  if (e2) return fail("Could not reorder. Please try again.");

  revalidate(pageKey);
  return { ok: true };
}

export async function deleteEntry(id: string, pageKey: string): Promise<ActionResult> {
  await requireAdmin(ADMIN_ROOT);
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that entry.");
  const admin = createAdminClient();
  const { error } = await admin.from("guide_entries").delete().eq("id", id);
  if (error) return fail("Could not delete that entry. Please try again.");
  revalidate(pageKey);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Community question submissions (the "I couldn't find my answer" queue).
// ---------------------------------------------------------------------------

const SUBMISSIONS_ROOT = "/admin/signal-guide/submissions";

function revalidateSubmissions() {
  revalidatePath(SUBMISSIONS_ROOT);
  revalidatePath(ADMIN_ROOT);
}

/** Mark a submission denied (removed from the pending queue, kept for the record). */
export async function denySubmission(id: string): Promise<ActionResult> {
  await requireAdmin(SUBMISSIONS_ROOT);
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that submission.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("guide_question_submissions")
    .update({ status: "denied", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail("Could not update that submission. Please try again.");
  revalidateSubmissions();
  return { ok: true };
}

/** Permanently delete a submission row. */
export async function deleteSubmission(id: string): Promise<ActionResult> {
  await requireAdmin(SUBMISSIONS_ROOT);
  if (typeof id !== "string" || id.length === 0) return fail("Could not find that submission.");
  const admin = createAdminClient();
  const { error } = await admin.from("guide_question_submissions").delete().eq("id", id);
  if (error) return fail("Could not delete that submission. Please try again.");
  revalidateSubmissions();
  return { ok: true };
}

/**
 * Accept a submission: create a real guide entry from it (on the chosen page,
 * optionally global) and mark the submission accepted. Returns the destination
 * page_key so the client can navigate to that page's manager.
 */
export async function createEntryFromSubmission(
  submissionId: string,
  targetPageKey: string,
  input: GuideEntryInput,
): Promise<{ ok: true; pageKey: string } | { ok: false; error: string }> {
  await requireAdmin(SUBMISSIONS_ROOT);
  if (typeof submissionId !== "string" || submissionId.length === 0) {
    return fail("Could not find that submission.");
  }
  const v = validateEntryInput(input);
  if (!v.ok) return fail(v.error);

  const admin = createAdminClient();

  // Confirm the submission exists and is still pending. Re-checking the status
  // server-side stops a stale review link (e.g. the email button opened twice)
  // from creating a duplicate entry for an already-handled question.
  const { data: submission } = await admin
    .from("guide_question_submissions")
    .select("id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission) return fail("Could not find that submission.");
  if (submission.status !== "pending") {
    return fail("That question was already handled.");
  }

  const pageId = await pageIdForKey(admin, targetPageKey);
  if (!pageId) return fail("Could not find the destination page.");

  const nextOrder = await nextOrderForGroup(admin, pageId, v.value.kind, v.value.isGlobal);
  const { data: row, error } = await admin
    .from("guide_entries")
    .insert({
      page_id: pageId,
      kind: v.value.kind,
      heading: v.value.heading,
      body: v.value.body,
      display_order: nextOrder,
      is_published: true,
      is_global: v.value.isGlobal,
    })
    .select("id")
    .single();
  if (error || !row) return fail("Could not create the entry. Please try again.");

  const { error: updErr } = await admin
    .from("guide_question_submissions")
    .update({
      status: "accepted",
      resolved_entry_id: row.id,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  if (updErr) {
    // The entry was created; surface a soft error but don't roll back the content.
    console.error("[signal-guide] accepted submission but failed to mark it", updErr);
  }

  revalidateSubmissions();
  revalidate(targetPageKey);
  return { ok: true, pageKey: targetPageKey };
}

export async function updatePageMeta(
  pageKey: string,
  input: GuidePageMetaInput,
): Promise<ActionResult> {
  await requireAdmin(ADMIN_ROOT);
  const v = validatePageMeta(input);
  if (!v.ok) return fail(v.error);
  const admin = createAdminClient();
  const { error } = await admin
    .from("guide_pages")
    .update({
      title: v.value.title,
      description: v.value.description,
      updated_at: new Date().toISOString(),
    })
    .eq("page_key", pageKey);
  if (error) return fail("Could not update that page. Please try again.");
  revalidate(pageKey);
  return { ok: true };
}
