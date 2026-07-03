/**
 * Minimal trade card for the overview sidebar: a bare what-for-what view of a
 * trade involving the player, with no grade, verdict, or Signal Check. Sides are
 * labeled generically (Side A / Side B) and the card is headed by the league's
 * format, not the league or team names. Every asset is its own condensed tag so
 * it is obvious where one player or pick ends and the next begins; picks are
 * tinted apart from players and the focus player is highlighted. The full graded
 * view lives on the Trades tab. Server component.
 */

import { ArrowDown } from "lucide-react";
import { formatRelative } from "@/lib/datetime";
import type { PlayerTrade } from "@/lib/player-trades";

const SIDE_LETTERS = "ABCDEFGH";

export function MiniTrade({
  trade,
  focusSleeperId,
  nowMs,
}: {
  trade: PlayerTrade;
  focusSleeperId: string;
  nowMs: number;
}) {
  return (
    <article className="rounded-card border border-line bg-base/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-ink-subtle">
        <span className="truncate">{trade.formatDisplay ?? "Unmatched format"}</span>
        {trade.createdAtSleeper && (
          <span className="shrink-0">{formatRelative(trade.createdAtSleeper, nowMs)}</span>
        )}
      </div>

      <ul className="space-y-1.5">
        {trade.sides.map((side, idx) => (
          <li key={side.rosterId}>
            {idx > 0 && (
              <div className="my-1 flex justify-center" aria-hidden="true">
                <ArrowDown className="h-3.5 w-3.5 text-ink-subtle" />
              </div>
            )}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                Side {SIDE_LETTERS[idx] ?? idx + 1}
              </p>
              <ul className="flex flex-wrap gap-1">
                {side.players.length === 0 && side.picks.length === 0 && (
                  <li className="text-xs italic text-ink-subtle">nothing</li>
                )}
                {side.players.map((p) => {
                  const isFocus = p.sleeperPlayerId === focusSleeperId;
                  return (
                    <li
                      key={`p-${p.sleeperPlayerId}`}
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${
                        isFocus
                          ? "border-brand-cyan/60 bg-brand-cyan/10 font-semibold text-brand-cyan"
                          : "border-line bg-surface/80 text-ink"
                      }`}
                    >
                      {p.name}
                    </li>
                  );
                })}
                {side.picks.map((pick, i) => (
                  <li
                    key={`k-${i}`}
                    className="inline-flex items-center rounded border border-brand-purple/40 bg-brand-purple/10 px-1.5 py-0.5 text-xs font-medium text-brand-purple"
                  >
                    {pick.label}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
