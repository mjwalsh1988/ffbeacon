/**
 * What the drafts route and the backfill (./backfill.ts) both need to turn a
 * validated draft into stored rows: the validator's view of the bundle, the
 * datasets an edition carries onto articles.metadata, and that metadata
 * object. One copy, so a backfilled edition is stored exactly the way a
 * routine-drafted one is.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { COMPANION_DATASETS, isBlockKind } from "./blocks";
import type { Bundle, BundleDataset, Draft } from "./types";
import type { ValidationContext } from "./validate-draft";

type Admin = SupabaseClient<Database>;

/**
 * The validator's view of the bundle, plus which of the draft's slugs are
 * taken. `ownSlug` is the slug of the edition a backfill is replacing, which
 * is "taken" only by the very article it will overwrite.
 */
export async function buildValidationContext(
  admin: Admin,
  bundle: Bundle,
  draft: Draft,
  opts?: { ownSlug?: string },
): Promise<ValidationContext> {
  const candidates = [draft.slug, ...(draft.title_options ?? []).map((o) => o.slug)];
  const [{ data: articles }, { data: relays }] = await Promise.all([
    admin.from("articles").select("slug").in("slug", candidates),
    admin.from("relays").select("slug").in("slug", candidates),
  ]);
  const existingSlugs = new Set<string>([...(articles ?? []).map((a) => a.slug), ...(relays ?? []).map((r) => r.slug)]);
  if (opts?.ownSlug) existingSlugs.delete(opts.ownSlug);
  const datasets: ValidationContext["datasets"] = {};
  for (const [id, d] of Object.entries(bundle.datasets)) datasets[id] = d.kind;
  return {
    period: {
      season: bundle.edition.season,
      week: bundle.edition.week,
      phase: bundle.edition.phase,
      preSeasonWeek: bundle.edition.pre_season_week,
      periodStart: bundle.edition.period_start,
      periodEnd: bundle.edition.period_end,
    },
    relays: bundle.relays.map((r) => ({ id: r.id, relevance_tier: r.relevance_tier, headline: r.headline })),
    datasets,
    // The Relays' players plus the waiver targets. action_list is fed by the
    // waiver_targets dataset, and its cards render from the players table by
    // id, so refusing a card for the very player the dataset recommends (a
    // riser nobody filed a report about) left the list unable to do its job.
    playerIds: new Set([
      ...Object.keys(bundle.players),
      ...(bundle.datasets.waiver_targets?.rows ?? []).map((r) => String(r.player_id)),
    ]),
    existingSlugs,
    games: (bundle.game_index ?? []).map((g) => ({ game_key: g.game_key, player_ids: g.player_ids })),
  };
}

/**
 * Only the datasets the draft's blocks reference travel to the article, each
 * whole, plus each block kind's companions (game_cards reads its players from
 * game_player_lines). The rest of the bundle stays in brief_editions.
 */
export function referencedDatasets(bundle: Bundle, draft: Draft): Record<string, BundleDataset> {
  const out: Record<string, BundleDataset> = {};
  for (const b of draft.blocks) {
    const d = b.dataset_id ? bundle.datasets[b.dataset_id] : undefined;
    if (d) out[d.id] = d;
    if (isBlockKind(b.kind)) {
      for (const id of COMPANION_DATASETS[b.kind] ?? []) {
        const companion = bundle.datasets[id];
        if (companion) out[companion.id] = companion;
      }
    }
  }
  return out;
}

/** articles.metadata for an edition (see ./edition-metadata.ts for every key). */
export function editionArticleMetadata(bundle: Bundle, draft: Draft): Record<string, unknown> {
  const e = bundle.edition;
  const statTiles = (bundle.datasets.week_stat_tiles?.rows ?? [])
    .map((row) => ({ label: row.label, value: row.value }))
    .filter((t): t is { label: string; value: string } => typeof t.label === "string" && t.value !== null && t.value !== undefined)
    .map((t) => ({ label: t.label, value: String(t.value) }));
  return {
    period_start: e.period_start,
    period_end: e.period_end,
    cadence: e.cadence,
    phase: e.phase,
    formats: bundle.context.formats.map((f) => ({ slug: f.slug, display: f.display })),
    source_display: bundle.context.source_display,
    stat_tiles: statTiles,
    datasets: referencedDatasets(bundle, draft),
  };
}
