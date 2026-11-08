/**
 * Today's podium (plan 18A.10): the top three of the DAILY board. From sm,
 * three columns with first in the middle and taller; below sm, stacked first
 * to third. An ordered list in rank order whatever the visual order.
 *
 * Gold, silver and bronze appear here and nowhere else (owner decision 13),
 * on exactly the ring, the place badge and the place word. Every place is
 * also a word, so nothing depends on the color.
 */

import { Medal } from "lucide-react";
import type { BoardRow } from "@/lib/long-shot/leaderboards";
import { METAL } from "@/lib/long-shot/tier-style";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { BoardName } from "./board-row";

const PLACES = [
  { word: "1st", metal: METAL.gold, order: "sm:order-2", height: "sm:min-h-56", avatar: 96, figure: "text-5xl" },
  { word: "2nd", metal: METAL.silver, order: "sm:order-1", height: "sm:min-h-44", avatar: 72, figure: "text-3xl" },
  { word: "3rd", metal: METAL.bronze, order: "sm:order-3", height: "sm:min-h-44", avatar: 72, figure: "text-3xl" },
];

export function Podium({ rows }: { rows: BoardRow[] }) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <ol aria-label="Today's podium" className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {top.map((row, i) => {
        const p = PLACES[i];
        return (
          <li
            key={row.rank}
            className={`flex flex-col items-center justify-end gap-2 rounded-[20px] border border-line bg-base/60 px-3 py-4 text-center ${p.order} ${p.height}`}
          >
            <span
              className="rounded-full"
              style={{
                padding: p.metal.ring,
                background: p.metal.hex,
                boxShadow: p.metal.glow ?? undefined,
              }}
            >
              <ImageWithFallback src={row.avatarUrl} alt="" size={p.avatar} className="block" />
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-bold"
              style={{ borderColor: p.metal.hex, color: p.metal.hex }}
            >
              <Medal aria-hidden="true" className="h-4 w-4" />
              {p.word}
              <span className="sr-only"> place</span>
            </span>
            <span className="max-w-full shrink-0 truncate">
              <BoardName row={row} />
              {row.isYou && <span className="ml-1 text-xs font-bold text-brand-cyan">(You)</span>}
            </span>
            <span className={`${p.figure} font-black leading-none tracking-tight tabular-nums text-ink`}>
              {row.figure}
              <span className="sr-only"> points</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
