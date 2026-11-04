/**
 * One Discord card per story: which story a post threads into, and which card
 * a follow-up joins.
 *
 * Two questions, answered here so curation, the Relay writer and the worker
 * all answer them the same way.
 *
 *   1. findThreadTarget: does this post quote, reply to, retweet or edit a post
 *      we already hold? X names the exact post, so this is a lookup, not a
 *      judgment. It is still gated on a shared subject (lib/beacon-brief/
 *      followup.ts sharesSubject), because a reporter's reply thread can move
 *      on to a different player, and folding that into the first player's card
 *      would bury it.
 *
 *   2. resolveCardHost: when a follow-up adds something new, does it join the
 *      story's existing card or get one of its own? It joins only when the card
 *      has not posted yet, or posted recently enough that an edit is still news:
 *      a Discord edit sends no notification, so editing an old card reaches
 *      nobody. A match the model made gets a much shorter window than one X
 *      proved (bb_discord_coalesce_minutes against bb_discord_edit_window_minutes),
 *      so a wrong guess can at worst add a line to a card posted a minute ago.
 *      Every doubt resolves toward posting a card of its own.
 *
 * A Relay that joins another card keeps its own row, its own page on the site
 * and its own follows_relay_id. Only relays.discord_card_ingestion_id says
 * where it is shown in Discord.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { sharesSubject, type FollowupCandidate, type PostSubject } from "@/lib/beacon-brief/followup";
import { discordSnowflakeTimeMs } from "@/lib/beacon-brief/thread";
import type { QueueJobPayload } from "@/lib/beacon-brief/types";
import { parseRelayFacts, type RelayRow } from "./types";

type Admin = SupabaseClient<Database>;

/**
 * Most updates one card carries. Past it a follow-up gets its own card. Keeps
 * the combined embed inside Discord's limit with every headline intact (see
 * renderCombinedRelayEmbed), and a story with nine updates in half an hour
 * deserves a fresh notification anyway.
 */
export const MAX_CARD_UPDATES = 8;

/** How a post was matched to the story it follows. */
export type MatchRoute = "thread" | "event_key" | "model";

/** Native post ids are digits. Anything else is refused before it reaches a filter. */
const POST_ID = /^\d{1,25}$/;

export interface ThreadTarget {
  target: FollowupCandidate;
  /**
   * True when every link from the post to the story's Relay is one X made AND
   * the two share a subject strongly enough (threadLinkProven). False gets
   * the model's short window.
   */
  proven: boolean;
}

