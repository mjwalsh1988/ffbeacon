/**
 * Risers and fallers (plan 9.9): two lists, each row the player, his position,
 * his value and the move as a TrendChip. The 7-day fallback sentence, when it
 * applies, is the panel helper.
 */

import { Panel } from "@/components/dashboard-panel";
import { PositionChip } from "@/components/position-chip";
import { TrendChip } from "@/components/trend-chip";
import type { BlueprintView, Mover } from "@/lib/league-blueprint/types";
import { fmtValue, INNER_CARD, SUBLIST_HEADING } from "./bits";

function List({ title, movers, view, id }: { title: string; movers: Mover[]; view: BlueprintView; id: string }) {
  return (
    <div className="min-w-0">
      <h3 id={id} className={SUBLIST_HEADING}>
        {title}
      </h3>
      {movers.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing moved more than the floor.</p>
      ) : (
        <ul role="list" aria-labelledby={id} className={`mt-2 divide-y divide-line/60 ${INNER_CARD}`}>
          {movers.map((m) => {
            const p = view.players[m.playerId];
            if (!p) return null;
            return (
              <li key={m.playerId} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5">
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MoversPanel({ view }: { view: BlueprintView }) {
  return (
    <Panel
      id="bp-movers"
      eyebrow="Market movement"
      title={`Risers and fallers, ${view.movers.windowLabel}`}
      helper={
        view.movers.fallbackNote
          ? `Showing ${view.movers.fallbackNote}.`
          : `${view.header.sourceDisplay} values over the last ${view.movers.windowLabel}.`
      }
    >
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <List id="bp-rising" title="Rising" movers={view.movers.risers} view={view} />
        <List id="bp-falling" title="Falling" movers={view.movers.fallers} view={view} />
      </div>
    </Panel>
  );
}
