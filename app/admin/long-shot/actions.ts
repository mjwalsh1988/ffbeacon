"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { addDays, currentEasternGameDate } from "@/lib/game-date";
import { generatePuzzle } from "@/lib/long-shot/generate";
import { coalesce } from "@/lib/request-coalesce";
import { settlePuzzle } from "@/lib/long-shot/settle";
import { loadLongShotSettings, saveLongShotSettings, validateLongShotSettings } from "@/lib/long-shot/settings";
import { createAdminClient } from "@/lib/supabase/server";

const ADMIN_PATH = "/admin/long-shot";
const GAME_PATH = "/games/long-shot";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

/** Validated server-side; the client payload is never trusted. */
export async function saveLongShotSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);
  const validated = validateLongShotSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };
  const result = await saveLongShotSettings(createAdminClient(), validated.settings, userId);
  if (!result.ok) return result;
  revalidatePath(ADMIN_PATH);
  revalidatePath(GAME_PATH);
  return { ok: true, message: "Saved. Tomorrow's puzzle uses these settings; today's prompts keep their frozen tiers." };
}

/**
 * Regenerate one date's puzzle (plan 17.8). Refused when the date has ANY
 * attempt in either mode, because deleting the puzzle would cascade through
 * its prompts into a live player's answers. Coalesced on the same key inline
 * generation uses, so the two can never interleave. A date with no puzzle is
 * simply generated with salt 0.
 */
async function regenerate(gameDate: string): Promise<ActionResult> {
  const admin = createAdminClient();
  const out: unknown = await coalesce(`long-shot:generate:${gameDate}`, async (): Promise<ActionResult> => {
    const { data: existing, error } = await admin
      .from("long_shot_puzzles")
      .select("id, seed_salt")
      .eq("game_date", gameDate)
      .maybeSingle();
    if (error) return { ok: false, error: "Could not read the puzzle." };
    let salt = 0;
    if (existing) {
      const { count, error: cErr } = await admin
        .from("long_shot_attempts")
        .select("id", { count: "exact", head: true })
        .eq("puzzle_id", existing.id);
      if (cErr) return { ok: false, error: "Could not check for attempts." };
      if ((count ?? 0) > 0) {
        return { ok: false, error: `Refused: ${count} attempt${count === 1 ? "" : "s"} already exist for ${gameDate}.` };
      }
      const { error: dErr } = await admin.from("long_shot_puzzles").delete().eq("id", existing.id);
      if (dErr) return { ok: false, error: "Could not remove the old puzzle." };
      salt = existing.seed_salt + 1;
    }
    const settings = await loadLongShotSettings(admin);
    const result = await generatePuzzle(admin, gameDate, "admin", salt, settings);
    if (!result.ok) return { ok: false, error: `No prompt passed its bounds for ${gameDate}. Nothing was written.` };
    return {
      ok: true,
      message: `Built ${gameDate} with salt ${salt}: ${result.promptCount} prompt${result.promptCount === 1 ? "" : "s"}${result.status === "short" ? " (short day)" : ""}.`,
    };
  });
  // The key is shared with inline generation so the two cannot interleave; if
  // a player's start was already generating this date, this call joined it.
  if (out && typeof out === "object" && "ok" in out) return out as ActionResult;
  return { ok: false, error: "A player was generating this date at the same moment. Reload and try again." };
}

export async function regenerateTomorrow(): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  const res = await regenerate(addDays(currentEasternGameDate(), 1));
  revalidatePath(ADMIN_PATH);
  return res;
}

export async function regenerateDate(gameDate: unknown): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  const parsed = dateSchema.safeParse(gameDate);
  if (!parsed.success) return { ok: false, error: "Enter a date as YYYY-MM-DD." };
  const res = await regenerate(parsed.data);
  revalidatePath(ADMIN_PATH);
  return res;
}

export async function hideUserFromBoards(userId: unknown, reason: unknown): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  const id = uuid.safeParse(typeof userId === "string" ? userId.trim() : userId);
  const why = z.string().trim().min(1).max(500).safeParse(reason);
  if (!id.success) return { ok: false, error: "Enter a valid user id." };
  if (!why.success) return { ok: false, error: "A reason is required (500 characters at most)." };
  const admin = createAdminClient();
  const { error } = await admin.from("long_shot_user_stats").upsert(
    {
      user_id: id.data,
      hidden_from_leaderboards: true,
      hidden_reason: why.data,
      hidden_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: "Could not hide that user. Check the id belongs to an account." };
  revalidatePath(ADMIN_PATH);
  return { ok: true, message: "Hidden from every Long Shot board within a minute." };
}

export async function unhideUser(userId: unknown): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  const id = uuid.safeParse(userId);
  if (!id.success) return { ok: false, error: "Enter a valid user id." };
  const { error } = await createAdminClient()
    .from("long_shot_user_stats")
    .update({ hidden_from_leaderboards: false, hidden_reason: null, hidden_at: null, updated_at: new Date().toISOString() })
    .eq("user_id", id.data);
  if (error) return { ok: false, error: "Could not unhide that user." };
  revalidatePath(ADMIN_PATH);
  return { ok: true, message: "Back on the boards within a minute." };
}

/** Idempotent (plan 10.3); refused for today or later. */
export async function settleNow(gameDate: unknown): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  const parsed = dateSchema.safeParse(gameDate);
  if (!parsed.success) return { ok: false, error: "Enter a date as YYYY-MM-DD." };
  if (parsed.data >= currentEasternGameDate()) return { ok: false, error: "Only a finished day can be settled: pick yesterday or earlier." };
  const admin = createAdminClient();
  const { data: puzzle, error } = await admin
    .from("long_shot_puzzles")
    .select("id, game_date, prompt_count")
    .eq("game_date", parsed.data)
    .maybeSingle();
  if (error) return { ok: false, error: "Could not read the puzzle." };
  if (!puzzle) return { ok: false, error: `There is no puzzle for ${parsed.data}.` };
  const settings = await loadLongShotSettings(admin);
  const s = await settlePuzzle(admin, puzzle, settings, Date.now() + 50_000);
  revalidatePath(ADMIN_PATH);
  return {
    ok: true,
    message: `${parsed.data}: ${s.settledNow} attempt${s.settledNow === 1 ? "" : "s"} settled now, ${s.bonusesPaid} paid a bonus, room of ${s.room}, ${s.abandoned} closed unfinished.${s.partial ? " Stopped at its time budget; run it again to finish." : s.stamped ? " The day is stamped settled." : ""}`,
  };
}
