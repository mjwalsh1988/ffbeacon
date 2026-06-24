/**
 * The Beacon Brief deletion handling.
 *
 * handleDeletionCheck (run by the worker) re-verifies a published article's
 * source post still exists; if it is gone, it opens a PENDING moderation row and
 * NEVER auto-deletes anything. approveDeletion / rejectDeletion are called from
 * the admin Moderation action: approve unpublishes the article and queues a
 * Discord retract patch; reject keeps the article. Both close the moderation row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getXTweetsByIds } from "@/lib/x";
import { logBeaconBrief } from "./ai";
import type { QueueJobPayload } from "./types";

type Admin = SupabaseClient<Database>;
type Ingestion = Database["public"]["Tables"]["news_ingestions"]["Row"];

async function loadIngestion(
  admin: Admin,
  id: string,
): Promise<Ingestion | null> {
  const { data } = await admin
    .from("news_ingestions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Worker handler for a deletion_check job. Returns ok=false to retry later. */
export async function handleDeletionCheck(
  admin: Admin,
  payload: QueueJobPayload,
): Promise<{ ok: boolean; error?: string }> {
  const ingestion = await loadIngestion(admin, payload.ingestion_id);
  if (!ingestion || !ingestion.article_id) return { ok: true }; // no article to retract

  const resp = await getXTweetsByIds([ingestion.source_external_id]);
  if (!resp) return { ok: false, error: "deletion check fetch failed" };

  const stillExists = (resp.data ?? []).some(
    (t) => t.id === ingestion.source_external_id,
  );
  if (!stillExists) {
    const { data: existing } = await admin
      .from("beacon_brief_moderation")
      .select("id")
      .eq("ingestion_id", ingestion.id)
      .eq("status", "pending")
      .maybeSingle();
    if (!existing) {
      await admin.from("beacon_brief_moderation").insert({
        ingestion_id: ingestion.id,
        article_id: ingestion.article_id,
        type: "deletion",
        status: "pending",
        detail: {
          detected_at: new Date().toISOString(),
          source_external_id: ingestion.source_external_id,
        } as unknown as Json,
      });
      await logBeaconBrief(admin, {
        stage: "deletion_check",
        level: "warn",
        ingestionId: ingestion.id,
        message: "source post deleted; moderation opened",
      });
    }
    return { ok: true };
  }

  // Still present: re-check later, within a 7-day horizon from ingestion.
  const ageMs = Date.now() - new Date(ingestion.created_at).getTime();
  if (ageMs < 7 * 24 * 60 * 60 * 1000) {
    await admin.from("beacon_brief_queue").insert({
      job_type: "deletion_check",
      payload: { ingestion_id: ingestion.id } as unknown as Json,
      status: "pending",
      run_after: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    });
  }
  return { ok: true };
}

/** Approve a deletion: unpublish the article + queue a Discord retract. */
export async function approveDeletion(
  admin: Admin,
  moderationId: string,
  resolvedBy: string,
): Promise<void> {
  const { data: mod } = await admin
    .from("beacon_brief_moderation")
    .select("id, article_id, ingestion_id, status")
    .eq("id", moderationId)
    .maybeSingle();
  if (!mod || mod.status !== "pending") return;

  if (mod.article_id) {
    await admin
      .from("articles")
      .update({ status: "archived", last_updated: new Date().toISOString() })
      .eq("id", mod.article_id);
  }
  if (mod.ingestion_id) {
    await admin
      .from("news_ingestions")
      .update({ status: "deleted" })
      .eq("id", mod.ingestion_id);
    // Patch the original Discord message to a retracted state.
    await admin.from("beacon_brief_queue").insert({
      job_type: "discord_patch",
      payload: {
        ingestion_id: mod.ingestion_id,
        target_ingestion_id: mod.ingestion_id,
        retract: true,
      } as unknown as Json,
      status: "pending",
      run_after: new Date().toISOString(),
    });
  }

  await admin
    .from("beacon_brief_moderation")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq("id", moderationId);
}

/** Reject a deletion: keep the article, close the moderation row. */
export async function rejectDeletion(
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
    .eq("status", "pending");
}
