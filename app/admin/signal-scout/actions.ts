"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ADMIN_NOTE_MAX } from "./admin-constants";
import {
  validateSignalScoutSettings,
  clampSignalScoutSettings,
  SIGNAL_SCOUT_SETTINGS_ID,
} from "@/lib/signal-scout/settings";
import type { SignalScoutSettings } from "@/lib/signal-scout/types";
import type { Json } from "@/lib/database.types";

/**
 * Admin moderation actions for the Signal Scout Players page (SS-T038). The
 * FIRST server actions in the Signal Scout admin area. Every action
 * re-validates admin status server-side via requireAdmin (never trusts the
 * client) and writes through the service-role client, since
 * signal_scout_player_overrides is service-role-only by RLS (migration 0130:
 * a hidden player must not be discoverable client-side, since knowing which
 * players are excluded would leak information about the pool).
 *
 * Row presence is the override signal (migration 0130's own design note,
 * shared with the round-selection anti-join in
 * lib/signal-scout/eligibility.ts loadEligiblePool): hide upserts a row with
 * is_hidden = true, unhide deletes the row entirely rather than flipping
 * is_hidden to false, keeping the anti-join table minimal.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const playerIdSchema = z.string().uuid();

export async function hideSignalScoutPlayer(playerId: string, note: string): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/signal-scout/players");

  const idResult = playerIdSchema.safeParse(playerId);
  if (!idResult.success) {
    return { ok: false, error: "Could not find that player." };
  }

  const cleanNote = typeof note === "string" ? note.trim().slice(0, ADMIN_NOTE_MAX) : "";
  if (cleanNote.length === 0) {
    return { ok: false, error: "A note explaining the hide is required." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("signal_scout_player_overrides").upsert(
    {
      player_id: idResult.data,
      is_hidden: true,
      admin_note: cleanNote,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id" },
  );
  if (error) {
    return { ok: false, error: "Could not hide that player. Please try again." };
  }

  revalidatePath("/admin/signal-scout/players");
  revalidatePath("/admin/signal-scout");
  return { ok: true };
}

export async function unhideSignalScoutPlayer(playerId: string): Promise<ActionResult> {
  await requireAdmin("/admin/signal-scout/players");

  const idResult = playerIdSchema.safeParse(playerId);
  if (!idResult.success) {
    return { ok: false, error: "Could not find that player." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("signal_scout_player_overrides")
    .delete()
    .eq("player_id", idResult.data);
  if (error) {
    return { ok: false, error: "Could not restore that player. Please try again." };
  }

  revalidatePath("/admin/signal-scout/players");
  revalidatePath("/admin/signal-scout");
  return { ok: true };
}

const userIdSchema = z.string().uuid();

/**
 * Leaderboard moderation actions for the Signal Scout Users page (SS-T039).
 * Unlike the player overrides table (a separate anti-join table where row
 * presence is the signal), signal_scout_user_stats already has one row per
 * scout who has played, with the hide state living on that same row as four
 * columns (hidden_from_leaderboards, hidden_reason, hidden_at, hidden_by).
 * So hide/unhide here is a plain UPDATE, not an upsert/delete pair.
 *
 * Zero-row handling: both actions chain .select("user_id") onto the update
 * and check the returned array length, rather than a preceding
 * .maybeSingle() read. This keeps each action to a single round trip; a
 * scout with no signal_scout_user_stats row (never completed a round) simply
 * cannot be hidden, since there is nothing to flag.
 *
 * Cache note: the public leaderboards read through
 * lib/signal-scout/leaderboards.ts cachedResolveIdentities/queryBoardRows,
 * both wrapped in unstable_cache with a 60-second revalidate
 * (CACHE_TTL_SECONDS). revalidatePath here only busts the admin views; a
 * hide or unhide can take up to 60 seconds to disappear from or reappear on
 * the public boards. This lag is accepted behavior carried over from Phase 5.
 */
