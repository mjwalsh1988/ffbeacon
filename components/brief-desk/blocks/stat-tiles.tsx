/**
 * stat_tiles: the period's league-wide figures as tiles.
 *
 * Each tile is ONE text node, "Reports this period: 41", per the site's rule
 * against drawing a number twice. No aria-hidden twin for the eye, no sr-only
 * twin for the ear. The optional detail line is a second, separate sentence.
 *
 * Server component.
 */

import type { BundleDataset } from "@/lib/brief-desk/types";
import { readText } from "@/lib/brief-desk/dataset-read";
import { BlockShell } from "./block-shell";

export function StatTilesBlock({
  id,
  caption,
  conclusion,
  dataset,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset;
}) {
  /** "+1961" as "+1,961", matching the prose; some screen readers read a bare four-digit number as a year. */
  const groupThousands = (s: string) => s.replace(/\d{4,}/g, (d) => Number(d).toLocaleString("en-US"));
  const tiles = dataset.rows
    .map((row) => ({
      label: readText(row, ["label", "name"]),
      value: readText(row, ["value"]),
      detail: readText(row, ["detail", "note"]),
    }))
    .filter((t): t is { label: string; value: string; detail: string | null } => Boolean(t.label && t.value));

  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
      {tiles.length === 0 ? (
        <p className="text-sm text-ink-muted">No figures were recorded for this period.</p>
      ) : (
        <ul role="list" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((t) => (
            <li key={t.label} className="rounded-card border border-line bg-surface/60 px-3 py-3">
              {/* One paragraph, read as "Label: value". The label is set small
                  and the value large, like the other figure blocks, and the
                  colon stays in the text for the ear. */}
              <p className="leading-snug">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{`${t.label}:`}</span>{" "}
                <span className="mt-1 block font-mono text-lg font-bold tabular-nums text-ink">{groupThousands(t.value)}</span>
              </p>
              {t.detail && <p className="mt-1 text-xs leading-snug text-ink-subtle">{t.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </BlockShell>
  );
}
