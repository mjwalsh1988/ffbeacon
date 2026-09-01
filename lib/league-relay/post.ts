import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { postWebhookMessage } from "@/lib/discord";
import { renderPlainText, renderWriteup } from "./render";
import type { RelayChannelSettings, RelayMessageType } from "./default-settings";
import type { Writeup } from "./types";

type Admin = SupabaseClient<Database>;

/**
 * Claiming, sending, and recording one relay message.
 *
 * THE ORDER IS THE WHOLE FILE.
 *
 *   1. CLAIM the dedupe key. A unique index insert, so a second cron tick
 *      running the same league at the same moment collides here and stops.
 *   2. BUILD and RENDER. This can fail (Discord's caps, a writeup with nothing
 *      to say), and when it does the claim is already taken, so nothing retries
 *      it into the channel forever.
 *   3. SEND.
 *   4. RECORD what Discord said.
 *
 * A CLAIM TAKEN AFTER THE SEND IS A CLAIM THAT DOES NOT STOP THE SEND. This is
 * the same rule Would You Rather's poll slot holds, learned the same way: the
 * fifteen-minute cron overlaps itself the moment one league's sync runs long,
 * and two ticks that both post are indistinguishable from a bug in the
 * scheduler.
 *
 * A FAILED SEND KEEPS ITS ROW, marked 'error'. Keeping it is what stops the
 * next tick from hammering a Discord that is already rejecting us, and it
 * leaves the failure visible in the admin panel instead of silent. An admin who
 * wants a retry deletes the row, which is a deliberate act.
 */

/**
 * Discord issues webhooks on discord.com and its ptb/canary and legacy
 * discordapp.com hosts. Anchored at the start, and the path separator must come
 * straight after the host, so both `https://discord.com@evil.com/api/webhooks/`
 * and `https://discord.com.evil.com/api/webhooks/` are refused.
 *
 * The admin form validates on the way IN (app/admin/system/actions.ts). This is
 * the check on the way OUT, because a stored row is not necessarily a row that
 * form wrote: a restored backup, a future importer, or a manual service-role
 * insert would otherwise be handed straight to fetch.
 */
const WEBHOOK_URL = /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//;

export async function loadWebhookUrl(admin: Admin, webhookId: string): Promise<string | null> {
  const { data } = await admin
    .from("discord_webhooks")
    .select("url, is_active")
    .eq("id", webhookId)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  const url = data.url.trim();
  if (!WEBHOOK_URL.test(url)) {
    console.error("[league-relay] a stored webhook url failed validation; refusing to fetch it");
    return null;
  }
  return url;
}

export type SendOutcome =
  | { status: "posted"; dedupeKey: string; messageId: string | null; title: string }
  | { status: "duplicate"; dedupeKey: string }
  | { status: "skipped"; dedupeKey: string; reason: string }
  | { status: "error"; dedupeKey: string; reason: string };

export interface SendParams {
  leagueId: string;
  /**
   * Passed in rather than read off the writeup, because the CLAIM happens
   * before the writeup exists and the column is NOT NULL. It is also what the
   * admin panel filters on, so a claim that never produced a message is still
   * filed under the right heading.
   */
  messageType: RelayMessageType;
  dedupeKey: string;
  season: number | null;
  week: number | null;
  channel: RelayChannelSettings;
  /**
   * Built lazily, AFTER the claim succeeds.
   *
   * A writeup is expensive (a Signal Check grade, a Monte Carlo season) and
   * building one for a message another tick has already sent is pure waste.
   * Passing a thunk is what lets the claim come first without the caller having
   * to split its own logic in two.
   */
  build: () => Promise<Writeup | null>;
}

/**
 * Claim a dedupe key, build, send, record.
 *
 * Never throws. Every failure is a named outcome the cron logs and moves past;
 * one bad trade must not stop the rest of a league's run.
 */
export async function claimAndSend(admin: Admin, params: SendParams): Promise<SendOutcome> {
  const { dedupeKey } = params;

  // 1. CLAIM. Before anything is built and long before anything is sent.
  const { data: claimed, error: claimError } = await admin
    .from("league_relay_posts")
    .insert({
      league_id: params.leagueId,
      message_type: params.messageType,
      dedupe_key: dedupeKey,
      season: params.season,
      week: params.week,
      webhook_id: params.channel.webhook_id,
      status: "claimed",
    })
    .select("id")
    .maybeSingle();
  if (claimError) {
    // 23505 is the unique index doing its job: somebody else has this key.
    if (claimError.code === "23505") return { status: "duplicate", dedupeKey };
    return { status: "error", dedupeKey, reason: claimError.message };
  }
  if (!claimed) return { status: "error", dedupeKey, reason: "Could not claim the message slot." };

  const fail = async (status: "skipped" | "error", reason: string): Promise<SendOutcome> => {
    await admin
      .from("league_relay_posts")
      .update({ status, error: reason.slice(0, 500) })
      .eq("id", claimed.id);
    return { status, dedupeKey, reason };
  };

  // 2. BUILD and RENDER.
  let writeup: Writeup | null;
  try {
    writeup = await params.build();
  } catch (err) {
    return fail("error", err instanceof Error ? err.message : "The writeup failed to build.");
  }
  if (!writeup) return fail("skipped", "There was nothing worth writing about this one.");

  const rendered = renderWriteup(writeup, {
    mentionRoleIds: params.channel.mention_role_ids,
    pollHours: params.channel.poll ? params.channel.poll_hours : null,
  });
  // NOTHING IS TRUNCATED TO MAKE IT FIT. The composer has already dropped every
  // droppable section; if it still does not fit, the message does not go.
  if (!rendered) {
    return fail("skipped", "The writeup could not be fitted inside Discord's limits.");
  }

  const webhookUrl = params.channel.webhook_id
    ? await loadWebhookUrl(admin, params.channel.webhook_id)
    : null;
  if (!webhookUrl) return fail("error", "The webhook for this message type is missing or off.");

  // Record the exact text alongside the claim BEFORE sending, so a send that
  // times out still leaves an admin able to see what was about to go out.
  await admin
    .from("league_relay_posts")
    .update({
      payload: {
        title: writeup.title,
        text: renderPlainText(writeup),
        dropped: rendered.dropped,
      } as unknown as Json,
    })
    .eq("id", claimed.id);

  // 3. SEND.
  const sent = await postWebhookMessage(webhookUrl, rendered.message);
  if (!sent.ok) return fail("error", sent.error);

  // 4. RECORD.
  await admin
    .from("league_relay_posts")
    .update({
      status: "posted",
      discord_message_id: sent.id,
      discord_channel_id: sent.channelId,
      posted_at: new Date().toISOString(),
    })
    .eq("id", claimed.id);

  return { status: "posted", dedupeKey, messageId: sent.id, title: writeup.title };
}

/**
 * Claim an hour without sending anything.
 *
 * The Tuesday recap run posts one game an hour. The hour itself has to be
 * claimed, or all four ticks inside it would each pick the next uncovered game
 * and post four recaps at eleven o'clock. 'reserved' is that claim: a ledger
 * row that is a rate limit rather than a message.
 */
export async function claimHour(
  admin: Admin,
  leagueId: string,
  dedupeKey: string,
): Promise<boolean> {
  const { error } = await admin.from("league_relay_posts").insert({
    league_id: leagueId,
    message_type: "matchup_recap",
    dedupe_key: dedupeKey,
    status: "reserved",
  });
  return !error;
}
