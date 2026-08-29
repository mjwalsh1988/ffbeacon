"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  loadWouldYouRatherSettings,
  saveWouldYouRatherSettings,
  validateWouldYouRatherSettings,
} from "@/lib/would-you-rather/settings";
import { countActivePool, growPool } from "@/lib/would-you-rather/pool";
import { postScheduledPoll } from "@/lib/would-you-rather/discord";
import { hasAnyWebhook } from "@/lib/would-you-rather/routing";

const ADMIN_PATH = "/admin/would-you-rather";
const GAME_PATH = "/games/would-you-rather";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Persist the Would You Rather config.
 *
 * Admin-only and validated server-side. The client payload is never trusted:
 * it has to pass the full zod schema, including the two cross-field rules
 * (Discord posting on with no webhook, or with no times picked, is refused
 * rather than silently saved as a schedule that can never fire), before it is
 * written with the service-role client.
 *
 * Saving changes what the NEXT round and the NEXT cron tick do. It does not
 * touch votes already cast or polls already posted, which is the only sane
 * behaviour: a tally is a record of what people did under the rules at the
 * time.
 */
export async function saveWouldYouRatherSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);

  const validated = validateWouldYouRatherSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await saveWouldYouRatherSettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  revalidatePath(ADMIN_PATH);
  revalidatePath(GAME_PATH);
  return { ok: true };
}

/**
 * Add trades to the pool by hand.
 *
 * The game tops itself up when the pool runs thin, and the `npm run wyr:pool`
 * script does it in bulk. This is the middle case: an admin who has just synced
 * a batch of leagues and wants the new trades playable now rather than on
 * whichever request happens to find the pool low.
 *
 * Bounded to ten passes so a click cannot run for minutes.
 */
export async function growPoolAction(passes: number): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  const bounded = Math.min(10, Math.max(1, Math.round(Number(passes) || 1)));

  const admin = createAdminClient();
  const settings = await loadWouldYouRatherSettings(admin);
  const before = await countActivePool(admin);
  const result = await growPool(admin, settings, { passes: bounded });
  const after = await countActivePool(admin);

  revalidatePath(ADMIN_PATH);
  return {
    ok: true,
    message:
      result.inserted > 0
        ? `Added ${result.inserted} trade${result.inserted === 1 ? "" : "s"}. The pool now holds ${after}.`
        : `No new trades this time (${result.note ?? "everything sampled was already pooled"}). The pool still holds ${before}.`,
  };
}

/**
 * Retire one trade from the pool.
 *
 * Retiring, not deleting: the votes already cast on it are a record of what
 * people did, and they stay. A retired trade is simply never served again.
 */
export async function retireTradeAction(tradeId: string): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(tradeId)) return { ok: false, error: "Not a trade id." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("would_you_rather_trades")
    .update({ status: "retired" })
    .eq("id", tradeId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(ADMIN_PATH);
  return { ok: true, message: "Retired. It will not be served again; its votes are kept." };
}

/**
 * Post a poll to Discord right now, as many times as an admin wants.
 *
 * NOT RATE LIMITED, ON PURPOSE. It runs the real posting path, but it does not
 * claim a schedule slot: the once-per-Eastern-hour rule exists to stop a
 * RETRIED CRON TICK from posting the same hour twice, and a person pressing a
 * button is not a duplicate cron tick. Pressing it three times sends three
 * trades. See the manual branch in lib/would-you-rather/discord.ts.
 *
 * Each press picks a different trade, because the picker never returns one
 * Discord has already been sent, so this cannot spam the same deal.
 *
 * Which channel it lands in depends on the league type of the trade it happens
 * to pick, exactly as a scheduled hour does. The result names that channel, so
 * an admin checking a newly split setup can see where this one went rather than
 * having to guess.
 *
 * The settings gates still apply. It refuses while the game is off, while
 * Discord posting is off, or with no webhook chosen anywhere, because those are
 * the settings an admin would be testing and pretending they are not set would
 * teach them nothing.
 */
export async function postDiscordPollNowAction(): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);

  const admin = createAdminClient();
  const settings = await loadWouldYouRatherSettings(admin);
  if (!settings.discord.enabled) {
    return { ok: false, error: "Discord posting is switched off. Turn it on and save first." };
  }
  if (!hasAnyWebhook(settings)) {
    return { ok: false, error: "No webhook is selected. Choose one and save first." };
  }

  // The clock and the slot claim are the two things a manual post skips, and
  // the poster is told so directly rather than being handed a doctored schedule
  // to fool it. Everything else (the webhook lookup, the trade pick, the poll
  // build, the answer length check) runs exactly as the cron runs it.
  const result = await postScheduledPoll(admin, settings, new Date(), { manual: true });

  revalidatePath(ADMIN_PATH);
  if (result.status === "posted") {
    // The channel is named, because "posted" alone leaves an admin who has just
    // split their rooms to go and look in Discord to find out which one got it.
    return {
      ok: true,
      message: `Posted to the ${result.route.label} channel. Discord message id ${result.messageId ?? "unknown"}.`,
    };
  }
  return { ok: false, error: result.reason };
}
