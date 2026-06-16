"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { revalidateProfileCaches } from "@/lib/signal-profile";

/**
 * Admin moderation actions for the Signal Wall. Every action re-validates admin
 * status server-side via requireAdmin (never trusts the client) and writes the
 * moderation columns through the service-role client, since hidden* on
 * signal_posts is service-role-only by column grant. After a takedown or restore
 * we bust the affected owner's profile caches; the public Wall itself is dynamic,
 * so the change is visible on the next request regardless.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const HIDDEN_REASON_MAX = 300;

async function bustForPost(
  admin: ReturnType<typeof createAdminClient>,
  signalId: string,
): Promise<void> {
  const { data: signal } = await admin
    .from("signals")
    .select("user_id")
    .eq("id", signalId)
    .maybeSingle();
  if (signal?.user_id) await revalidateProfileCaches(admin, signal.user_id);
}

export async function hidePost(
  postId: string,
  reason: string,
): Promise<ActionResult> {
  const { userId } = await requireAdmin();
  if (typeof postId !== "string" || postId.length === 0) {
    return { ok: false, error: "Could not find that post." };
  }
  const cleanReason =
    typeof reason === "string" ? reason.trim().slice(0, HIDDEN_REASON_MAX) : "";

  const admin = createAdminClient();
  const { data: post, error } = await admin
    .from("signal_posts")
    .update({
      hidden: true,
      hidden_reason: cleanReason.length > 0 ? cleanReason : null,
      hidden_at: new Date().toISOString(),
      hidden_by: userId,
    })
    .eq("id", postId)
    .select("signal_id")
    .maybeSingle();
  if (error || !post) {
    return { ok: false, error: "Could not hide that post. Please try again." };
  }

  // Resolve any open reports on this post as actioned.
  await admin
    .from("signal_reports")
    .update({ status: "actioned" })
    .eq("target_type", "post")
    .eq("target_id", postId)
    .in("status", ["pending", "reviewed"]);

  await bustForPost(admin, post.signal_id);
  return { ok: true };
}

export async function unhidePost(postId: string): Promise<ActionResult> {
  await requireAdmin();
  if (typeof postId !== "string" || postId.length === 0) {
    return { ok: false, error: "Could not find that post." };
  }

  const admin = createAdminClient();
  const { data: post, error } = await admin
    .from("signal_posts")
    .update({
      hidden: false,
      hidden_reason: null,
      hidden_at: null,
      hidden_by: null,
    })
    .eq("id", postId)
    .select("signal_id")
    .maybeSingle();
  if (error || !post) {
    return { ok: false, error: "Could not restore that post. Please try again." };
  }

  await bustForPost(admin, post.signal_id);
  return { ok: true };
}

export async function setReportStatus(
  reportId: string,
  status: "reviewed" | "dismissed",
): Promise<ActionResult> {
  await requireAdmin();
  if (typeof reportId !== "string" || reportId.length === 0) {
    return { ok: false, error: "Could not find that report." };
  }
  if (status !== "reviewed" && status !== "dismissed") {
    return { ok: false, error: "Invalid status." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("signal_reports")
    .update({ status })
    .eq("id", reportId);
  if (error) {
    return { ok: false, error: "Could not update that report. Please try again." };
  }
  return { ok: true };
}
