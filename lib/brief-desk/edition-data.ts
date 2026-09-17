/**
 * The read behind the public edition page (plan section 11).
 *
 * An edition is an `articles` row (article_type 'brief', status published)
 * plus the validated draft on `brief_editions.draft_payload`. That table is
 * service-role only because it also carries the review material, so this is
 * the ONE place the public page touches it, with the admin client, for a
 * PUBLISHED article only, and it selects exactly draft_payload and the period
 * columns. research_log, validation_report and review_notes are never
 * selected here and never reach the page, the feed, the OG image or Discord.
 *
 * The block-ready datasets travel on articles.metadata.datasets (see
 * ./edition-metadata.ts for every key). The Relays the edition cites and the
 * players its blocks name are resolved through the public read paths, so a
 * retracted Relay is absent rather than leaked.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient, createCachedReadClient } from "@/lib/supabase/server";
import { loadArticle, type FullArticle } from "@/lib/beacon-brief-feed";
import { loadRelaysByIds, type RelayCardData } from "@/lib/relays/load";
import { draftSchema } from "./draft-schema";
import { parseEditionMetadata, type EditionMeta } from "./edition-metadata";
import type { Draft } from "./types";

export interface BlockPlayer {
  id: string;
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
}

export interface PublishedEdition {
  article: FullArticle;
  /** Null when the stored draft no longer parses; the page then renders content_md whole. */
  draft: Draft | null;
  season: string | null;
  week: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  cadence: string | null;
  meta: EditionMeta;
  /** Every published Relay the edition cites or quotes, by id. */
  relays: Record<string, RelayCardData>;
  /** Every player a block names, by id. */
  players: Record<string, BlockPlayer>;
}

type PublicClient = ReturnType<typeof createCachedReadClient>;

/** Player ids the draft's blocks name in their options. */
function blockPlayerIds(draft: Draft): string[] {
  const ids: string[] = [];
  for (const b of draft.blocks) {
    const o = b.options as { player_ids?: unknown; items?: unknown };
    if (Array.isArray(o.player_ids)) {
      for (const id of o.player_ids) if (typeof id === "string") ids.push(id);
    }
    if (Array.isArray(o.items)) {
      for (const item of o.items) {
        const id = (item as { player_id?: unknown })?.player_id;
        if (typeof id === "string") ids.push(id);
      }
    }
  }
  return [...new Set(ids)];
}

/** Relay ids the draft cites in sections or quotes in blocks. */
function draftRelayIds(draft: Draft): string[] {
  const ids: string[] = [];
  for (const s of draft.sections) ids.push(...s.relay_ids);
  for (const b of draft.blocks) {
    const id = (b.options as { relay_id?: unknown }).relay_id;
    if (typeof id === "string") ids.push(id);
  }
  return [...new Set(ids)];
}

async function loadBlockPlayers(supabase: PublicClient, ids: string[]): Promise<Record<string, BlockPlayer>> {
  const out: Record<string, BlockPlayer> = {};
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from("players")
    .select("id, slug, full_name, first_name, last_name, position, team")
    .in("id", ids.slice(0, 300));
  for (const p of data ?? []) {
    out[p.id] = {
      id: p.id,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team,
    };
  }
  return out;
}

/**
 * The published edition behind a slug, or null when the slug is not a
 * published Brief. The article is read through the public client; only the
 * draft payload and the period columns come through the admin client.
 *
 * `preloaded` is the article when the caller has already read it (the page
 * reads it once for generateMetadata and once for the body, through React
 * cache()); passing it saves the three duplicate reads loadArticle makes.
 */
export async function loadPublishedEdition(
  slug: string,
  preloaded?: FullArticle | null,
): Promise<PublishedEdition | null> {
  const supabase = createCachedReadClient();
  const article = preloaded === undefined ? await loadArticle(supabase, slug) : preloaded;
  if (!article || article.articleType !== "brief") return null;

  const admin: SupabaseClient<Database> = createAdminClient();
  const [{ data: row }, { data: articleRow }] = await Promise.all([
    admin
      .from("brief_editions")
      .select("draft_payload, season, week, period_start, period_end, cadence, relay_ids")
      .eq("article_id", article.id)
      .maybeSingle(),
    supabase.from("articles").select("metadata, season, week").eq("id", article.id).eq("status", "published").maybeSingle(),
  ]);

  const meta = parseEditionMetadata(articleRow?.metadata ?? null);
  const parsed = row ? draftSchema.safeParse(row.draft_payload) : null;
  const draft = parsed && parsed.success ? parsed.data : null;

  const relayIds = new Set<string>(row?.relay_ids ?? []);
  if (draft) for (const id of draftRelayIds(draft)) relayIds.add(id);

  const [relayCards, players] = await Promise.all([
    loadRelaysByIds(supabase, [...relayIds]),
    loadBlockPlayers(supabase, draft ? blockPlayerIds(draft) : []),
  ]);
  const relays: Record<string, RelayCardData> = {};
  for (const r of relayCards) relays[r.id] = r;

  return {
    article,
    draft,
    season: row?.season ?? (articleRow?.season !== null && articleRow?.season !== undefined ? String(articleRow.season) : null),
    week: row?.week ?? articleRow?.week ?? null,
    periodStart: row?.period_start ?? meta.periodStart,
    periodEnd: row?.period_end ?? meta.periodEnd,
    cadence: row?.cadence ?? meta.cadence,
    meta,
    relays,
    players,
  };
}
