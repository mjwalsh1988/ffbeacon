/**
 * Buy, sell, hold (plan 9.10). Hero: the activity band. Then the split of the
 * roster's priced players into Sell, Build around and Hold, the buy target
 * count, and the lists: sells (hard first, each with its note), build
 * arounds, holds (noted first), buy targets by position with an "Open in
 * builder" link, and cut candidates.
 *
 * Buy targets are other rosters' players (decision 18.4); every link into the
 * builder carries only ids the builder re-derives ownership for.
 */

import Link from "next/link";
import type { Route } from "next";
import { Panel } from "@/components/dashboard-panel";
import { PositionChip } from "@/components/position-chip";
import { DYNASTY_KEEP_VALUE } from "@/lib/league-lineups/advice";
import { positionHeading } from "@/lib/site";
import type { BlueprintView, PlayerCall } from "@/lib/league-blueprint/types";
import { BuyTag, CallTag } from "./call-tag";
import { Gauge } from "./gauge";
import { builderHref, teamWithHandle, fmtValue, INNER_CARD, LINK, SECONDARY_FIGURE, SECONDARY_LABEL, SUBLIST_HEADING } from "./bits";

type Entry = { id: string; call: PlayerCall };

/** A list this long flows into two columns where it has two columns of room. */
const FLOW_AT = 8;

function CallList({ title, entries, view, empty }: { title: string; entries: Entry[]; view: BlueprintView; empty: string }) {
  const flow = entries.length > FLOW_AT;
  return (
    <div className="min-w-0">
      <h3 className={SUBLIST_HEADING}>{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul role="list" className={`mt-2 ${INNER_CARD} ${flow ? "sm:columns-2 sm:gap-0" : ""}`}>
          {entries.map(({ id, call }, i) => {
            const p = view.players[id];
            return (
              <li key={id} className={`break-inside-avoid px-3 py-2.5 ${i > 0 ? "border-t border-line/60" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1 basis-32 break-words text-sm font-medium text-ink">{p.name}</span>
                  <PositionChip position={p.position} />
                  <span className="whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-ink">
                    {fmtValue(p.value)}
                    <span className="sr-only"> value</span>
                  </span>
                  <CallTag call={call} />
                </div>
                {call.note && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{call.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function CallsPanel({
  view,
  bands,
  linkUsername,
  signalWindowDays,
}: {
  view: BlueprintView;
  bands: [number, number];
  linkUsername: string | null;
  /** The stored Market Signals window, so the helper names the band the job used. */
  signalWindowDays: number;
}) {
  const entries = Object.entries(view.calls)
    .filter(([id]) => view.players[id])
    .map(([id, call]) => ({ id, call }));
  const byValue = (a: Entry, b: Entry) => (view.players[b.id].value ?? 0) - (view.players[a.id].value ?? 0);
  const sells = entries
    .filter((e) => e.call.call === "sell")
    .sort((a, b) => Number(b.call.strength === "hard") - Number(a.call.strength === "hard") || byValue(a, b));
  const builds = entries.filter((e) => e.call.call === "build").sort(byValue);
  const holds = entries
    .filter((e) => e.call.call === "hold")
    .sort((a, b) => Number(!!b.call.note) - Number(!!a.call.note) || byValue(a, b));
  const cuts = entries.filter((e) => e.call.call === "cut").sort(byValue);
  const a = view.activity;

  return (
    <Panel
      id="bp-calls"
      eyebrow="Moves"
      title="Buy, sell, hold"
      helper={`Calls cover the ${a.pricedCount} priced players on this roster. Market signals compare each one with his own last ${signalWindowDays} days of ${view.header.sourceDisplay} values.`}
      glow
    >
      <div className="grid items-start gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <Gauge activity={a} bands={bands} />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">{a.driver}</p>
        </div>
        <div>
          <dl className="grid grid-cols-3 gap-2">
            {(
              [
                ["Sells", a.sellsPct],
                ["Builds", a.buildsPct],
                ["Holds", a.holdsPct],
              ] as const
            ).map(([label, pct]) => (
              <div key={label} className={`${INNER_CARD} px-3 py-2`}>
                <dt className={SECONDARY_LABEL}>{label}</dt>
                <dd className={SECONDARY_FIGURE}>
                  {pct}%<span className="sr-only"> of priced players</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-ink-muted">
            Buy targets: {a.buyTargetCount} across {a.buyPositionCount}{" "}
            {a.buyPositionCount === 1 ? "position" : "positions"}.
          </p>
        </div>
      </div>

      {/* Sells and builds are a handful each and holds can run to twenty-five, so
          the short two stack and the hold list takes the remaining width. */}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5">
          <CallList title="Sell" entries={sells} view={view} empty="Nobody on this roster reads as a sell." />
          <CallList title="Build around" entries={builds} view={view} empty="No starter stands out as the core." />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <CallList title="Hold" entries={holds} view={view} empty="Every priced player has a call above." />
        </div>
      </div>

      <div className="mt-6">
        <h3 className={SUBLIST_HEADING}>Buy targets</h3>
        {view.buys.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No position on this lineup is a point a week short of a league-average starter, so there is nothing to buy.
          </p>
        ) : (
          <div className="mt-2 grid items-start gap-4 lg:grid-cols-3">
            {view.buys.map((g) => (
              <section key={g.position} aria-labelledby={`bp-buy-${g.position}`} className={`${INNER_CARD} px-3 py-3`}>
                <h4 id={`bp-buy-${g.position}`} className="text-sm font-semibold text-ink">
                  {positionHeading(g.position, "plural")}
                  <span className="ml-2 font-mono text-[11px] font-normal tabular-nums text-ink-subtle">
                    {g.need.toFixed(1)} points a week short
                  </span>
                </h4>
                {g.targets.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">No owner holds one inside the value window.</p>
                ) : (
                  <ul role="list" className="mt-2 divide-y divide-line/60">
                    {g.targets.map((t) => {
                      const p = view.players[t.playerId];
                      if (!p) return null;
                      return (
                        <li key={t.playerId} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 flex-1 basis-32 break-words text-sm font-medium text-ink">{p.name}</span>
                            <span className="whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-ink">
                              {fmtValue(p.value)}
                              <span className="sr-only"> value</span>
                            </span>
                            <BuyTag strength={t.strength} />
                          </div>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            On {teamWithHandle(t.ownerTeamName, t.ownerHandle)}
                          </p>
                          <Link
                            href={builderHref(view.sleeperLeagueId, t.proposal, linkUsername, view.header.sourceSlug) as Route}
                            className={LINK}
                          >
                            Open in builder<span className="sr-only">: a trade for {p.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      {cuts.length > 0 && (
        <div className="mt-6">
          <CallList title="Cut candidates" entries={cuts} view={view} empty="" />
          {view.header.isDynasty && (
            <p className="mt-2 text-xs text-ink-muted">
              In a dynasty league nobody worth {DYNASTY_KEEP_VALUE.toLocaleString("en-US")} or more is named a cut.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
