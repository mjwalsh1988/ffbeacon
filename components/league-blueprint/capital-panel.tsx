/**
 * Draft capital by season (plan 9.11). One row per season: the season as the
 * row heading, the summed value as the row figure, the league rank under it,
 * and the picks. No hero. Redraft renders one sentence.
 */

import { Panel } from "@/components/dashboard-panel";
import { REDRAFT_CAPITAL } from "@/lib/league-blueprint/capital";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { fmtValue, INNER_CARD, rankOf, ROW_SUB } from "./bits";

export function CapitalPanel({ view }: { view: BlueprintView }) {
  const c = view.capital;
  const T = view.header.teamCount;
  return (
    <Panel id="bp-capital" eyebrow="Future picks" title="Draft capital">
      {!c ? (
        <p className="text-sm leading-relaxed text-ink-muted">{REDRAFT_CAPITAL}</p>
      ) : c.seasons.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">This roster holds no future picks.</p>
      ) : (
        <ul role="list" className={`divide-y divide-line/60 ${INNER_CARD}`}>
          {c.seasons.map((s) => (
            <li key={s.season} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <h3 className="text-sm font-semibold text-ink">{s.season}</h3>
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
            </li>
          ))}
        </ul>
      )}
      {c?.pickSourceDisplay && (
        <p className="mt-3 text-xs text-ink-muted">Draft pick values powered by {c.pickSourceDisplay}.</p>
      )}
    </Panel>
  );
}
