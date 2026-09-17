/**
 * action_list: cards for waiver, hold, sell, start and sit calls. Each card
 * names the player (a link to the profile), states the call as a text chip,
 * carries the note the draft wrote, and links to the tool the call belongs
 * to through ACTION_TOOL_PATHS, so a card can never point at the wrong tool.
 *
 * The player's name comes from the waiver_targets dataset when the row is
 * there and from the page's resolved players otherwise.
 *
 * Server component.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { ACTION_TOOL_PATHS } from "@/lib/brief-desk/blocks";
import type { BundleDataset } from "@/lib/brief-desk/types";
import type { BlockPlayer } from "@/lib/brief-desk/edition-data";
import { figureColumns, formatCell, humanizeColumn, readPlayer, type DatasetRow } from "@/lib/brief-desk/dataset-read";
import { BLOCK_LINK_CLASS, BlockShell } from "./block-shell";

type Action = "waiver" | "hold" | "sell" | "start" | "sit";
type Tool = keyof typeof ACTION_TOOL_PATHS;

const ACTION_LABELS: Record<Action, string> = {
  waiver: "Waiver claim",
  hold: "Hold",
  sell: "Sell",
  start: "Start",
  sit: "Sit",
};

const TOOL_LABELS: Record<Tool, string> = {
  faab: "Set a bid in the FAAB calculator",
  "start-sit": "Check the start or sit call",
  "trade-calculator": "Price a trade",
};

export function ActionListBlock({
  id,
  caption,
  conclusion,
  dataset,
  options,
  players,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset | null;
  options: { items: Array<{ player_id: string; action: Action; tool: Tool; note: string }> };
  players: Record<string, BlockPlayer>;
}) {
  const rowById = new Map<string, DatasetRow>();
  for (const row of dataset?.rows ?? []) {
    const pid = readPlayer(row).id;
    if (pid) rowById.set(pid, row);
  }
  const bidColumns = dataset ? figureColumns(dataset.columns) : [];

  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {options.items.map((item, i) => {
          const row = rowById.get(item.player_id) ?? null;
          const fromRow = row ? readPlayer(row) : null;
          const known = players[item.player_id] ?? null;
          const name = known?.name ?? fromRow?.name ?? "This player";
          const slug = known?.slug ?? fromRow?.slug ?? null;
          const position = known?.position ?? fromRow?.position ?? null;
          const team = known?.team ?? fromRow?.team ?? null;
          const figures = row ? bidColumns.filter((c) => row[c] !== null && row[c] !== undefined) : [];
          return (
            <li key={`${item.player_id}-${i}`} className="rounded-card border border-line bg-surface/60 p-4">
              <p className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-7 items-center rounded-full border border-brand-purple/40 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-purple-light">
                  {ACTION_LABELS[item.action]}
                </span>
                {(position || team) && (
                  <span className="text-[11px] text-ink-subtle">{[position, team].filter(Boolean).join(", ")}</span>
                )}
              </p>
              <p className="mt-2 text-base font-semibold text-ink">
                {slug ? (
                  <Link href={`/players/${slug}`} className="hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </p>
              {item.note && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.note}</p>}
              {figures.length > 0 && row && (
                <p className="mt-2 text-xs text-ink-subtle">
                  {figures.map((c) => `${humanizeColumn(c)}: ${formatCell(row[c] ?? null, c)}`).join(". ")}.
                </p>
              )}
              <Link
                href={ACTION_TOOL_PATHS[item.tool] as Route}
                className={`${BLOCK_LINK_CLASS} mt-3 inline-flex min-h-11 items-center gap-1 text-sm`}
              >
                {TOOL_LABELS[item.tool]}
                <span className="sr-only"> for {name}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </BlockShell>
  );
}