function intersects(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

/**
 * Whether a thread link is strong enough for the long edit window, or only
 * for the short coalesce window a model match gets. Pure, so it is tested.
 *
 *   - foldedByX: every hop from the post X names to the Relay is X's own (the
 *     Relay is that post's, or the post is a native edit of it).
 *   - viaReplyOnly: the only link is a reply, which can change subject.
 *
 * Proven needs a shared PLAYER, or, for a quote, retweet or edit, a shared
 * team when either side names no player. A link that passed the subject gate
 * only because one side named nobody we could resolve is not proven: it may
 * still join a card, but only inside the short window.
 */
export function threadLinkProven(opts: {
  foldedByX: boolean;
  viaReplyOnly: boolean;
  post: PostSubject;
  target: Pick<FollowupCandidate, "player_ids" | "team_ids">;
}): boolean {
  if (!opts.foldedByX) return false;
  const { post, target } = opts;
  if (post.playerIds.length > 0 && target.player_ids.length > 0) {
    return intersects(post.playerIds, target.player_ids);
  }
  if (opts.viaReplyOnly) return false;
  return post.teamIds.length > 0 && target.team_ids.length > 0 && intersects(post.teamIds, target.team_ids);
}

/**
 * The story this post threads into, or null. Looks at posts ingested inside
 * the event-key window only: a quote of a month-old post is commentary on an
 * old story, not the same news. Only a PUBLISHED story is a target: a hidden
 * one shows nowhere, and folding a post into it would hide the post too.
 *
 * `replyIds` is the subset of `postIds` this post replies to (repliedToIds).
 */
export async function findThreadTarget(
  admin: Admin,
  opts: { postIds: string[]; replyIds?: string[]; windowHours: number; subject: PostSubject },
): Promise<{ found: ThreadTarget | null; rejected: string | null }> {
  const ids = [...new Set(opts.postIds.filter((id) => POST_ID.test(id)))];
  if (ids.length === 0) return { found: null, rejected: null };
  const replyOnly = new Set(opts.replyIds ?? []);
  const strongIds = ids.filter((id) => !replyOnly.has(id));
  const hours = opts.windowHours > 0 ? opts.windowHours : 72;
  const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();

  const { data: rows, error } = await admin
    .from("news_ingestions")
    .select("id, is_revision, revision_of_ingestion_id, context_score, created_at, source_external_ids")
    .overlaps("source_external_ids", ids)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !rows || rows.length === 0) return { found: null, rejected: null };

  const ingestionIds = new Set<string>();
  for (const r of rows) {
    ingestionIds.add(r.id);
    if (r.is_revision && r.revision_of_ingestion_id) ingestionIds.add(r.revision_of_ingestion_id);
  }
  const { data: relays } = await admin
    .from("relays")
    .select("id, ingestion_id, headline, facts, status")
    .in("ingestion_id", [...ingestionIds])
    .in("status", ["published", "hidden"]);
  const relayByIngestion = new Map((relays ?? []).map((r) => [r.ingestion_id, r]));

  // Each referenced post, newest first, resolved to the Relay that tells its
  // story: its own, or (for a post recorded as a revision) the one it was
  // folded into. A native edit is the only revision written without a
  // classification, so a null context_score marks the fold as one X made.
  const options: Array<{ relay: NonNullable<typeof relays>[number]; foldedByX: boolean; viaReplyOnly: boolean }> = [];
  for (const r of rows) {
    const viaReplyOnly = !intersects(r.source_external_ids ?? [], strongIds);
    const own = relayByIngestion.get(r.id);
    if (own) {
      options.push({ relay: own, foldedByX: true, viaReplyOnly });
      continue;
    }
    if (r.is_revision && r.revision_of_ingestion_id) {
      const folded = relayByIngestion.get(r.revision_of_ingestion_id);
      if (folded) options.push({ relay: folded, foldedByX: r.context_score === null, viaReplyOnly });
    }
  }
  const pick = options.find((o) => o.relay.status === "published");
  if (!pick) return { found: null, rejected: null };

  const [{ data: rp }, { data: rt }] = await Promise.all([
    admin.from("relay_players").select("player_id").eq("relay_id", pick.relay.id),
    admin.from("relay_teams").select("team_id").eq("relay_id", pick.relay.id),
  ]);
  const target: FollowupCandidate = {
    ingestion_id: pick.relay.ingestion_id,
    article_id: null,
    relay_id: pick.relay.id,
    title: pick.relay.headline,
    summary: parseRelayFacts(pick.relay.facts)
      .map((f) => `${f.label}: ${f.value}`)
      .join(". "),
    player_ids: (rp ?? []).map((r) => r.player_id),
    team_ids: (rt ?? []).map((r) => r.team_id),
  };
  if (!sharesSubject(opts.subject, target)) {
    return {
      found: null,
      rejected: `points at the post behind "${target.title}" but names none of the same players or teams, so it is treated as its own story`,
    };
  }
  const proven = threadLinkProven({
    foldedByX: pick.foldedByX,
    viaReplyOnly: pick.viaReplyOnly,
    post: opts.subject,
    target,
  });
  return { found: { target, proven }, rejected: null };
}

