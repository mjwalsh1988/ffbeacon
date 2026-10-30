/**
 * Spotlight (plan 9.15): one player and one figure, the section's hero, with
 * the comparison line and a label saying which spotlight it is (the week's
 * top scorer, the top riser, or the most valuable player).
 */

import { Panel } from "@/components/dashboard-panel";
import { PlayerAvatar } from "@/components/season-pulse/bits";
import { PositionChip } from "@/components/position-chip";
import type { SeasonPosition } from "@/lib/season-pulse/types";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { HERO_FIGURE, HERO_LABEL } from "./bits";

export function SpotlightCard({ view }: { view: BlueprintView }) {
  const s = view.spotlight;
  const p = s ? view.players[s.playerId] : null;
  return (
    <Panel id="bp-spotlight" eyebrow="One player" title="Spotlight">
      {!s || !p ? (
        <p className="text-sm leading-relaxed text-ink-muted">No priced player on this roster to spotlight yet.</p>
      ) : (
        <div className="flex items-start gap-4">
          <PlayerAvatar position={p.position as SeasonPosition} sleeperId={p.sleeperId} team={p.team} size={64} />
          <div className="min-w-0">
            <p className={HERO_LABEL}>{s.label}</p>
            <p className="mt-1 break-words text-base font-bold text-ink">{p.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
              <PositionChip position={p.position} />
              <span>{p.team ?? "Free agent"}</span>
            </p>
            <p className={`mt-3 bg-beacon bg-clip-text text-transparent ${HERO_FIGURE}`}>
              {s.figure}
              <span className="sr-only"> {s.figureUnit}</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.comparison}</p>
          </div>
        </div>
      )}
    </Panel>
  );
}
