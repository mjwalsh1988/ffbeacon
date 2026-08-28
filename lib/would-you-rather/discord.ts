/**
 * The Discord half of Would You Rather.
 *
 * A real Discord poll, posted by the Beacon Relay webhook on the schedule an
 * admin picked, and its results folded back into the same tally the website
 * shows. Two jobs, both driven by the hourly cron:
 *
 *   postScheduledPoll   Is this hour one the admin selected? If so, and if this
 *                       slot has not already been posted, pick a trade and post
 *                       it as a poll.
 *   ingestClosedPolls   Any poll past its close time gets read back once and
 *                       its counts added to the trade.
 *
 * WHY A WEBHOOK AND NOT THE BOT. Discord lets a webhook execute carry a poll,
 * and `GET /webhooks/{id}/{token}/messages/{id}` hands the poll's results back
 * authenticated by the token already in the URL. So posting and reading both
 * work with the webhook the site already stores, and no bot permission,
 * channel id, or gateway connection is involved. The existing bot token is
 * used elsewhere for membership and guild stats and is deliberately left out
 * of this path.
 *
 * A VOTE CANNOT BE COUNTED TWICE, AND NEITHER CAN A POLL BE POSTED TWICE.
 *   Posting is claimed by `slot_key`, an Eastern "date-hour" string with a
 *   unique index on it. Two cron ticks inside the same Eastern hour, a retry,
 *   or two regions firing at once all collide on that key and only one posts.
 *   The row is written BEFORE the message is sent, for the same reason the
 *   league refresh endpoint writes its rate-limit row first: a claim taken
 *   after the work is a claim that does not stop the work.
 *
 *   Ingestion is claimed by a conditional update on `results_ingested_at`. Only
 *   the worker whose update actually matched a row goes on to touch the tally,
 *   and the trade's Discord totals are then RECOMPUTED as the sum of its polls
 *   rather than incremented. A sum cannot drift; an increment run twice can.
 *
 * DISCORD'S COUNTS ARE AGGREGATES WITH NO IDENTITIES ATTACHED, which is why
 * they live in their own pair of columns rather than as rows in the votes
 * table. Nothing pretends to know who voted on Discord, and nothing tries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SITE } from "@/lib/site";
import { fetchWebhookPoll, postWebhookMessage, type DiscordMessageInput } from "@/lib/discord";
import { loadRound, selectTradeId, type LoadedRound } from "./round";
import { easternSlot, isPostHour, pollClosesAt, shouldIngestNow } from "./schedule";
import type { WouldYouRatherSettings } from "./default-settings";
import type { WyrRound, WyrSide } from "./types";

type Client = SupabaseClient<Database>;

/** Discord's own limits. Text past these is rejected, so it is trimmed first. */
const POLL_QUESTION_MAX = 300;
const POLL_ANSWER_MAX = 55;
const MESSAGE_CONTENT_MAX = 2000;

/** Answer ids Discord assigns, in the order answers are sent. */
const ANSWER_ID: Record<WyrSide, number> = { a: 1, b: 2 };

/** The three periods a truncated string ends with. Never the ellipsis character. */
const ELLIPSIS = "...";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Budget the marker itself, so the result is genuinely within `max` rather
  // than three characters over it, which Discord would reject.
  const slice = text.slice(0, Math.max(0, max - ELLIPSIS.length));
  // Cut back to the last space so a name is not split mid-word, and fall back
  // to a hard cut only when there is no space worth using.
  const space = slice.lastIndexOf(" ");
  const body = space > max * 0.6 ? slice.slice(0, space) : slice;
  return `${body.trimEnd()}${ELLIPSIS}`;
}

/** "Ja'Marr Chase, 2027 1st and 2 more" for one side. */
function sideSummary(round: WyrRound, side: WyrSide, max: number): string {
  const names = round.sides[side].map((a) => a.name);
  if (names.length === 0) return "nothing";
  let text = names.join(", ");
  if (text.length <= max) return text;
  for (let keep = names.length - 1; keep >= 1; keep -= 1) {
    const rest = names.length - keep;
    text = `${names.slice(0, keep).join(", ")} and ${rest} more`;
    if (text.length <= max) return text;
  }
  return truncate(names[0], max);
}