export async function hideSignalScoutUser(userId: string, reason: string): Promise<ActionResult> {
  const { userId: adminId } = await requireAdmin("/admin/signal-scout/users");

  const idResult = userIdSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, error: "Could not find that user." };
  }

  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, ADMIN_NOTE_MAX) : "";
  if (cleanReason.length === 0) {
    return { ok: false, error: "A note explaining the hide is required." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("signal_scout_user_stats")
    .update({
      hidden_from_leaderboards: true,
      hidden_reason: cleanReason,
      hidden_at: new Date().toISOString(),
      hidden_by: adminId,
    })
    .eq("user_id", idResult.data)
    .select("user_id");
  if (error) {
    return { ok: false, error: "Could not hide that user. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "That user has no Signal Scout record." };
  }

  revalidatePath("/admin/signal-scout/users");
  revalidatePath("/games/signal-scout/leaderboards");
  return { ok: true };
}

export async function unhideSignalScoutUser(userId: string): Promise<ActionResult> {
  await requireAdmin("/admin/signal-scout/users");

  const idResult = userIdSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, error: "Could not find that user." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("signal_scout_user_stats")
    .update({
      hidden_from_leaderboards: false,
      hidden_reason: null,
      hidden_at: null,
      hidden_by: null,
    })
    .eq("user_id", idResult.data)
    .select("user_id");
  if (error) {
    return { ok: false, error: "Could not restore that user. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "That user has no Signal Scout record." };
  }

  revalidatePath("/admin/signal-scout/users");
  revalidatePath("/games/signal-scout/leaderboards");
  return { ok: true };
}

/**
 * Settings actions for the Signal Scout Settings page (SS-T040). Mirrors the
 * On The Clock settings save/reset flow (app/admin/on-the-clock/actions.ts):
 * clamp numbers into safe ranges, then validate the clamped object through
 * the full zod schema so a valid-but-out-of-range payload is rescued instead
 * of rejected, while bad enums/types still fail validation. The table is
 * service-role-only RLS (migration 0123); updated_by is the verified admin
 * session, never client input.
 */
export async function saveSignalScoutSettings(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/signal-scout/settings");

  const base = (raw && typeof raw === "object" ? raw : {}) as SignalScoutSettings;
  const clamped = clampSignalScoutSettings(base);
  const validated = validateSignalScoutSettings(clamped);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const { error } = await admin.from("signal_scout_settings").upsert(
    {
      id: SIGNAL_SCOUT_SETTINGS_ID,
      settings: validated.settings as unknown as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error("[signal-scout-admin] settings save failed", error);
    return { ok: false, error: "Could not save settings. Please try again." };
  }

  revalidatePath("/admin/signal-scout/settings");
  revalidatePath("/games/signal-scout");
  revalidatePath("/games/signal-scout/leaderboards");
  return { ok: true };
}

/**
 * Reset the settings row to code defaults, but PRESERVE the current
 * game_enabled state so a reset never silently launches or pulls the public
 * game offline (the OTC reset convention, see resetOnTheClockSettings).
 * Returns the written settings so the client can sync its form state.
 */
export async function resetSignalScoutSettings(): Promise<
  { ok: true; settings: SignalScoutSettings } | { ok: false; error: string }
> {
  const { userId } = await requireAdmin("/admin/signal-scout/settings");

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("signal_scout_settings")
    .select("settings")
    .eq("id", SIGNAL_SCOUT_SETTINGS_ID)
    .maybeSingle();

  const currentParsed = validateSignalScoutSettings(current?.settings ?? {});
  const keepEnabled = currentParsed.ok ? currentParsed.settings.game_enabled : false;

  const defaults = validateSignalScoutSettings({});
  if (!defaults.ok) return { ok: false, error: defaults.error };
  const next: SignalScoutSettings = {
    ...defaults.settings,
    game_enabled: keepEnabled,
  };

  const { error } = await admin.from("signal_scout_settings").upsert(
    {
      id: SIGNAL_SCOUT_SETTINGS_ID,
      settings: next as unknown as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error("[signal-scout-admin] settings reset failed", error);
    return { ok: false, error: "Could not reset settings. Please try again." };
  }

  revalidatePath("/admin/signal-scout/settings");
  revalidatePath("/games/signal-scout");
  revalidatePath("/games/signal-scout/leaderboards");
  return { ok: true, settings: next };
}
