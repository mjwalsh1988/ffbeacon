/**
 * Buy, sell, hold (plan 9.10). Hero: the activity band beside its gauge.
 * Then the split of the roster's priced players into Sell, Build around and
 * Hold, drawn as one stacked bar with the three percentages under it, the
 * buy target count, and the lists: sells (hard first, each with its note),
 * build arounds, holds (noted first), buy targets by position with an "Open
 * in builder" link, and cut candidates. Ruled rows throughout.
 *
 * Buy targets are other rosters' players (decision 18.4); every link into the
 * builder carries only ids the builder re-derives ownership for.
 */

import Link from "next/link";
import type { Route } from "next";
import { PositionChip } from "@/components/position-chip";
import { DYNASTY_KEEP_VALUE } from "@/lib/league-lineups/advice";
import { positionHeading } from "@/lib/site";
import type { BlueprintActivity, BlueprintView, PlayerCall } from "@/lib/league-blueprint/types";
import { BuyTag, CallTag } from "./call-tag";
import { Gauge } from "./gauge";
import { builderHref, teamWithHandle, fmtValue, LINK, SECONDARY_FIGURE, SECONDARY_LABEL, SUBLIST_HEADING } from "./bits";
import { RULED, SheetSection } from "./sheet";

type Entry = { id: string; call: PlayerCall };

/** A list this long flows into two columns where it has two columns of room. */
const FLOW_AT = 8;

function CallList({
  title,
  entries,
  view,
  empty,
  flow = false,
}: {
  title: string;
  entries: Entry[];
  view: BlueprintView;
  empty: string;
  /** Only the list given two columns of room may flow into two columns. */
  flow?: boolean;
}) {
  const twoCol = flow && entries.length > FLOW_AT;
  return (
    <div className="min-w-0">
      <h3 className={SUBLIST_HEADING}>{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul role="list" className={`mt-2 ${RULED} ${twoCol ? "sm:columns-2 sm:gap-8" : ""}`}>
          {entries.map(({ id, call }) => {
            const p = view.players[id];
            return (
              <li key={id} className="break-inside-avoid py-2.5">
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

/**
 * The split as one stacked bar: sells in the warning color, builds in brand
 * purple, holds in muted ink, each segment as wide as its share. The three
 * figures under it are the real text; the bar is decoration of them.
 */
function SplitBar({ a }: { a: BlueprintActivity }) {
  const parts = [
    { label: "Sells", pct: a.sellsPct, fill: "bg-signal-warning" },
    { label: "Builds", pct: a.buildsPct, fill: "bg-brand-purple" },
    { label: "Holds", pct: a.holdsPct, fill: "bg-ink/35" },
  ];
  return (
    <div>
      <div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-ink/[0.08]">
        {parts.map((p) => (
          <span key={p.label} className={`block h-full ${p.fill}`} style={{ width: `${p.pct}%` }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {parts.map((p) => (
          <div key={p.label} className="min-w-0 border-t border-line pt-2">
            <dt className={`flex items-center gap-1.5 ${SECONDARY_LABEL}`}>
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${p.fill}`} />
              {p.label}
            </dt>
            <dd className={SECONDARY_FIGURE}>
              {p.pct}%<span className="sr-only"> of priced players</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CallsPanel({
  view,
  bands,
  linkUsername,
  signalWindowDays,
  number,
}: {
  view: BlueprintView;
  bands: [number, number];
  linkUsername: string | null;
  /** The stored Market Signals window, so the helper names the band the job used. */
  signalWindowDays: number;
  number: string;
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
    <SheetSection
      id="bp-calls"
      number={number}
      title="Buy, sell, hold"
      helper={`Calls cover the ${a.pricedCount} priced players on this roster. Market signals compare each one with his own last ${signalWindowDays} days of ${view.header.sourceDisplay} values.`}
    >
      <div className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <Gauge activity={a} bands={bands} />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">{a.driver}</p>
        </div>
        <div className="min-w-0">
          <SplitBar a={a} />
          <p className="mt-3 text-sm text-ink-muted">
            Buy targets: {a.buyTargetCount} across {a.buyPositionCount}{" "}
            {a.buyPositionCount === 1 ? "position" : "positions"}.
          </p>
        </div>
      </div>

      {/* Sells and builds are a handful each and holds can run to twenty-five, so
          the short two stack and the hold list takes the remaining width. */}
      <div className="mt-8 grid items-start gap-x-8 gap-y-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6">
          <CallList title="Sell" entries={sells} view={view} empty="Nobody on this roster reads as a sell." />
          <CallList title="Build around" entries={builds} view={view} empty="No starter stands out as the core." />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <CallList title="Hold" entries={holds} view={view} empty="Every priced player has a call above." flow />
        </div>
      </div>

      <div className="mt-8">
        <h3 className={SUBLIST_HEADING}>Buy targets</h3>
        {view.buys.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No position on this lineup is a point a week short of a league-average starter, so there is nothing to buy.
          </p>
        ) : (
          <div className="mt-2 grid items-start gap-x-8 gap-y-5 lg:grid-cols-3">
            {view.buys.map((g) => (
              <section key={g.position} aria-labelledby={`bp-buy-${g.position}`} className="min-w-0 border-t border-line pt-3">
                <h4 id={`bp-buy-${g.position}`} className="text-sm font-semibold text-ink">
                  {positionHeading(g.position, "plural")}
                  <span className="ml-2 font-mono text-[11px] font-normal tabular-nums text-ink-subtle">
                    {g.need.toFixed(1)} points a week short
                  </span>
                </h4>
                {g.targets.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">No owner holds one inside the value window.</p>
                ) : (
                  <ul role="list" className="mt-2 divide-y divide-line/70">
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
        <div className="mt-8">
          <CallList title="Cut candidates" entries={cuts} view={view} empty="" />
          {view.header.isDynasty && (
            <p className="mt-2 text-xs text-ink-muted">
              In a dynasty league nobody worth {DYNASTY_KEEP_VALUE.toLocaleString("en-US")} or more is named a cut.
            </p>
          )}
        </div>
      )}
    </SheetSection>
  );
}