/** The full asset list for the message body, one line per asset. */
function sideLines(round: WyrRound, side: WyrSide): string {
  const assets = round.sides[side];
  if (assets.length === 0) return "- nothing";
  return assets
    .map((a) => {
      const via = a.startupPick
        ? ` (via ${a.startupPick.label}${a.startupPick.simulated ? ", projected" : ""})`
        : "";
      const detail = a.detail ? ` - ${a.detail}` : "";
      return `- ${a.name}${detail}${via}`;
    })
    .join("\n");
}

/**
 * The message and its poll.
 *
 * Everything is in `content` rather than an embed: Discord renders a poll
 * beneath the message body, and a plain markdown body reads the same in the
 * client, in a notification, and to a screen reader using Discord's own
 * accessibility layer. No manager is named anywhere in it.
 */
export function buildPollMessage(
  round: WyrRound,
  opts: { siteUrl: string; mentionRoleIds: string[] },
): DiscordMessageInput {
  const kindLabel = round.kind === "startup" ? "Startup draft trade" : "Trade";
  const where = [
    round.leagueName,
    round.season ? String(round.season) : null,
    round.derivedLabel,
  ]
    .filter(Boolean)
    .join(" - ");

  const mentions = opts.mentionRoleIds.map((id) => `<@&${id}>`).join(" ");
  const body = [
  // null for the absent mentions line, NOT "". The empty strings below are
  // deliberate paragraph breaks between the header, the two sides and the
  // call to action, and a filter on "" removed all of them along with the
  // one it was aimed at, posting every section run together on consecutive
  // lines.
    mentions ? `${mentions}\n` : null,
    `**Would You Rather? ${kindLabel}**`,
    `${where}`,
    "",
    "**Team A receives**",
    sideLines(round, "a"),
    "",
    "**Team B receives**",
    sideLines(round, "b"),
    "",
    `Vote below, then see the full Signal Check breakdown: ${opts.siteUrl}/games/would-you-rather`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    content: truncate(body, MESSAGE_CONTENT_MAX),
    allowedRoleIds: opts.mentionRoleIds,
    poll: {
      question: truncate("Which side wins this trade?", POLL_QUESTION_MAX),
      answers: [
        truncate(`Team A: ${sideSummary(round, "a", POLL_ANSWER_MAX - 8)}`, POLL_ANSWER_MAX),
        truncate(`Team B: ${sideSummary(round, "b", POLL_ANSWER_MAX - 8)}`, POLL_ANSWER_MAX),
      ],
      durationHours: 0, // replaced by the caller, which knows the setting
    },
  };
}

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

async function loadWebhookUrl(admin: Client, webhookId: string): Promise<string | null> {
  const { data } = await admin
    .from("discord_webhooks")
    .select("url, is_active")
    .eq("id", webhookId)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  const url = data.url.trim();
  if (!WEBHOOK_URL.test(url)) {
    console.error(
      "[would-you-rather] a stored webhook url failed validation; refusing to fetch it",
    );
    return null;
  }
  return url;
}

export type PostOutcome =
  | { status: "skipped"; reason: string }
  | { status: "posted"; tradeId: string; slotKey: string; messageId: string | null }
  | { status: "error"; reason: string };

/**
 * Post one poll, if this hour is a scheduled one.
 *
 * Never throws. The cron that calls it records the outcome and moves on to
 * ingestion; a Discord outage must not take the ingestion half down with it.
 */
