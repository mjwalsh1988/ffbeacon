"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

const WEBHOOKS = "/admin/system/webhooks";

function validWebhookUrl(url: string): boolean {
  // Discord issues webhooks on discord.com and its ptb/canary + legacy discordapp.com hosts.
  return /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(
    url.trim(),
  );
}

export async function createWebhook(
  label: string,
  url: string,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(WEBHOOKS);
  const admin = createAdminClient();
  const l = label.trim();
  const u = url.trim();
  if (!l) return fail("Label is required.");
  if (!validWebhookUrl(u))
    return fail(
      "Enter a valid Discord webhook URL (https://discord.com/api/webhooks/...).",
    );
  const { error } = await admin
    .from("discord_webhooks")
    .insert({ label: l, url: u, created_by: userId });
  if (error) return fail(error.message);
  revalidatePath(WEBHOOKS);
  return { ok: true };
}

/**
 * Update a webhook. The URL is a secret and is never sent back to the client, so
 * `url` is optional here: a blank value keeps the stored URL and only the label
 * changes; a non-blank value replaces it (after validation).
 */
export async function updateWebhook(
  id: string,
  label: string,
  url: string,
): Promise<ActionResult> {
  await requireAdmin(WEBHOOKS);
  const admin = createAdminClient();
  const l = label.trim();
  const u = url.trim();
  if (!l) return fail("Label is required.");
  const fields: { label: string; url?: string; updated_at: string } = {
    label: l,
    updated_at: new Date().toISOString(),
  };
  if (u) {
    if (!validWebhookUrl(u))
      return fail(
        "Enter a valid Discord webhook URL (https://discord.com/api/webhooks/...).",
      );
    fields.url = u;
  }
  const { error } = await admin
    .from("discord_webhooks")
    .update(fields)
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(WEBHOOKS);
  return { ok: true };
}

export async function toggleWebhook(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin(WEBHOOKS);
  const admin = createAdminClient();
  const { error } = await admin
    .from("discord_webhooks")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(WEBHOOKS);
  return { ok: true };
}

export async function deleteWebhook(id: string): Promise<ActionResult> {
  await requireAdmin(WEBHOOKS);
  const admin = createAdminClient();
  const { error } = await admin.from("discord_webhooks").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(WEBHOOKS);
  return { ok: true };
}