/** The open discord_post job for one ingestion, if any. */
export async function pendingDiscordPost(
  admin: Admin,
  ingestionId: string,
): Promise<{ runAfter: string } | null> {
  const { data } = await admin
    .from("beacon_brief_queue")
    .select("run_after")
    .eq("job_type", "discord_post")
    .in("status", ["pending", "processing"])
    .filter("payload->>ingestion_id", "eq", ingestionId)
    .order("run_after", { ascending: false })
    .limit(1);
  const row = data?.[0];
  return row ? { runAfter: row.run_after } : null;
}

/** The ingestion id whose Discord card shows this Relay. */
export function cardHostId(relay: Pick<RelayRow, "ingestion_id" | "discord_card_ingestion_id">): string {
  return relay.discord_card_ingestion_id ?? relay.ingestion_id;
}

/**
 * Which card a new follow-up of `targetRelay` joins, or null for a card of its
 * own. `why` says which, for the log.
 */
export async function resolveCardHost(
  admin: Admin,
  opts: {
    targetRelay: RelayRow | null;
    route: MatchRoute;
    editWindowMinutes: number;
    coalesceMinutes: number;
    nowMs?: number;
  },
): Promise<{ hostIngestionId: string | null; why: string }> {
  const { targetRelay } = opts;
  if (!targetRelay) return { hostIngestionId: null, why: "the matched story has no Relay" };
  // A proof reaches only as far as the Relay it points at. When that Relay is
  // itself shown on ANOTHER post's card, the hop from it to that card was made
  // by a match we cannot prove, so the whole link gets the short window.
  const route: MatchRoute =
    opts.route !== "model" && targetRelay.discord_card_ingestion_id ? "model" : opts.route;
  const windowMinutes = route === "model" ? opts.coalesceMinutes : opts.editWindowMinutes;
  if (!(windowMinutes > 0)) {
    return { hostIngestionId: null, why: `combining is off for ${route} matches` };
  }

  const hostId = cardHostId(targetRelay);
  let hostRelay: RelayRow | null = targetRelay;
  if (hostId !== targetRelay.ingestion_id) {
    const { data } = await admin.from("relays").select("*").eq("ingestion_id", hostId).maybeSingle();
    hostRelay = data ?? null;
  }
  // The card must be showing a published story, and must be a card in its own
  // right (a host is never itself folded into another card).
  if (!hostRelay || hostRelay.status !== "published" || hostRelay.discord_card_ingestion_id) {
    return { hostIngestionId: null, why: "the story's card is not showing a published Relay" };
  }

  const { count } = await admin
    .from("relays")
    .select("id", { count: "exact", head: true })
    .eq("discord_card_ingestion_id", hostId);
  if ((count ?? 0) >= MAX_CARD_UPDATES) {
    return { hostIngestionId: null, why: `the story's card already carries ${count} updates` };
  }

  const { data: host } = await admin
    .from("news_ingestions")
    .select("id, discord_message_id, created_at")
    .eq("id", hostId)
    .maybeSingle();
  if (!host) return { hostIngestionId: null, why: "the story's post row is gone" };

  if (host.discord_message_id) {
    const postedMs = discordSnowflakeTimeMs(host.discord_message_id) ?? new Date(host.created_at).getTime();
    const ageMinutes = ((opts.nowMs ?? Date.now()) - postedMs) / 60_000;
    if (ageMinutes <= windowMinutes) {
      return {
        hostIngestionId: hostId,
        why: `joining the story's card, posted ${Math.max(0, Math.round(ageMinutes))} minute(s) ago (${route} match, window ${windowMinutes})`,
      };
    }
    return {
      hostIngestionId: null,
      why: `the story's card is ${Math.round(ageMinutes)} minutes old (${route} match, window ${windowMinutes}); posting a card of its own`,
    };
  }

  if (await pendingDiscordPost(admin, hostId)) {
    return { hostIngestionId: hostId, why: `joining the story's card, which has not posted yet (${route} match)` };
  }
  return { hostIngestionId: null, why: "the story's card was never posted; posting a card of its own" };
}