export async function postScheduledPoll(
  admin: Client,
  settings: WouldYouRatherSettings,
  now: Date = new Date(),
): Promise<PostOutcome> {
  const cfg = settings.discord;
  if (!settings.game_enabled) return { status: "skipped", reason: "The game is switched off." };
  if (!cfg.enabled) return { status: "skipped", reason: "Discord posting is switched off." };
  if (!cfg.webhook_id) return { status: "skipped", reason: "No webhook is selected." };
  if (!isPostHour(now, cfg.post_hours)) {
    return { status: "skipped", reason: "This hour is not one of the scheduled times." };
  }

  const slot = easternSlot(now);

  try {
    const webhookUrl = await loadWebhookUrl(admin, cfg.webhook_id);
    if (!webhookUrl) {
      return { status: "skipped", reason: "The selected webhook is missing or switched off." };
    }

    // Prefer a trade Discord has never seen, so the channel does not get the
    // same deal twice while the pool still holds fresh ones.
    const tradeId = await pickUnpostedTradeId(admin);
    if (!tradeId) return { status: "skipped", reason: "No trade is available to post." };

    const loaded = await loadRound(admin, tradeId);
    if (!loaded) return { status: "skipped", reason: "The chosen trade could not be built." };

    // CLAIM THE SLOT BEFORE SENDING ANYTHING. A second tick inside this Eastern
    // hour collides on slot_key and gives up here, rather than after it has
    // already posted a duplicate to the channel.
    const closesAt = pollClosesAt(now, cfg.poll_hours);
    const { data: claimed, error: claimError } = await admin
      .from("would_you_rather_discord_polls")
      .insert({
        trade_id: loaded.pool.id,
        webhook_id: cfg.webhook_id,
        slot_key: slot.key,
        posted_at: now.toISOString(),
        closes_at: closesAt.toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (claimError) {
      // 23505 on slot_key: somebody else already has this hour. Not an error.
      if (claimError.code === "23505") {
        return { status: "skipped", reason: "This hour has already been posted." };
      }
      return { status: "error", reason: claimError.message };
    }
    if (!claimed) return { status: "error", reason: "Could not claim the schedule slot." };

    const message = buildPollMessage(loaded.round, {
      siteUrl: SITE.url,
      mentionRoleIds: cfg.mention_role_ids,
    });
    const sent = await postWebhookMessage(webhookUrl, {
      ...message,
      poll: { ...message.poll!, durationHours: cfg.poll_hours },
    });

    if (!sent.ok) {
      // The claim row stays, marked failed. Keeping it is what stops the next
      // tick inside the same hour from hammering a Discord that is already
      // rejecting us, and it leaves the failure visible in the admin panel.
      await admin
        .from("would_you_rather_discord_polls")
        .update({ status: "error", error: sent.error.slice(0, 500) })
        .eq("id", claimed.id);
      return { status: "error", reason: sent.error };
    }

    await Promise.all([
      admin
        .from("would_you_rather_discord_polls")
        .update({ discord_message_id: sent.id })
        .eq("id", claimed.id),
      admin
        .from("would_you_rather_trades")
        .update({ discord_posted_at: now.toISOString() })
        .eq("id", loaded.pool.id),
    ]);

    return { status: "posted", tradeId: loaded.pool.id, slotKey: slot.key, messageId: sent.id };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "Discord post failed.",
    };
  }
}

/** A pooled trade Discord has not seen, else any pooled trade. */
async function pickUnpostedTradeId(admin: Client): Promise<string | null> {
  // Most-served first among the ones Discord has not seen: a trade the site has
  // already shown a lot is a trade proven to render and to be worth arguing
  // about, which is what a channel post wants. One of forty at random from that
  // set, so the channel does not get the same deal on consecutive days.
  const { data } = await admin
    .from("would_you_rather_trades")
    .select("id")
    .eq("status", "active")
    .is("discord_posted_at", null)
    .order("served_count", { ascending: false })
    .limit(40);
  const rows = data ?? [];
  if (rows.length > 0) return rows[Math.floor(Math.random() * rows.length)].id;
  return selectTradeId(admin, new Set());
}

export interface IngestOutcome {
  checked: number;
  ingested: number;
  votesAdded: number;
  /** Polls that are closed but whose numbers Discord has not sealed yet. */
  waiting: number;
  errors: string[];
}

/**
 * Fold every closed poll's results into its trade, exactly once each.
 *
 * Cheap when there is nothing to do: the partial index on
 * (closes_at) where results_ingested_at is null means the sweep touches only
 * the handful of polls that are actually outstanding.
 */
export async function ingestClosedPolls(
  admin: Client,
  settings: WouldYouRatherSettings,
  now: Date = new Date(),
): Promise<IngestOutcome> {
  const outcome: IngestOutcome = { checked: 0, ingested: 0, votesAdded: 0, waiting: 0, errors: [] };
  const webhookCache = new Map<string, string | null>();

  try {
    const { data: pending, error } = await admin
      .from("would_you_rather_discord_polls")
      .select("id, trade_id, webhook_id, discord_message_id, closes_at")
      .is("results_ingested_at", null)
      .lte("closes_at", now.toISOString())
      .order("closes_at", { ascending: true })
      .limit(25);
    if (error) {
      outcome.errors.push(error.message);
      return outcome;
    }

    for (const poll of pending ?? []) {
      outcome.checked += 1;

      if (!poll.discord_message_id) {
        // The post failed before Discord gave us an id, so there is nothing to
        // read. Closed out rather than retried forever, with zeroes recorded so
        // the row states plainly that it contributed nothing.
        await closeOutPoll(
          admin,
          poll.id,
          0,
          0,
          now,
          "No Discord message id was recorded.",
          null,
        );
        continue;
      }

      const webhookId = poll.webhook_id ?? settings.discord.webhook_id;
      if (!webhookId) {
        outcome.errors.push("A closed poll has no webhook to read it back through.");
        continue;
      }
      if (!webhookCache.has(webhookId)) {
        webhookCache.set(webhookId, await loadWebhookUrl(admin, webhookId));
      }
      const webhookUrl = webhookCache.get(webhookId) ?? null;
      if (!webhookUrl) {
        outcome.errors.push("A closed poll's webhook is missing or switched off.");
        continue;
      }

      const fetched = await fetchWebhookPoll(webhookUrl, poll.discord_message_id);
      if (!fetched.ok) {
        // A failed request is not evidence about the poll. Left alone so the
        // next hourly sweep tries again, exactly as Power Pulse refuses to
        // conclude anything from a failed Sleeper call.
        outcome.errors.push(fetched.error);
        continue;
      }
      if (!fetched.poll) {
        await closeOutPoll(
          admin,
          poll.id,
          0,
          0,
          now,
          "Discord returned no poll on that message.",
          null,
        );
        continue;
      }

      const closesAt = new Date(poll.closes_at);
      if (!shouldIngestNow(now, closesAt, fetched.poll.isFinalized)) {
        outcome.waiting += 1;
        continue;
      }

      // A missing answer id means nobody picked it, which is a zero rather than
      // an absence of data.
      const votesA = fetched.poll.counts.get(ANSWER_ID.a) ?? 0;
      const votesB = fetched.poll.counts.get(ANSWER_ID.b) ?? 0;

      const claimed = await closeOutPoll(
        admin,
        poll.id,
        votesA,
        votesB,
        now,
        null,
        fetched.poll.raw,
      );
      if (!claimed) continue; // Another worker got there first.

      await recomputeDiscordTally(admin, poll.trade_id);
      outcome.ingested += 1;
      outcome.votesAdded += votesA + votesB;
    }
  } catch (err) {
    outcome.errors.push(err instanceof Error ? err.message : "Poll ingestion failed.");
  }

  return outcome;
}

/**
 * Claim a poll for ingestion and record its numbers.
 *
 * The `.is("results_ingested_at", null)` filter is the claim: two workers
 * racing on the same poll, only one of them matches a row, and only that one
 * goes on to touch the tally. Returns whether this caller won.
 */
async function closeOutPoll(
  admin: Client,
  pollId: string,
  votesA: number,
  votesB: number,
  now: Date,
  errorText: string | null,
  /** Discord's raw poll object. Preserved verbatim; never modified afterwards. */
  raw: unknown,
): Promise<boolean> {
  const { data } = await admin
    .from("would_you_rather_discord_polls")
    .update({
      results_ingested_at: now.toISOString(),
      ingested_votes_a: votesA,
      ingested_votes_b: votesB,
      status: errorText ? "error" : "ingested",
      error: errorText?.slice(0, 500) ?? null,
      metadata: (raw ?? null) as never,
    })
    .eq("id", pollId)
    .is("results_ingested_at", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

/**
 * Set a trade's Discord totals to the SUM of its ingested polls.
 *
 * A sum rather than an increment, so running this twice, or running it after a
 * poll row is corrected by hand, lands on the same number both times. An
 * increment is the version that quietly doubles a tally.
 */
async function recomputeDiscordTally(admin: Client, tradeId: string): Promise<void> {
  const { data } = await admin
    .from("would_you_rather_discord_polls")
    .select("ingested_votes_a, ingested_votes_b")
    .eq("trade_id", tradeId)
    .not("results_ingested_at", "is", null);
  let a = 0;
  let b = 0;
  for (const row of data ?? []) {
    a += row.ingested_votes_a ?? 0;
    b += row.ingested_votes_b ?? 0;
  }
  await admin
    .from("would_you_rather_trades")
    .update({ discord_votes_a: a, discord_votes_b: b })
    .eq("id", tradeId);
}

export type { LoadedRound };
