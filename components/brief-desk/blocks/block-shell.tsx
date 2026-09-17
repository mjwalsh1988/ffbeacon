/**
 * The furniture every non-chart block shares: a section labelled by its
 * caption (an h3, because a block sits inside an h2 section of the edition),
 * the conclusion sentence in reading order before the content, the content,
 * and the dataset's provenance line under it. Chart blocks use ChartFigure
 * from components/chart-kit.tsx for the same trio and append the same footer.
 *
 * Nothing visible here is aria-hidden. Server component.
 */

import type { ReactNode } from "react";
import { formatEastern } from "@/lib/datetime";
import type { BundleDataset } from "@/lib/brief-desk/types";

/** "Computed Sep 15, 2026, 9:05 AM EDT. Source note." under a block. */
export function DatasetFooter({ dataset }: { dataset: BundleDataset | null }) {
  if (!dataset) return null;
  const computed = dataset.computed_at ? formatEastern(dataset.computed_at) : null;
  const note = dataset.source_note?.trim();
  if (!computed && !note) return null;
  return (
    <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
      {computed && computed !== "n/a" && (
        <>
          Computed <time dateTime={dataset.computed_at}>{computed}</time>.{" "}
        </>
      )}
      {note}
    </p>
  );
}

export function BlockShell({
  id,
  caption,
  conclusion,
  dataset,
  children,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset | null;
  children: ReactNode;
}) {
  const headingId = `block-${id}-caption`;
  return (
    <section aria-labelledby={headingId} className="my-6 rounded-card border border-line bg-base/40 p-4 sm:p-5">
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        {caption || dataset?.title || "Figure"}
      </h3>
      {conclusion && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{conclusion}</p>}
      <div className="mt-3">{children}</div>
      <DatasetFooter dataset={dataset} />
    </section>
  );
}

/** What a block renders when its dataset did not travel with the article. */
export function BlockDataMissing({ id, caption, conclusion }: { id: string; caption: string; conclusion: string }) {
  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={null}>
      <p className="rounded-card border border-dashed border-line px-4 py-4 text-sm text-ink-muted">
        The data behind this figure is not available.
      </p>
    </BlockShell>
  );
}

/** The shared link style for a player name inside a block. */
export const BLOCK_LINK_CLASS =
  "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
