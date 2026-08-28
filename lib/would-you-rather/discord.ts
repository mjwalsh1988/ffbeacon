/**
 * The Discord half of Would You Rather.
 *
 * A real Discord poll, posted by the Beacon Relay webhook on the schedule an
 * admin picked, and its results folded back into the same tally the website
 * shows. Two jobs, both driven by the hourly cron:
 *
 *   postScheduledPoll   Is this hour one the admin selected? If so, and if this
 *                       slot has not already been posted, pick a trade and post
 *                       it as a poll to the channel its league type is pointed
 *                       at.
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
 *
 * BUT THE NAMES ARE AVAILABLE, FROM A DIFFERENT DOOR, and that is how a repeat
 * vote is stopped. `GET /channels/{id}/polls/{message}/answers/{answer}` returns
 * the voters themselves rather than a count. It is channel-scoped and needs the
 * bot rather than the webhook, which is why the channel id and the answer ids
 * are captured from the create response and stored on the poll row: neither can
 * be recovered afterwards.
 *
 *   Each voter becomes a row in would_you_rather_discord_votes, and the unique
 *   index on (trade_id, discord_user_id) is the guarantee. Somebody who already
 *   answered a poll on this trade is not inserted again, so a second vote adds
 *   nothing to the tally, however many times the trade has been posted and
 *   however many times ingestion runs.
 *
 *   When the bot cannot read a poll (not in that server, cannot see the
 *   channel, rate limited, not configured) the aggregate counts are used
 *   instead. They are right for that one poll, because Discord dedupes within a
 *   poll itself, but they carry no names, so the trade is flagged
 *   `discord_identity_gap` and is never posted again. That flag is the line
 *   between the trades the guarantee covers and the ones it cannot.
 *
 * THE TRADE IS PICKED FIRST AND THE CHANNEL FOLLOWS FROM IT.
 *   Each league type can have its own webhook, so a dynasty trade goes to the
 *   dynasty room and a best ball trade to the best ball room. But the pick is
 *   made on the trade's own merits, and the channel is read off the league it
 *   came out of afterwards. The channels are NOT a quota: a scheduled hour is
 *   never spent hunting for a trade of a particular type, and a week where the
 *   pool holds nothing but dynasty trades is a week of dynasty-room posts,
 *   which is an honest reflection of what the pool held.
 *
 *   The only way a channel constrains the pick is by not existing. A league
 *   type with no webhook and no fallback is kept out of the candidate set, so
 *   it costs silence in its own room rather than a wasted scheduled hour.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SITE } from "@/lib/site";
import { fetchWebhookPoll, postWebhookMessage, type DiscordMessageInput } from "@/lib/discord";
import { fetchPollAnswerVoters, hasDiscordBotToken } from "@/lib/discord-poll-voters";
import { buildPollAnswer, buildPollQuestion, type PollAsset } from "./poll-text";
import { loadRound, type LoadedRound } from "./round";
import { easternSlot, isPostHour, pollClosesAt, shouldIngestNow } from "./schedule";
import {
  categoryForLeagueMetadata,
  hasAnyWebhook,
  postableCategories,
  webhookForCategory,
  WYR_CATEGORY_LABEL,
  type LeagueCategoryKey,
} from "./routing";
import type { WouldYouRatherSettings } from "./default-settings";
import type { WyrRound, WyrSide } from "./types";

type Client = SupabaseClient<Database>;

/**
 * The message body's own limit. The poll's two limits live in ./poll-text.ts
 * beside the ladder that fits a trade inside them.
 */
const MESSAGE_CONTENT_MAX = 2000;

/**
 * The answer ids Discord assigns in practice, in the order answers are sent.
 *
 * A FALLBACK, NOT THE SOURCE OF TRUTH. Every poll posted from now on records
 * the ids Discord actually returned (`answer_id_a` / `answer_id_b`), because
 * assuming 1 and 2 is an assumption about somebody else's API. These are used
 * only for rows written before that was captured.
 */
const DEFAULT_ANSWER_ID: Record<WyrSide, number> = { a: 1, b: 2 };

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

