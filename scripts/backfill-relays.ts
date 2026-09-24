/**
 * One-time backfill: every archived Beacon Brief post becomes a Relay.
 *
 * docs/beacon-brief/relays-and-briefs-plan.md, section 14.1. NEVER scheduled.
 * Dry run is the DEFAULT; nothing is written without --apply. Idempotent on
 * relays.ingestion_id, so a re-run skips every post that already has a Relay.
 *
 * What it does, per news_ingestions row whose status is published, revised or
 * dropped_no_context (filtered, deleted and error rows are skipped):
 *
 *   1. Runs the extended classify call on the stored post text (the raw post
 *      is in metadata; no X reads happen). The non-football and relevance
 *      gates apply exactly as they do live, so an old low-relevance story
 *      becomes nothing, which is the point of replaying the gates.
 *   2. Resolves references: the article's own article_players and
 *      article_teams when the post produced an article (those links were
 *      already reviewed), else the matcher's confident ids.
 *   3. Runs the grounding check and writes the Relay through writeRelay with
 *      discord: false. A failing Relay is written hidden and lands in the
 *      moderation queue like a live one. An old report must never go out to
 *      the channel as if it were news: nothing here writes to
 *      beacon_brief_queue, and the run asserts that no Discord job names any
 *      Relay it wrote.
 *   4. Revisions are processed after their roots so follows_relay_id can point
 *      at the root's Relay, and the merge gate decides whether the revision
 *      adds anything; one that does not becomes no Relay.
 *
 * Cost: about one Haiku call per row on short posts, under a few dollars for
 * the whole archive. Run with --dry-run (the default) and a --limit first, read
 * the grounding failures it prints, then run with --apply.
 *
 *   npm run backfill:relays -- --limit 25
 *   npm run backfill:relays -- --apply
 */

import { getServiceClient } from "./_supabase";
import { runStructuredCall } from "../lib/beacon-brief/ai";
import { loadBeaconBriefSettings } from "../lib/beacon-brief/settings";
import { loadBriefDeskSettings } from "../lib/brief-desk/settings";
import { matchReferences } from "../lib/beacon-brief/match";
import { postAddsNewInformation } from "../lib/beacon-brief/merge";
import type { CategorizeResultWithRelay } from "../lib/beacon-brief/types";
import { RELAY_SCHEMA_FRAGMENT, withRelaySection } from "../lib/relays/extract";
import { parseRelayFacts } from "../lib/relays/types";
import { assessRelay, loadRelayForIngestion, updateRelayText, writeRelay } from "../lib/relays/write";
import { parseRelayFacts as parseStoredFacts } from "../lib/relays/types";
import { assignRelayWeek } from "../lib/relays/week";
import { getNflState } from "../lib/sleeper";
import type { Database } from "../lib/database.types";

type Ingestion = Database["public"]["Tables"]["news_ingestions"]["Row"];

const BACKFILL_STATUSES = ["published", "revised", "dropped_no_context"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "non_football",
    "relevance_tier",
    "relevance_reason",
    "context_score",
    "category_slug",
    "players",
    "teams",
    "tags",
    "suggested_title",
    "suggested_slug",
    "relay",
  ],
  properties: {
    non_football: { type: "integer" },
    relevance_tier: { type: "integer" },
    relevance_reason: { type: "string" },
    context_score: { type: "integer" },
    category_slug: { type: "string" },
    players: { type: "array", items: { type: "string" } },
    teams: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    suggested_title: { type: "string" },
    suggested_slug: { type: "string" },
    relay: RELAY_SCHEMA_FRAGMENT,
  },
} as const;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function compactFromRow(row: Ingestion) {
  const media = Array.isArray(row.media)
    ? (row.media as Array<{ type?: unknown }>).map((m) => (m && typeof m.type === "string" ? m.type : "media"))
    : [];
  const q = row.quoted as { text?: string; author_handle?: string | null } | null;
  const r = row.retweeted as { text?: string; author_handle?: string | null } | null;
  return {
    text: row.text ?? "",
    author_handle: row.author_handle ?? "",
    media,
    quoted: q && typeof q.text === "string" ? { text: q.text, author_handle: q.author_handle ?? null } : null,
    retweeted: r && typeof r.text === "string" ? { text: r.text, author_handle: r.author_handle ?? null } : null,
  };
}

/** Any Discord job, in any state, naming one of the Relays this run wrote. */
async function queuedDiscordJobsFor(
  admin: ReturnType<typeof getServiceClient>,
  relayIds: string[],
): Promise<number> {
  let total = 0;
  for (let i = 0; i < relayIds.length; i += 200) {
    const batch = relayIds.slice(i, i + 200);
    if (batch.length === 0) break;
    const { count } = await admin
      .from("beacon_brief_queue")
      .select("*", { count: "exact", head: true })
      .in("job_type", ["discord_post", "discord_patch"])
      .in("payload->>relay_id", batch);
    total += count ?? 0;
  }
  return total;
}

