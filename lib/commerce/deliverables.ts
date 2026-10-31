/**
 * The sections and attachments of a written review.
 *
 * ATTACHMENTS NEVER TRAVEL THROUGH A SERVER ACTION. An action body is capped at
 * 1 MB and a Vercel function request at about 4.5 MB, so a 10 MB file goes straight
 * from the admin's browser to Storage with a signed upload URL. The row is written
 * first, in state `pending`, at the path the token is minted for: the token
 * authorizes exactly one object at exactly that path, and the bucket enforces size
 * and type on the PUT whatever the browser claims. `finalizeAttachment` then checks
 * the object is really there before the row can be published. A row that never
 * finalizes is cleared by the cron with whatever reached its path.
 *
 * Service role client only. Customers read published rows through RLS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, ORDER_FILES_BUCKET } from "./constants";
import type { OrderDeliverable } from "./types";

type Client = SupabaseClient<Database>;

/** Letters, digits, dots, hyphens, underscores; 100 characters, keeping the extension. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+/, "");
  if (cleaned.length === 0) return "file";
  if (cleaned.length <= 100) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, 100 - ext.length)}${ext}`;
}

export function attachmentPath(orderId: string, deliverableId: string, fileName: string): string {
  return `orders/${orderId}/${deliverableId}/${fileName}`;
}

/** Whether the browser's claim is even worth a row. Storage checks again on the PUT. */
export function attachmentAllowed(mimeType: string, size: number): boolean {
  return (
    (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType) &&
    size >= 1 &&
    size <= MAX_ATTACHMENT_BYTES
  );
}

export async function listDeliverables(
  admin: Client,
  orderId: string,
): Promise<OrderDeliverable[]> {
  const { data, error } = await admin
    .from("order_deliverables")
    .select("*")
    .eq("order_id", orderId)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderDeliverable[];
}

export async function saveSection(
  admin: Client,
  input: { id: string | null; orderId: string; title: string; body: string; sortOrder: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fields = { title: input.title, body: input.body, sort_order: input.sortOrder };
  if (!input.id) {
    const { error } = await admin
      .from("order_deliverables")
      .insert({ ...fields, order_id: input.orderId, kind: "section" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }
  // Only a section of this order, and only one that exists: an id for an
  // attachment row or for nothing must not come back as saved.
  const { data, error } = await admin
    .from("order_deliverables")
    .update(fields)
    .eq("id", input.id)
    .eq("order_id", input.orderId)
    .eq("kind", "section")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That section was not found. Refresh and try again." };
  return { ok: true };
}

/** The object first, ignoring not-found, then the row. */
export async function deleteDeliverable(
  admin: Client,
  row: Pick<OrderDeliverable, "id" | "storage_path">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (row.storage_path) {
    await admin.storage.from(ORDER_FILES_BUCKET).remove([row.storage_path]);
  }
  const { error } = await admin.from("order_deliverables").delete().eq("id", row.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type BeginAttachmentResult =
  | { ok: true; deliverableId: string; path: string; token: string }
  | { ok: false; error: string };

/** Write the pending row, then mint a token for exactly its path. */
export async function beginAttachment(
  admin: Client,
  input: { orderId: string; fileName: string; mimeType: string; size: number },
): Promise<BeginAttachmentResult> {
  if (!attachmentAllowed(input.mimeType, input.size)) {
    return { ok: false, error: "That file type or size is not allowed." };
  }
  const name = sanitizeFileName(input.fileName);
  const id = crypto.randomUUID();
  const path = attachmentPath(input.orderId, id, name);

  const { error } = await admin.from("order_deliverables").insert({
    id,
    order_id: input.orderId,
    kind: "attachment",
    title: name.slice(0, 120),
    storage_path: path,
    file_name: name,
    file_size: input.size,
    mime_type: input.mimeType,
    status: "draft",
    upload_state: "pending",
  });
  if (error) return { ok: false, error: error.message };

  return signUpload(admin, id, path);
}

/** A fresh token for a row whose first upload did not finish. */
export async function retryAttachment(
  admin: Client,
  row: Pick<OrderDeliverable, "id" | "storage_path" | "upload_state">,
): Promise<BeginAttachmentResult> {
  if (row.upload_state !== "pending" || !row.storage_path) {
    return { ok: false, error: "That upload has already finished." };
  }
  return signUpload(admin, row.id, row.storage_path);
}

async function signUpload(
  admin: Client,
  deliverableId: string,
  path: string,
): Promise<BeginAttachmentResult> {
  const { data, error } = await admin.storage
    .from(ORDER_FILES_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    return { ok: false, error: "We could not start the upload. Try again." };
  }
  return { ok: true, deliverableId, path, token: data.token };
}

/** The decision, pure: the listing must hold the object the row points at. */
export function objectInListing(
  listing: Array<{ name: string; metadata?: { size?: number } | null }>,
  storagePath: string,
): { size: number } | null {
  const name = storagePath.split("/").pop();
  const hit = listing.find((entry) => entry.name === name);
  if (!hit) return null;
  return { size: Number(hit.metadata?.size ?? 0) };
}

export async function finalizeAttachment(
  admin: Client,
  row: Pick<OrderDeliverable, "id" | "storage_path">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const path = row.storage_path ?? "";
  const folder = path.split("/").slice(0, -1).join("/");
  const { data, error } = await admin.storage.from(ORDER_FILES_BUCKET).list(folder);
  const found = error ? null : objectInListing(data ?? [], path);
  if (!found) return { ok: false, error: "The upload did not finish. Try again." };

  const { error: writeError } = await admin
    .from("order_deliverables")
    .update({ file_size: found.size, upload_state: "ready" })
    .eq("id", row.id);
  if (writeError) return { ok: false, error: writeError.message };
  return { ok: true };
}

/** Publish every draft that is ready. A pending attachment stays out. */
export async function publishAll(admin: Client, orderId: string, now: string): Promise<void> {
  const { error } = await admin
    .from("order_deliverables")
    .update({ status: "published", published_at: now })
    .eq("order_id", orderId)
    .eq("status", "draft")
    .eq("upload_state", "ready");
  if (error) throw new Error(error.message);
}

/** Pending rows past 24 hours go, with any object at their path. Returns the count. */
export async function clearAbandonedUploads(admin: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("order_deliverables")
    .select("id, storage_path")
    .eq("kind", "attachment")
    .eq("upload_state", "pending")
    .lt("created_at", cutoff)
    .limit(100);
  if (error) throw new Error(error.message);
  let cleared = 0;
  for (const row of data ?? []) {
    const result = await deleteDeliverable(admin, row);
    if (result.ok) cleared += 1;
  }
  return cleared;
}