/**
 * A Relay shown on another post's card has just been PUBLISHED again (it was
 * hidden, and an admin or a grounded edit brought it back). Re-rendering the
 * story's card would add it as a silent edit, which is fine while the card is
 * young and reaches nobody once it is old. So: inside the edit window (or
 * while the card has not posted) the card is refreshed; past it the Relay is
 * detached and gets a card of its own.
 */
export async function republishAttachedRelay(
  admin: Admin,
  relay: Pick<RelayRow, "id" | "ingestion_id" | "discord_card_ingestion_id">,
  editWindowMinutes: number,
): Promise<"refreshed" | "own_card"> {
  const hostId = relay.discord_card_ingestion_id;
  if (hostId) {
    const { data: host } = await admin
      .from("news_ingestions")
      .select("id, discord_message_id, created_at")
      .eq("id", hostId)
      .maybeSingle();
    let joinable = false;
    if (host?.discord_message_id) {
      const postedMs = discordSnowflakeTimeMs(host.discord_message_id) ?? new Date(host.created_at).getTime();
      joinable = editWindowMinutes > 0 && (Date.now() - postedMs) / 60_000 <= editWindowMinutes;
    } else if (host) {
      joinable = Boolean(await pendingDiscordPost(admin, hostId));
    }
    if (joinable) {
      await enqueueCardRefresh(admin, { hostIngestionId: hostId, triggerIngestionId: relay.ingestion_id });
      return "refreshed";
    }
  }
  await admin.from("relays").update({ discord_card_ingestion_id: null }).eq("id", relay.id);
  const payload: QueueJobPayload = { ingestion_id: relay.ingestion_id, relay_id: relay.id, role_ids: [] };
  await admin.from("beacon_brief_queue").insert({
    job_type: "discord_post",
    payload: payload as unknown as Json,
    status: "pending",
    run_after: new Date().toISOString(),
  });
  return "own_card";
}

/** The published-or-not Relays folded into a host's card, oldest first. */
export async function loadCardUpdates(admin: Admin, hostIngestionId: string): Promise<RelayRow[]> {
  const { data } = await admin
    .from("relays")
    .select("*")
    .eq("discord_card_ingestion_id", hostIngestionId)
    .order("source_posted_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_CARD_UPDATES * 4);
  return data ?? [];
}

/**
 * Queue a re-render of a host's card. A refresh renders the card's state when
 * it RUNS, so one still pending covers every update written before it is
 * claimed; a second is queued only when none is pending. It is scheduled just
 * after the host's own post when that has not gone out yet, and the worker
 * defers it again if the post is still in flight.
 */
export async function enqueueCardRefresh(
  admin: Admin,
  opts: { hostIngestionId: string; triggerIngestionId: string },
): Promise<boolean> {
  const { data: existing } = await admin
    .from("beacon_brief_queue")
    .select("id")
    .eq("job_type", "discord_patch")
    .eq("status", "pending")
    .filter("payload->>card_refresh", "eq", "true")
    .filter("payload->>target_ingestion_id", "eq", opts.hostIngestionId)
    .limit(1);
  if (existing && existing.length > 0) return true;

  const pending = await pendingDiscordPost(admin, opts.hostIngestionId);
  const runAfterMs = Math.max(Date.now(), pending ? new Date(pending.runAfter).getTime() + 15_000 : 0);
  const payload: QueueJobPayload = {
    ingestion_id: opts.triggerIngestionId,
    target_ingestion_id: opts.hostIngestionId,
    card_refresh: true,
  };
  const { error } = await admin.from("beacon_brief_queue").insert({
    job_type: "discord_patch",
    payload: payload as unknown as Json,
    status: "pending",
    run_after: new Date(runAfterMs).toISOString(),
  });
  return !error;
}