/** The post's own timestamp from the raw X object, or the ingestion's clock. */
function backfillPostedAt(row: Ingestion): string {
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const created = (meta as { created_at?: unknown }).created_at;
    if (typeof created === "string" && !Number.isNaN(new Date(created).getTime())) {
      return new Date(created).toISOString();
    }
  }
  return row.created_at;
}

/**
 * --recheck-hidden: re-run the grounding check on every Relay that was written
 * hidden for grounding, with its stored text, and publish the ones that now
 * pass. Used after the check itself is refined, so a Relay held back by a rule
 * that has since been corrected does not wait on a hand edit.
 *
 * NO DISCORD CARD IS EVER QUEUED HERE. `updateRelayText` takes `discord: false`
 * and writes no queue row at all. The earlier shape wrote one and deleted it
 * afterwards, which is not the same thing: the worker runs every minute, and a
 * job it claimed inside that window is no longer pending for the delete to
 * find. An old report must never go out to the channel as if it were news.
 */
async function recheckHidden(admin: ReturnType<typeof getServiceClient>, apply: boolean): Promise<void> {
  type HiddenRelay = Pick<
    Database["public"]["Tables"]["relays"]["Row"],
    "id" | "ingestion_id" | "headline" | "facts" | "timeline"
  >;
  const rows: HiddenRelay[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await admin
      .from("relays")
      .select("id, ingestion_id, headline, facts, timeline")
      .eq("status", "hidden")
      .eq("status_reason", "grounding")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`hidden relays read failed at row ${from}: ${error.message}`);
    rows.push(...(page ?? []));
    if ((page?.length ?? 0) < 1000) break;
  }
  console.log(`${rows.length} hidden relay(s) to re-check. ${apply ? "APPLY" : "Dry run"}.`);
  let passed = 0;
  for (const r of rows) {
    if (!apply) {
      const { data: ingestion } = await admin
        .from("news_ingestions")
        .select("id, text, quoted, retweeted, author_handle, external_url, created_at, metadata")
        .eq("id", r.ingestion_id)
        .maybeSingle();
      if (!ingestion) {
        console.log(`skipped ${r.id}: the source post is gone`);
        continue;
      }
      const assessed = await assessRelay(admin, {
        ingestion,
        ai: { relay: { headline: r.headline, kind: "other", facts: parseStoredFacts(r.facts), timeline: r.timeline, availability: "none" } } as never,
        refs: { categoryId: null, playerIds: [], teamIds: [] },
        nflState: null,
        discord: false,
      });
      // The dry run has no join rows on hand, so it under-reports passes.
      if (assessed?.status === "published") passed += 1;
      continue;
    }
    const out = await updateRelayText(
      admin,
      r.id,
      { headline: r.headline, facts: parseStoredFacts(r.facts), timeline: r.timeline },
      { publishIfGrounded: true, discord: false },
    );
    if (out.ok && out.status === "published") {
      passed += 1;
      console.log(`published ${r.id}: ${r.headline}`);
    }
  }
  console.log(`${passed} of ${rows.length} now pass.`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Number(arg("limit") ?? "0") || 0;
  const admin = getServiceClient();
  if (process.argv.includes("--recheck-hidden")) {
    await recheckHidden(admin, apply);
    return;
  }

  const [settings, desk, nflState, categories] = await Promise.all([
    loadBeaconBriefSettings(admin),
    loadBriefDeskSettings(admin),
    getNflState(),
    admin.from("news_categories").select("slug").eq("is_active", true).order("display_order"),
  ]);
  const categorySlugs = (categories.data ?? []).map((c) => c.slug).join(", ");
  const system = withRelaySection(settings.prompts.categorize || "", desk.relayExtractPrompt).replace(
    "{categories}",
    categorySlugs,
  );
  if (!nflState?.season_start_date) {
    console.warn("Sleeper state carries no season_start_date; week assignment will use the live phase only.");
  }

  // Roots first, oldest first, so a revision's follows target exists by the time it is reached.
  const rows: Ingestion[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("news_ingestions")
      .select("*")
      .in("status", BACKFILL_STATUSES)
      .order("is_revision", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const todo = limit > 0 ? rows.slice(0, limit) : rows;
  console.log(`${rows.length} candidate post(s); processing ${todo.length}. ${apply ? "APPLY" : "Dry run"}.`);

  const counts = { existed: 0, filtered: 0, folded: 0, published: 0, hidden: 0, failed: 0 };
  const byWeek = new Map<string, number>();
  const writtenRelayIds: string[] = [];
  const groundingFailures: string[] = [];

  for (const [i, row] of todo.entries()) {
    const label = `[${i + 1}/${todo.length}] ${row.id.slice(0, 8)}`;
    if (await loadRelayForIngestion(admin, row.id)) {
      counts.existed += 1;
      continue;
    }
    const ai = await runStructuredCall<CategorizeResultWithRelay>({
      admin,
      stage: "categorize",
      model: settings.modelTriage,
      system,
      userContent: JSON.stringify(compactFromRow(row)),
      schema: SCHEMA as unknown as Record<string, unknown>,
      ingestionId: row.id,
      sourceId: row.source_id,
      maxTokens: 1536,
    });
    if (!ai) {
      counts.failed += 1;
      console.log(`${label} classify failed`);
      continue;
    }
    if ((ai.non_football ?? 0) === 1 || (ai.relevance_tier ?? 0) < settings.relevanceThreshold) {
      counts.filtered += 1;
      console.log(`${label} dropped by the gates (tier ${ai.relevance_tier}): ${ai.relevance_reason}`);
      continue;
    }

    // References: the reviewed article links when there are any, else the matcher.
    let refs: { categoryId: string | null; playerIds: string[]; teamIds: string[] } | null = null;
    if (row.article_id) {
      const [{ data: ap }, { data: at }, { data: art }] = await Promise.all([
        admin.from("article_players").select("player_id").eq("article_id", row.article_id),
        admin.from("article_teams").select("team_id").eq("article_id", row.article_id),
        admin.from("articles").select("category_id").eq("id", row.article_id).maybeSingle(),
      ]);
      if ((ap && ap.length > 0) || (at && at.length > 0)) {
        refs = {
          categoryId: art?.category_id ?? null,
          playerIds: (ap ?? []).map((p) => p.player_id),
          teamIds: (at ?? []).map((t) => t.team_id),
        };
      }
    }
    if (!refs) {
      const matched = await matchReferences(admin, ai, settings);
      refs = { categoryId: matched.categoryId, playerIds: matched.playerIds, teamIds: matched.teamIds };
    }

    // A revision follows its root's Relay, and only when the merge gate says it adds something.
    let followsRelayId: string | null = null;
    if (row.is_revision && row.revision_of_ingestion_id) {
      const root = await loadRelayForIngestion(admin, row.revision_of_ingestion_id);
      if (root) {
        followsRelayId = root.id;
        const gate = await postAddsNewInformation({
          admin,
          settings,
          article: {
            title: root.headline,
            tl_dr: parseRelayFacts(root.facts).map((f) => `${f.label}: ${f.value}`).join(". "),
            content_md: root.timeline,
          },
          post: compactFromRow(row),
          ingestionId: row.id,
        });
        if (!gate.addsNewInformation) {
          counts.folded += 1;
          console.log(`${label} folded into ${root.slug}: adds nothing`);
          continue;
        }
      }
    }

    const input = { ingestion: row, ai, refs, nflState, followsRelayId, discord: false as const };
    if (!apply) {
      const assessed = await assessRelay(admin, input);
      if (!assessed) {
        counts.failed += 1;
        console.log(`${label} no usable headline`);
        continue;
      }
      if (assessed.status === "hidden") {
        counts.hidden += 1;
        groundingFailures.push(
          `${row.id}: ${assessed.extraction.headline} :: ${assessed.failures.map((f) => `${f.token} (${f.check})`).join(", ") || assessed.statusReason}`,
        );
      } else {
        counts.published += 1;
      }
      // The dry run is what gets read first, so it reports the by-week spread
      // too. The week comes from the post's own timestamp, the same input the
      // write path uses.
      const week = assignRelayWeek(nflState, backfillPostedAt(row));
      const key = `${week.season} week ${week.week ?? week.phase}`;
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
      console.log(`${label} ${assessed.status}: ${assessed.extraction.headline}`);
      continue;
    }

    try {
      const written = await writeRelay(admin, input);
      if (written.existed) counts.existed += 1;
      else if (written.status === "hidden") {
        counts.hidden += 1;
        groundingFailures.push(
          `${row.id}: ${written.groundingFailures.map((f) => `${f.token} (${f.check})`).join(", ") || written.statusReason}`,
        );
      } else counts.published += 1;
      if (written.discordQueued) throw new Error("a backfill write enqueued a Discord job; this must never happen");
      writtenRelayIds.push(written.relayId);
      const { data: relay } = await admin.from("relays").select("season, week").eq("id", written.relayId).maybeSingle();
      const key = `${relay?.season ?? "?"} week ${relay?.week ?? "off"}`;
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
      console.log(`${label} ${written.status} ${written.slug}`);
    } catch (err) {
      counts.failed += 1;
      console.log(`${label} write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The guard is scoped to the Relays this run wrote, not to a global pending
  // count. The five-minute curation cron and the one-minute worker both move
  // that queue, so a before-and-after total is a report about the site rather
  // than a statement about this run, and it false-positives on any long --apply.
  const queued = await queuedDiscordJobsFor(admin, writtenRelayIds);
  console.log("\nCounts:", counts);
  if (byWeek.size > 0) {
    console.log("By week:");
    for (const [k, v] of [...byWeek.entries()].sort()) console.log(`  ${k}: ${v}`);
  }
  if (groundingFailures.length > 0) {
    console.log(`\nGrounding failures (${groundingFailures.length}):`);
    for (const line of groundingFailures) console.log(`  ${line}`);
  }
  console.log(`\nDiscord jobs for the ${writtenRelayIds.length} Relay(s) this run wrote: ${queued}.`);
  if (queued > 0) {
    throw new Error("a backfilled Relay has a Discord job; an old report must never go out as news");
  }
  if (!apply) console.log("Dry run. Nothing was written. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
