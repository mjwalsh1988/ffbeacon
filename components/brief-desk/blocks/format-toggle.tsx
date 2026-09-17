"use client";

/**
 * format_toggle: a radiogroup of the two edition formats, and a table that
 * shows the chosen format's columns from value_movers_by_format.
 *
 * Native radios inside labels, in a fieldset with a visible legend, so the
 * arrow keys, the checked state and the announcement come from the browser.
 * The default format's table is rendered on the server, so the content is
 * there without JavaScript.
 *
 * Only the one-sentence status line is a live region (role="status"). The table
 * sits outside it on purpose: every value cell and every value column header
 * changes with the format, so a live region around the table reads the whole
 * thing aloud for a two-word state change, and the reader cannot interrupt it
 * without moving focus. The table is reachable by table navigation straight
 * afterwards and its caption names the chosen format.
 *
 * Client component. Takes plain data only.
 */

import { useId, useState } from "react";
import Link from "next/link";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { formatCell, formatColumnsFor, readPlayer } from "@/lib/brief-desk/dataset-read";
import { BLOCK_LINK_CLASS } from "./block-shell";

export function FormatToggle({
  blockId,
  dataset,
  formats,
  defaultSlug,
}: {
  blockId: string;
  dataset: BundleDataset;
  formats: Array<{ slug: string; display: string }>;
  defaultSlug: string;
}) {
  const groupId = useId();
  const initial = formats.some((f) => f.slug === defaultSlug) ? defaultSlug : (formats[0]?.slug ?? defaultSlug);
  const [chosen, setChosen] = useState(initial);
  const chosenFormat = formats.find((f) => f.slug === chosen) ?? null;
  const columns = formatColumnsFor(dataset.columns, chosen);

  return (
    <div>
      <fieldset className="rounded-card border border-line bg-surface/60 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Show values for</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {formats.map((f) => (
            <label key={f.slug} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name={`format-toggle-${groupId}`}
                value={f.slug}
                checked={chosen === f.slug}
                onChange={() => setChosen(f.slug)}
                className="h-4 w-4 accent-[#22D3EE]"
              />
              {f.display}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <p role="status" className="text-xs text-ink-subtle">
          {chosenFormat ? `Showing ${chosenFormat.display}.` : "Showing the chosen format."}
        </p>
        {columns.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">This dataset carries no columns for the chosen format.</p>
        ) : (
          <div
            className="mt-2 overflow-x-auto"
            role="region"
            tabIndex={0}
            aria-label={`${dataset.title || "Value movers by format"}: ${chosenFormat?.display ?? chosen}`}
          >
            <table className="w-full min-w-[18rem] border-collapse text-left text-xs">
              <caption className="sr-only">
                {dataset.title || "Value movers by format"}: {chosenFormat?.display ?? chosen}
              </caption>
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Player
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Pos
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Team
                  </th>
                  {columns.map((c) => (
                    <th key={c.column} scope="col" className="py-1.5 pr-3 text-right font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {dataset.rows.map((row, i) => {
                  const p = readPlayer(row);
                  return (
                    <tr key={`${p.id ?? p.slug ?? p.name}-${i}`} id={`${blockId}-row-${i}`}>
                      <th scope="row" className="py-1.5 pr-3 font-normal text-ink">
                        {p.slug ? (
                          <Link href={`/players/${p.slug}`} className={BLOCK_LINK_CLASS}>
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                      </th>
                      <td className="py-1.5 pr-3 text-ink-muted">{p.position ?? "n/a"}</td>
                      <td className="py-1.5 pr-3 text-ink-muted">{p.team ?? "n/a"}</td>
                      {columns.map((c) => (
                        <td key={c.column} className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">
                          {formatCell(row[c.column] ?? null, c.figure)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
