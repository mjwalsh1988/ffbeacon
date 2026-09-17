/**
 * What the drafts route writes into articles.metadata for an edition, read
 * back defensively.
 *
 * The public page, the editions listing and the OG card all read the
 * ARTICLES row, which is public, rather than brief_editions, which is
 * service-role only and carries the review material. So the few facts a
 * public surface needs beyond the article columns travel on
 * articles.metadata, under these keys:
 *
 *   period_start    ISO instant the period opened
 *   period_end      ISO instant the period closed
 *   cadence         "weekly" | "biweekly" | "monthly"
 *   phase           "pre" | "regular" | "post" | "off". The one fact the
 *                   article columns cannot express: cadence stores a
 *                   pre-season period with week null, so without this a
 *                   pre-season edition reads as the off-season everywhere
 *                   and is marked up as Article rather than NewsArticle.
 *   formats         [{ slug, display }] the two edition formats
 *   source_display  the value source's display name
 *   stat_tiles      [{ label, value }] the headline figures, for the OG card
 *   datasets        { [dataset_id]: BundleDataset } the block-ready data the
 *                   edition's blocks reference (the bundle's `datasets`,
 *                   keyed by dataset id)
 *
 * Every key is optional here. A block whose dataset is missing renders its
 * caption, its conclusion and a "data not available" line rather than
 * throwing, and a card with no stat_tiles falls back to the week and season.
 *
 * Pure. No I/O.
 */

import { DATASET_KINDS, type DatasetKind } from "./blocks";
import { isEditionPhase, type EditionPhase } from "./period";
import type { BundleDataset } from "./types";

export interface EditionStatTile {
  label: string;
  value: string;
}

export interface EditionMeta {
  periodStart: string | null;
  periodEnd: string | null;
  cadence: string | null;
  phase: EditionPhase | null;
  formats: Array<{ slug: string; display: string }>;
  sourceDisplay: string | null;
  statTiles: EditionStatTile[];
  datasets: Record<string, BundleDataset>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function isCell(v: unknown): v is string | number | null {
  return v === null || typeof v === "string" || typeof v === "number";
}

/** One dataset, or null when the shape is not a dataset. */
export function parseDataset(id: string, raw: unknown): BundleDataset | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== "string" || !(DATASET_KINDS as readonly string[]).includes(kind)) return null;
  const columns = Array.isArray(raw.columns) ? raw.columns.filter((c): c is string => typeof c === "string") : [];
  const rows: BundleDataset["rows"] = [];
  if (Array.isArray(raw.rows)) {
    for (const row of raw.rows) {
      if (!isRecord(row)) continue;
      const clean: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(row)) {
        if (isCell(v)) clean[k] = v;
      }
      rows.push(clean);
    }
  }
  return {
    id: str(raw.id) ?? id,
    kind: kind as DatasetKind,
    title: str(raw.title) ?? "",
    columns,
    rows,
    source_note: str(raw.source_note) ?? "",
    computed_at: str(raw.computed_at) ?? "",
  };
}

export function parseEditionMetadata(raw: unknown): EditionMeta {
  const meta = isRecord(raw) ? raw : {};

  const formats: EditionMeta["formats"] = [];
  if (Array.isArray(meta.formats)) {
    for (const f of meta.formats) {
      if (!isRecord(f)) continue;
      const slug = str(f.slug);
      const display = str(f.display) ?? str(f.display_name);
      if (slug && display) formats.push({ slug, display });
    }
  }

  const statTiles: EditionStatTile[] = [];
  if (Array.isArray(meta.stat_tiles)) {
    for (const t of meta.stat_tiles) {
      if (!isRecord(t)) continue;
      const label = str(t.label);
      const value = t.value === null || t.value === undefined ? null : String(t.value).trim();
      if (label && value) statTiles.push({ label, value });
    }
  }

  const datasets: Record<string, BundleDataset> = {};
  if (isRecord(meta.datasets)) {
    for (const [id, d] of Object.entries(meta.datasets)) {
      const parsed = parseDataset(id, d);
      if (parsed) datasets[id] = parsed;
    }
  }

  // The OG card wants three figures. When the route did not write stat_tiles
  // but did write the tiles dataset, the first rows of that are the same thing.
  if (statTiles.length === 0) {
    const tiles = Object.values(datasets).find((d) => d.kind === "week_stat_tiles");
    for (const row of tiles?.rows ?? []) {
      const label = typeof row.label === "string" ? row.label : null;
      const value = row.value === null || row.value === undefined ? null : String(row.value);
      if (label && value) statTiles.push({ label, value });
    }
  }

  return {
    periodStart: str(meta.period_start),
    periodEnd: str(meta.period_end),
    cadence: str(meta.cadence),
    phase: isEditionPhase(meta.phase) ? meta.phase : null,
    formats,
    sourceDisplay: str(meta.source_display),
    statTiles,
    datasets,
  };
}