/** One side's assets, in the shape the answer builder wants. */
function pollAssets(round: WyrRound, side: WyrSide): PollAsset[] {
  return round.sides[side].map((a) =>
    a.kind === "pick"
      ? {
          kind: "pick" as const,
          season: a.pickSeason,
          round: a.round,
          slot: a.pickSlot,
          label: a.name,
        }
      : { kind: "player" as const, name: a.name },
  );
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
): DiscordMessageInput | null {
  const kindLabel = round.kind === "startup" ? "Startup draft trade" : "Trade";
  const where = [
    round.leagueName,
    round.season ? String(round.season) : null,
    round.derivedLabel,
  ]
    .filter(Boolean)
    .join(" - ");

  // The buttons first, because either one failing means this trade cannot be
  // posted at all and there is no point building the body. 55 characters is a
  // hard rejection, and a button listing three of a side's five players would
  // describe a trade nobody proposed.
  const answerA = buildPollAnswer(pollAssets(round, "a"), "a");
  const answerB = buildPollAnswer(pollAssets(round, "b"), "b");
  if (!answerA || !answerB) return null;

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
      // The format, in short forms. A first-round pick in a 10-team redraft is
      // not the asset it is in a 12-team superflex dynasty, and the button is
      // where the reader is actually deciding.
      question: buildPollQuestion(round.formatShort),
      // Already inside 55 by construction; nothing here truncates, because a
      // truncated answer is a wrong answer rather than a shorter one.
      answers: [answerA.text, answerB.text],
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

/** What happened for one destination channel on one scheduled hour. */
/** What happened on one scheduled hour, and which channel it went to. */
export type PostOutcome =
  | { status: "skipped"; reason: string; route: RouteSummary | null }
  | {
      status: "posted";
      route: RouteSummary;
      tradeId: string;
      slotKey: string;
      messageId: string | null;
    }
  | { status: "error"; reason: string; route: RouteSummary | null };

/** The channel one poll went to, and the league type that sent it there. */
export interface RouteSummary {
  webhookId: string;
  /** Null when the trade's league object has not been stored yet. */
  category: LeagueCategoryKey | null;
  /** "Dynasty", or "Unknown league type" when it could not be derived. */
  label: string;
}

/**
 * How many recent trades the pick considers before choosing among them.
 *
 * A window rather than a single "best" row, so the channel does not get the
 * same deal on consecutive days, and bounded so the query stays a small read.
 */
const PICK_WINDOW = 60;

/**
 * How many trades one tick will try before giving the hour up.
 *
 * A trade can be ruled out only after it is picked (it stopped building, or it
 * cannot fit a poll button). Both are rare, so a handful of attempts is plenty,
 * and a bound is what stops a pool of unpostable trades from turning one cron
 * tick into an unbounded loop.
 */
const POST_ATTEMPTS = 5;

/**
 * Post this hour's poll.
 *
 * ONE TRADE PER SCHEDULED HOUR, AND THE CHANNEL FOLLOWS THE TRADE. The pick is
 * made on the trade's own merits and only then routed, so the channels are not
 * a quota that has to be filled and a scheduled hour is never spent hunting for
 * a trade of a particular type. See lib/would-you-rather/routing.ts.
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
  const skip = (reason: string): PostOutcome => ({ status: "skipped", reason, route: null });

  if (!settings.game_enabled) return skip("The game is switched off.");
  if (!cfg.enabled) return skip("Discord posting is switched off.");
  if (!hasAnyWebhook(settings)) return skip("No webhook is selected for any league type.");
  if (!isPostHour(now, cfg.post_hours)) {
    return skip("This hour is not one of the scheduled times.");
  }

  const slot = easternSlot(now);

  try {
    // THE TRADE FIRST. Restricted only by what is postable at all: with a
    // fallback webhook set that is everything, and without one it is the league
    // types that have a channel of their own. A trade nothing could carry is
    // left out of the pick rather than chosen and then dropped, which would
    // waste the hour.
    //
    // A few attempts, because two things can rule a trade out only after it has
    // been picked: it may no longer build (its league or transaction went away
    // on a resync), and it may not fit inside Discord's 55 characters an answer
    // even fully condensed. Both mean "take a different trade" rather than
    // "give up on the hour", so the pick is retried with the failures excluded.
    const tried = new Set<string>();
    let loaded: LoadedRound | null = null;
    let message: DiscordMessageInput | null = null;
    let lastReason = "No trade is available to post.";

    for (let attempt = 0; attempt < POST_ATTEMPTS; attempt += 1) {
      const tradeId = await pickTradeForPoll(admin, postableCategories(settings), tried);
      if (!tradeId) break;
      tried.add(tradeId);

      const candidate = await loadRound(admin, tradeId);
      if (!candidate) {
        lastReason = "The chosen trade could not be built.";
        continue;
      }
      const built = buildPollMessage(candidate.round, {
        siteUrl: SITE.url,
        mentionRoleIds: cfg.mention_role_ids,
      });
      if (!built) {
        // Too many assets to name inside a poll button. Nothing is dropped from
        // the trade to make it fit; a different trade is posted instead.
        lastReason = "The trade was too large to fit a Discord poll answer.";
        continue;
      }
      loaded = candidate;
      message = built;
      break;
    }

    if (!loaded || !message) return skip(lastReason);

    // THE CHANNEL SECOND, read off the league the trade came out of.
    const category = categoryForLeagueMetadata(loaded.league.metadata);
    const webhookId = webhookForCategory(settings, category);
    const label = category ? WYR_CATEGORY_LABEL[category] : "Unknown league type";
    if (!webhookId) {
      return skip(`No channel is set for ${label.toLowerCase()} trades.`);
    }
    const route: RouteSummary = { webhookId, category, label };

    const webhookUrl = await loadWebhookUrl(admin, webhookId);
    if (!webhookUrl) {
      return {
        status: "skipped",
        reason: `The ${label} webhook is missing or switched off.`,
        route,
      };
    }

    // CLAIM THE SLOT BEFORE SENDING ANYTHING. A second tick inside this Eastern
    // hour collides on slot_key and gives up here, rather than after it has
    // already posted a duplicate.
    const closesAt = pollClosesAt(now, cfg.poll_hours);
    const { data: claimed, error: claimError } = await admin
      .from("would_you_rather_discord_polls")
      .insert({
        trade_id: loaded.pool.id,
        webhook_id: webhookId,
        route_key: webhookId,
        slot_key: slot.key,
        posted_at: now.toISOString(),
        closes_at: closesAt.toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (claimError) {
      // Both unique indexes on this table are guards doing their job rather
      // than failures, so a 23505 is a skip. Named apart where Postgres tells
      // us which one fired, because "this hour is taken" and "this trade has
      // already been to Discord" send an admin looking in different places.
      if (claimError.code === "23505") {
        const detail = `${claimError.message} ${claimError.details ?? ""}`;
        const reason = detail.includes("one_per_trade")
          ? "That trade has already been posted to Discord once."
          : "This hour has already been posted.";
        return { status: "skipped", reason, route };
      }
      return { status: "error", reason: claimError.message, route };
    }
    if (!claimed) {
      return { status: "error", reason: "Could not claim the schedule slot.", route };
    }

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
      return { status: "error", reason: sent.error, route };
    }

    await Promise.all([
      admin
        .from("would_you_rather_discord_polls")
        .update({
          discord_message_id: sent.id,
          // Captured here or never. The endpoint that says WHO voted is
          // channel-scoped, a webhook URL does not name its channel, and the
          // create response is the only place Discord hands it over. Same for
          // the answer ids: read back rather than assumed, so a vote stays
          // attributed to the right side.
          discord_channel_id: sent.channelId,
          answer_id_a: sent.pollAnswerIds?.[0] ?? null,
          answer_id_b: sent.pollAnswerIds?.[1] ?? null,
        })
        .eq("id", claimed.id),
      admin
        .from("would_you_rather_trades")
        .update({ discord_posted_at: now.toISOString() })
        .eq("id", loaded.pool.id),
    ]);

    return {
      status: "posted",
      route,
      tradeId: loaded.pool.id,
      slotKey: slot.key,
      messageId: sent.id,
    };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "Discord post failed.",
      route: null,
    };
  }
}

/**
 * Which trade this hour gets.
 *
 * Two passes.
 *
 *   1. The newest trades Discord has never seen. Among those, the ones the site
 *      has collected fewest votes on, because a poll is worth most on a trade
 *      the room has not settled yet, and a random pick from that half so the
 *      channel does not get the same deal two days running.
 *   2. Nothing new left, so a good trade comes back around: the ones Discord
 *      saw longest ago, ONLY where every poll for that trade was read by voter.
 *
 * WHY THE SECOND PASS IS SAFE NOW. A repeat poll used to mean a repeat voter
 * counted twice, because Discord's totals carry no names. The voters are now
 * read by name and deduplicated by the database on
 * (trade_id, discord_user_id), so somebody who already called this trade adds
 * nothing the second time. `discord_identity_gap` marks the trades that
 * guarantee does not cover: any trade with a poll we could only count. Those
 * are excluded here and never posted again.
 *
 * `categories` is the postable set, not a preference. It is null in the normal
 * case, and non-null only when there is no fallback webhook and some league
 * type therefore has nowhere to go. Passing it never biases WHICH trade is
 * picked among the routable ones; it only keeps unroutable ones out.
 */
async function pickTradeForPoll(
  admin: Client,
  categories: readonly LeagueCategoryKey[] | null,
  /** Trades this tick has already tried and ruled out. */
  exclude: ReadonlySet<string> = new Set(),
): Promise<string | null> {
  if (categories && categories.length === 0) return null;

  let freshQuery = admin
    .from("would_you_rather_trades")
    .select("id, votes_a, votes_b")
    .eq("status", "active")
    .is("discord_posted_at", null);
  if (categories) freshQuery = freshQuery.in("league_category", categories);
  const { data: fresh } = await freshQuery
    .order("added_at", { ascending: false })
    .limit(PICK_WINDOW);

  const rows = (fresh ?? []).filter((r) => !exclude.has(r.id));
  if (rows.length > 0) {
    // Sorted in memory rather than in the query, because the vote total is the
    // sum of two columns and PostgREST cannot order on an expression. The
    // window is bounded above, so this is a sort of at most PICK_WINDOW rows.
    const byVotes = [...rows].sort((a, b) => a.votes_a + a.votes_b - (b.votes_a + b.votes_b));
    const leastVoted = byVotes.slice(0, Math.max(1, Math.ceil(byVotes.length / 2)));
    return leastVoted[Math.floor(Math.random() * leastVoted.length)].id;
  }

  let againQuery = admin
    .from("would_you_rather_trades")
    .select("id")
    .eq("status", "active")
    .eq("discord_identity_gap", false)
    .not("discord_posted_at", "is", null);
  if (categories) againQuery = againQuery.in("league_category", categories);
  const { data: again } = await againQuery
    .order("discord_posted_at", { ascending: true })
    .limit(PICK_WINDOW);

  const seen = (again ?? []).filter((r) => !exclude.has(r.id));
  if (seen.length === 0) return null;
  // From the oldest quarter of that window, so a trade posted months ago comes
  // back before one posted last week, without it being the same one every time.
  const oldest = seen.slice(0, Math.max(1, Math.ceil(seen.length / 4)));
  return oldest[Math.floor(Math.random() * oldest.length)].id;
}

export interface IngestOutcome {
  checked: number;
  ingested: number;
  votesAdded: number;
  /** Polls whose voters were read by name rather than counted in the aggregate. */
  identified: number;
  /** Polls that are closed but whose numbers Discord has not sealed yet. */
  waiting: number;
  errors: string[];
}

/**
 * Fold every closed poll's results into its trade, exactly once each.
 *
 * TWO WAYS TO COUNT, AND THE FIRST IS TRIED FIRST.
 *   By voter. The bot reads the list of Discord users behind each answer and
 *   each one becomes a row, deduplicated by the database on
 *   (trade_id, discord_user_id). That is what makes a second vote on the same
 *   trade uncountable: the insert simply does not take.
 *
 *   By total. Discord's `answer_counts` through the webhook, which is all the
 *   webhook can see. Used when the bot cannot read the poll (not in that
 *   server, cannot view the channel, rate limited, not configured). The numbers
 *   are still right for that one poll, because Discord dedupes within a poll
 *   itself, but they carry no names, so the trade is flagged with
 *   `discord_identity_gap` and never goes to Discord again.
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
  const outcome: IngestOutcome = {
    checked: 0,
    ingested: 0,
    votesAdded: 0,
    identified: 0,
    waiting: 0,
    errors: [],
  };
  const webhookCache = new Map<string, string | null>();

  try {
    const { data: pending, error } = await admin
      .from("would_you_rather_discord_polls")
      .select(
        "id, trade_id, webhook_id, discord_message_id, discord_channel_id, answer_id_a, answer_id_b, closes_at",
      )
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
        //
        // 'error' here is load-bearing: it is what says the message never
        // landed. Correct, because nobody saw this one.
        await closeOutPoll(admin, poll.id, 0, 0, now, {
          note: "No Discord message id was recorded.",
          reachedDiscord: false,
          votersResolved: false,
          raw: null,
        });
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
        // The message EXISTS and simply carries no readable poll, so this one
        // did reach Discord and people may well have voted on it. Closed out as
        // ingested-with-a-note rather than as an error, and flagged as
        // unidentified so the trade is never posted again: we have no way to
        // recognise anyone who voted on it.
        await closeOutPoll(admin, poll.id, 0, 0, now, {
          note: "Discord returned no poll on that message.",
          reachedDiscord: true,
          votersResolved: false,
          raw: null,
        });
        await markIdentityGap(admin, poll.trade_id);
        continue;
      }

      const closesAt = new Date(poll.closes_at);
      if (!shouldIngestNow(now, closesAt, fetched.poll.isFinalized)) {
        outcome.waiting += 1;
        continue;
      }

      // The authoritative answer ids, recorded when the poll was created. Older
      // rows predate them, so they fall back to the 1 and 2 Discord assigns in
      // practice, which is what the aggregate read has always assumed.
      const answerIdA = poll.answer_id_a ?? DEFAULT_ANSWER_ID.a;
      const answerIdB = poll.answer_id_b ?? DEFAULT_ANSWER_ID.b;

      // A missing answer id means nobody picked it, which is a zero rather than
      // an absence of data.
      const totalA = fetched.poll.counts.get(answerIdA) ?? 0;
      const totalB = fetched.poll.counts.get(answerIdB) ?? 0;

      const voters = await readPollVoters(poll.discord_channel_id, poll.discord_message_id, {
        a: answerIdA,
        b: answerIdB,
      });

      const claimed = await closeOutPoll(admin, poll.id, totalA, totalB, now, {
        note: voters.ok ? null : voters.reason,
        reachedDiscord: true,
        votersResolved: voters.ok,
        raw: fetched.poll.raw,
      });
      if (!claimed) continue; // Another worker got there first.

      if (voters.ok) {
        // The rows are written AFTER the claim, so only the worker that won the
        // claim writes them. Duplicates are ignored rather than treated as an
        // error, which is the whole point: a person who already has a row for
        // this trade keeps the one they have.
        const added = await recordDiscordVoters(admin, poll.trade_id, poll.id, voters);
        outcome.identified += 1;
        outcome.votesAdded += added;
      } else {
        outcome.errors.push(voters.reason);
        await markIdentityGap(admin, poll.trade_id);
        outcome.votesAdded += totalA + totalB;
      }

      await recomputeDiscordTally(admin, poll.trade_id);
      outcome.ingested += 1;
    }
  } catch (err) {
    outcome.errors.push(err instanceof Error ? err.message : "Poll ingestion failed.");
  }

  return outcome;
}

type PollVoters =
  | { ok: true; a: string[]; b: string[] }
  | { ok: false; reason: string };

/**
 * Both answers' voter lists, or one reason why neither could be read.
 *
 * All or nothing on purpose. Reading one side and failing on the other would
 * produce a lopsided tally that looks like a real result, so a partial read is
 * discarded and the poll falls back to its totals.
 */
async function readPollVoters(
  channelId: string | null,
  messageId: string,
  answerIds: { a: number; b: number },
): Promise<PollVoters> {
  if (!channelId) {
    // Posted before the channel id was captured, so there is nothing to ask.
    return { ok: false, reason: "No Discord channel id was recorded for that poll." };
  }
  if (!hasDiscordBotToken()) {
    return { ok: false, reason: "DISCORD_BOT_TOKEN is not set, so voters cannot be read." };
  }

  // Sequential rather than parallel: two reads against one Discord rate limit
  // bucket, and a burst is the thing that gets throttled.
  const a = await fetchPollAnswerVoters({ channelId, messageId, answerId: answerIds.a });
  if (!a.ok) return { ok: false, reason: a.reason };
  const b = await fetchPollAnswerVoters({ channelId, messageId, answerId: answerIds.b });
  if (!b.ok) return { ok: false, reason: b.reason };
  return { ok: true, a: a.userIds, b: b.userIds };
}

/**
 * Write one row per Discord voter, and return how many were genuinely new.
 *
 * `ignoreDuplicates` against the unique index on (trade_id, discord_user_id) is
 * what drops a repeat vote. Somebody who answered an earlier poll on this same
 * trade already has a row, so their second vote is not inserted and does not
 * move the tally, which is exactly the behaviour a count could never give.
 *
 * A voter appearing under BOTH answers is dropped rather than guessed at. It
 * should be impossible (the poll is posted with allow_multiselect false), so
 * seeing it means the read is not describing what we think it is.
 */
export interface DiscordVoteRow {
  discordUserId: string;
  side: WyrSide;
}

/**
 * Turn two voter lists into the rows to write.
 *
 * Deduplicates within the read as well as across it. A voter under BOTH answers
 * is dropped rather than guessed at: the poll is posted with
 * `allow_multiselect: false`, so it should be impossible, and seeing it means
 * the read is not describing what we think it is. A voter listed twice under
 * the same answer keeps one row, because Discord paginating oddly should not
 * turn one person into two votes before the database ever sees them.
 */
export function discordVoteRows(voters: { a: string[]; b: string[] }): {
  rows: DiscordVoteRow[];
  dropped: string[];
} {
  const bSide = new Set(voters.b);
  const dropped = Array.from(new Set(voters.a.filter((id) => bSide.has(id))));
  const drop = new Set(dropped);

  const rows: DiscordVoteRow[] = [];
  const claimed = new Set<string>();
  for (const [side, ids] of [
    ["a", voters.a],
    ["b", voters.b],
  ] as const) {
    for (const id of ids) {
      if (drop.has(id) || claimed.has(id)) continue;
      claimed.add(id);
      rows.push({ discordUserId: id, side });
    }
  }
  return { rows, dropped };
}

async function recordDiscordVoters(
  admin: Client,
  tradeId: string,
  pollId: string,
  voters: { a: string[]; b: string[] },
): Promise<number> {
  const { rows, dropped } = discordVoteRows(voters);
  if (dropped.length > 0) {
    console.warn(
      `[would-you-rather] ${dropped.length} Discord voters appear under both answers; dropping them`,
    );
  }
  if (rows.length === 0) return 0;

  const { data, error } = await admin
    .from("would_you_rather_discord_votes")
    .upsert(
      rows.map((r) => ({
        trade_id: tradeId,
        poll_id: pollId,
        discord_user_id: r.discordUserId,
        side: r.side,
      })),
      { onConflict: "trade_id,discord_user_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.warn("[would-you-rather] could not record Discord voters", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Mark a trade as one whose Discord votes are not fully attributable.
 *
 * It can never be posted again. Some of its votes are known only as a total, so
 * a person who voted on that poll would be invisible on the next one and would
 * be counted a second time.
 */
async function markIdentityGap(admin: Client, tradeId: string): Promise<void> {
  const { error } = await admin
    .from("would_you_rather_trades")
    .update({ discord_identity_gap: true })
    .eq("id", tradeId);
  if (error) {
    console.warn("[would-you-rather] could not flag an identity gap", error.message);
  }
}

/**
 * Claim a poll for ingestion and record its numbers.
 *
 * The `.is("results_ingested_at", null)` filter is the claim: two workers
 * racing on the same poll, only one of them matches a row, and only that one
 * goes on to touch the tally. Returns whether this caller won.
 *
 * THE FINAL STATUS DECIDES WHETHER THE TRADE CAN GO OUT AGAIN, which is why
 * `reachedDiscord` is a separate flag from `note` rather than inferred from it.
 * The partial unique index in migration 0230 excludes 'error' rows, so marking
 * a poll 'error' hands its trade back to the pool. That is right when the
 * message never reached Discord and wrong the moment it did: people may have
 * voted, and their votes would be counted again alongside a second poll's.
 * A poll that reached Discord therefore closes as 'ingested' whatever went
 * wrong afterwards, with the note saying what.
 */
export interface PollCloseOutcome {
  /** What went wrong, or null when nothing did. Written to `error`. */
  note: string | null;
  /** Whether Discord accepted the message. See the note on closeOutPoll. */
  reachedDiscord: boolean;
  /** Whether this poll's voters were read by name rather than only counted. */
  votersResolved: boolean;
}

/**
 * The terminal status for a poll.
 *
 * 'error' ONLY when the message never reached Discord, so the row reads as an
 * attempt nobody saw. A poll that did reach Discord closes as 'ingested'
 * however badly the read went afterwards, with the note saying what happened;
 * calling it an error would misdescribe a poll real people voted on.
 *
 * Whether its trade may go out again is a SEPARATE question, answered by
 * `voters_resolved` and the trade's `discord_identity_gap`, not by this.
 */
export function pollCloseStatus(outcome: PollCloseOutcome): "ingested" | "error" {
  return outcome.note && !outcome.reachedDiscord ? "error" : "ingested";
}

async function closeOutPoll(
  admin: Client,
  pollId: string,
  votesA: number,
  votesB: number,
  now: Date,
  outcome: PollCloseOutcome & {
    /** Discord's raw poll object. Preserved verbatim; never modified after. */
    raw: unknown;
  },
): Promise<boolean> {
  const { data } = await admin
    .from("would_you_rather_discord_polls")
    .update({
      results_ingested_at: now.toISOString(),
      // The totals are recorded even when the voters were read by name. They
      // are Discord's own figure, they are the audit trail for the per-voter
      // rows, and a disagreement between the two is worth being able to see.
      ingested_votes_a: votesA,
      ingested_votes_b: votesB,
      voters_resolved: outcome.votersResolved,
      status: pollCloseStatus(outcome),
      error: outcome.note?.slice(0, 500) ?? null,
      metadata: (outcome.raw ?? null) as never,
    })
    .eq("id", pollId)
    .is("results_ingested_at", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

/**
 * Recompute a trade's Discord totals from scratch, from both kinds of evidence.
 *
 * One distinct person per row where the voters were read by name, plus the raw
 * totals from any poll we could only count. The two halves cannot overlap: a
 * poll contributes to one or the other, never both.
 *
 * RECOMPUTED, NEVER INCREMENTED. Running this twice, running it after a poll
 * row is corrected by hand, or two workers running it at once all land on the
 * same number. An increment is the version that quietly doubles a tally.
 *
 * The per-voter half is where the guarantee lives: the rows are deduplicated by
 * the database on (trade_id, discord_user_id), so somebody who answered two
 * polls on the same trade is one row and counts once.
 */
async function recomputeDiscordTally(admin: Client, tradeId: string): Promise<void> {
  const [{ data: voters }, { data: counted }] = await Promise.all([
    admin
      .from("would_you_rather_discord_votes")
      .select("side")
      .eq("trade_id", tradeId),
    // Only the polls that were NOT read by voter. Adding a resolved poll's
    // totals on top of its own rows would count every one of its voters twice.
    admin
      .from("would_you_rather_discord_polls")
      .select("ingested_votes_a, ingested_votes_b")
      .eq("trade_id", tradeId)
      .eq("voters_resolved", false)
      .not("results_ingested_at", "is", null),
  ]);

  const { a, b } = discordTally(voters ?? [], counted ?? []);

  await admin
    .from("would_you_rather_trades")
    .update({ discord_votes_a: a, discord_votes_b: b })
    .eq("id", tradeId);
}

/**
 * One distinct person per identified row, plus the raw totals from the polls
 * that could only be counted.
 *
 * Separated out because it is the arithmetic the whole feature rests on and it
 * is worth being able to test without a database. The two inputs cannot
 * overlap: a poll is either read by voter or counted, and only the counted ones
 * are passed in here.
 */
export function discordTally(
  identified: Array<{ side: string | null }>,
  counted: Array<{ ingested_votes_a: number | null; ingested_votes_b: number | null }>,
): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const row of identified) {
    if (row.side === "a") a += 1;
    else if (row.side === "b") b += 1;
  }
  for (const row of counted) {
    a += row.ingested_votes_a ?? 0;
    b += row.ingested_votes_b ?? 0;
  }
  return { a, b };
}

export type { LoadedRound };
