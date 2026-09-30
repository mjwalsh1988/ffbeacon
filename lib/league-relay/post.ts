import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
// (SupabaseClient without the Database generic is used below only for the
// columns migration 0327 adds, until the generated types are regenerated.)
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
 * A CLAIM WHOSE FUNCTION DIED IS NOT STUCK FOREVER. releaseStaleClaims frees a
 * claim that never started its send so a later tick takes it again, and closes
 * one whose send started but never confirmed as 'error' rather than risk a
 * second post. See that function.
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
  //
  // THIS WRITE IS ALSO THE SEND LEASE. It stamps send_started_at, guarded on
  // the row still being this claim, still 'claimed', and not yet started. A
  // claim abandoned by a function that died is released by
  // releaseStaleClaims (below) and taken again by a later tick; if this
  // process was only SLOW rather than dead, its row is gone or already started
  // by then, the guard matches nothing, and it stops here instead of posting
  // alongside the tick that took over.
  const payload = {
    title: writeup.title,
    text: renderPlainText(writeup),
    dropped: rendered.dropped,
  } as unknown as Json;
  const lease = await startSend(admin, claimed.id, payload);
  if (lease === "lost") {
    return { status: "duplicate", dedupeKey };
  }

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
 * How long a 'claimed' row may sit before it is treated as abandoned.
 *
 * A claim lives for one build and one send inside a cron run bounded at four
 * minutes (RUN_BUDGET_MS in relay.ts) under a five-minute route limit. A claim
 * still 'claimed' a quarter of an hour later belongs to a function that died.
 */
export const STALE_CLAIM_MS = 15 * 60_000;

/** Postgres "undefined column" and PostgREST's "column not in schema cache". */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/**
 * Stamp the payload and the send lease on a claim, guarded so exactly one
 * process can start the send for it. "started" means send; "lost" means the
 * claim was released or taken over while this process was building.
 *
 * Before migration 0327 adds send_started_at, the guarded write fails on the
 * missing column; the payload is then written the old way and the send goes
 * ahead, so deploying this ahead of the migration changes nothing.
 */
async function startSend(admin: Admin, claimId: string, payload: Json): Promise<"started" | "lost"> {
  // Untyped: send_started_at arrives with migration 0327, ahead of regenerated types.
  const { data, error } = await (admin as unknown as SupabaseClient)
    .from("league_relay_posts")
    .update({ payload, send_started_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("status", "claimed")
    .is("send_started_at", null)
    .select("id");
  if (error) {
    if (error.code && MISSING_COLUMN_CODES.has(error.code)) {
      await admin.from("league_relay_posts").update({ payload }).eq("id", claimId);
      return "started";
    }
    // Any other failure writing the lease: do not send without one.
    return "lost";
  }
  return (data?.length ?? 0) === 1 ? "started" : "lost";
}

export interface StaleClaimSweep {
  /** Claims that never started a send, released so a later tick can take them. */
  released: number;
  /** Claims whose send started and never finished, closed as error. */
  closed: number;
}

/**
 * Release claims a dead function left behind. Runs at the head of every relay
 * run. Never throws.
 *
 * TWO CASES, AND ONLY ONE IS RETRIED.
 *
 * A claim that never STARTED its send (send_started_at null) is deleted. Its
 * dedupe key is then unhandled again, the next tick's pre-filter picks it up,
 * and claimAndSend claims it fresh. Nothing reached Discord, so nothing can be
 * posted twice. The delete is guarded on the same conditions, so a process
 * that was merely slow finds its row gone at startSend and stops.
 *
 * A claim whose send STARTED and never recorded a result is not retried.
 * Discord's webhook execute takes no idempotency key, and a webhook cannot
 * list the messages it has sent, so there is no stored message id to check
 * and no way to ask Discord whether the first send landed. Sending again could
 * post the message twice, which is the failure this file exists to prevent. It
 * is closed as 'error' with that reason, so it stops reading as in flight and
 * shows in the admin panel, where deleting the row is the deliberate retry.
 */
export async function releaseStaleClaims(
  admin: Admin,
  now: Date = new Date(),
): Promise<StaleClaimSweep> {
  const out: StaleClaimSweep = { released: 0, closed: 0 };
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  // Untyped: send_started_at arrives with migration 0327, ahead of regenerated types.
  const db = admin as unknown as SupabaseClient;
  try {
    const { data: released, error: releaseError } = await db
      .from("league_relay_posts")
      .delete()
      .eq("status", "claimed")
      .is("send_started_at", null)
      // The payload is written in the same statement as the lease, so a null
      // payload is a second witness that no send began. It also keeps a row
      // claimed before migration 0327 (payload written, no lease column yet)
      // out of the retry path: that one may have reached Discord.
      .is("payload", null)
      .lt("created_at", cutoff)
      .select("id");
    if (!releaseError) out.released = (released ?? []).length;

    const { data: closed, error: closeError } = await db
      .from("league_relay_posts")
      .update({
        status: "error",
        error:
          "The send started and never confirmed. Not retried automatically, because a second send could post it twice. Delete this row to retry.",
      })
      .eq("status", "claimed")
      .or("send_started_at.not.is.null,payload.not.is.null")
      .lt("created_at", cutoff)
      .select("id");
    if (!closeError) out.closed = (closed ?? []).length;
  } catch {
    // A sweep that fails leaves the rows for the next run.
  }
  return out;
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
