/**
 * Draft capital by season (plan 9.11). One ruled row per season: the season
 * as the row heading, the picks, the summed value as the row figure with
 * the league rank under it, and a bar drawn to the roster's richest season.
 * No hero. Redraft renders one sentence.
 */

import { REDRAFT_CAPITAL } from "@/lib/league-blueprint/capital";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { fmtValue, rankOf, ROW_SUB } from "./bits";
import { Bar, RULED, SheetSection } from "./sheet";

export function CapitalPanel({ view, number }: { view: BlueprintView; number: string }) {
  const c = view.capital;
  const T = view.header.teamCount;
  const top = c ? c.seasons.reduce((m, s) => Math.max(m, s.value), 0) : 0;
  return (
    <SheetSection
      id="bp-capital"
      number={number}
      title="Draft capital"
      helper={
        c?.pickSourceDisplay
          ? `Future picks by season. Draft pick values powered by ${c.pickSourceDisplay}.`
          : "Future picks by season, valued in this league's format."
      }
    >
      {!c ? (
        <p className="text-sm leading-relaxed text-ink-muted">{REDRAFT_CAPITAL}</p>
      ) : c.seasons.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">This roster holds no future picks.</p>
      ) : (
        <ul role="list" className={RULED}>
          {c.seasons.map((s) => (
            <li key={s.season} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1 basis-48">
                  <h3 className="font-mono text-sm font-bold text-ink">{s.season}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {s.picks.map((p) => `${p.label}${p.via ? ` ${p.via}` : ""}`).join(", ")}
                  </p>
                  {s.unpricedCount > 0 && (
                    <p className="mt-0.5 text-[11px] text-ink-subtle">
                      {s.unpricedCount} {s.unpricedCount === 1 ? "pick" : "picks"} unpriced
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono text-2xl font-black tabular-nums text-ink">
                    {fmtValue(s.value)}
                    <span className="sr-only"> value</span>
                  </p>
                  <p className={ROW_SUB}>{rankOf(s.rank, T)}</p>
                </div>
              </div>
              <Bar fraction={top > 0 ? s.value / top : 0} className="mt-2" />
            </li>
          ))}
        </ul>
      )}
    </SheetSection>
  );
}
