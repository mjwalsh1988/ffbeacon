/**
 * Risers and fallers (plan 9.9): two ruled lists, each row the player, his
 * position, his value, the move as a TrendChip, and a bar drawn to the
 * largest move on the page, so the two lists read as one chart (gains fill
 * to the right in the positive color, losses in the warning color). The
 * 7-day fallback sentence, when it applies, is the section helper.
 */

import { PositionChip } from "@/components/position-chip";
import { TrendChip } from "@/components/trend-chip";
import type { BlueprintView, Mover } from "@/lib/league-blueprint/types";
import { fmtValue, SUBLIST_HEADING } from "./bits";
import { Bar, RULED, SheetSection } from "./sheet";

function List({
  title,
  movers,
  view,
  id,
  scale,
  tone,
}: {
  title: string;
  movers: Mover[];
  view: BlueprintView;
  id: string;
  /** The absolute percent a full bar stands for. */
  scale: number;
  tone: "positive" | "warning";
}) {
  return (
    <div className="min-w-0">
      <h3 id={id} className={SUBLIST_HEADING}>
        {title}
      </h3>
      {movers.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing moved more than the floor.</p>
      ) : (
        <ul role="list" aria-labelledby={id} className={`mt-2 ${RULED}`}>
          {movers.map((m) => {
            const p = view.players[m.playerId];
            if (!p) return null;
            return (
              <li key={m.playerId} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1 basis-32 break-words text-sm font-medium text-ink">{p.name}</span>
                  <PositionChip position={p.position} />
                  <span className="whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-ink">
                    {fmtValue(p.value)}
                    <span className="sr-only"> value</span>
                  </span>
                  <TrendChip
                    direction={m.pct > 0 ? "up" : "down"}
                    delta={m.delta}
                    deltaPct={m.pct}
                    windowLabel={view.movers.windowLabel}
                  />
                </div>
                <Bar fraction={scale > 0 ? Math.abs(m.pct) / scale : 0} tone={tone} className="mt-2" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MoversPanel({ view, number }: { view: BlueprintView; number: string }) {
  const scale = [...view.movers.risers, ...view.movers.fallers].reduce((m, x) => Math.max(m, Math.abs(x.pct)), 0);
  return (
    <SheetSection
      id="bp-movers"
      number={number}
      title={`Risers and fallers, ${view.movers.windowLabel}`}
      helper={
        view.movers.fallbackNote
          ? `Showing ${view.movers.fallbackNote}. Each bar is drawn to the largest move on this roster.`
          : `${view.header.sourceDisplay} values over the last ${view.movers.windowLabel}. Each bar is drawn to the largest move on this roster.`
      }
    >
      <div className="grid items-start gap-x-8 gap-y-5 sm:grid-cols-2">
        <List id="bp-rising" title="Rising" movers={view.movers.risers} view={view} scale={scale} tone="positive" />
        <List id="bp-falling" title="Falling" movers={view.movers.fallers} view={view} scale={scale} tone="warning" />
      </div>
    </SheetSection>
  );
}
