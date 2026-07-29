/**
 * The Beacon Brief failed-task resolution.
 *
 * Called from the admin Moderation action when the admin resolves a
 * failed_task row: retry resets the one referenced beacon_brief_queue job back
 * to pending so the worker picks it up on its next run, or skip leaves the job
 * failed and just closes the row. Nothing else about the pipeline run is
 * touched, so a job that already succeeded (e.g. a discord_post that already
 * has a message id) is never re-run; the worker's own per-job idempotency
 * guards apply exactly as they would on any other retry. Mirrors the
 * resolveReferenceMatch / dismissReferenceMatch shape (throws on error; the
 * action wraps it into an ActionResult).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

/** Reset the failed job to pending, then close the moderation row. */
export async function retryFailedTask(
  admin: Admin,
  moderationId: string,
  resolvedBy: string,
): Promise<void> {
  const { data: mod } = await admin
    .from("beacon_brief_moderation")
    .select("id, type, status, queue_job_id")
    .eq("id", moderationId)
    .maybeSingle();
  if (!mod || mod.status !== "pending")
    throw new Error("This item is no longer pending.");
  if (mod.type !== "failed_task")
    throw new Error("This item is not a failed task.");
  if (!mod.queue_job_id) throw new Error("No job is linked to this item.");

  const now = new Date().toISOString();
  const { data: reset } = await admin
    .from("beacon_brief_queue")
    .update({
      status: "pending",
      attempts: 0,
      last_error: null,
      run_after: now,
      updated_at: now,
    })
    .eq("id", mod.queue_job_id)
    .eq("status", "failed")
    .select("id");
  if (!reset || reset.length === 0)
    throw new Error("This task is no longer in a failed state.");

  await admin
    .from("beacon_brief_moderation")
    .update({
      status: "approved",
      resolved_at: now,
      resolved_by: resolvedBy,
    })
    .eq("id", moderationId)
    .eq("status", "pending");
}

/** Skip a failed task: the job stays failed forever; the row just closes. */
export async function skipFailedTask(
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
    .eq("type", "failed_task");
}
