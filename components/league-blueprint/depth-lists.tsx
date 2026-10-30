/**
 * Depth (plan 9.6): the whole roster by position, each player with value,
 * position rank, call and a starter mark; then injured reserve and the taxi
 * squad when either holds anyone; then defenders and specialists, who carry
 * no market value and get no call. Ruled rows, no boxes.
 */

import { positionHeading } from "@/lib/site";
import type { BlueprintPlayer, BlueprintView } from "@/lib/league-blueprint/types";
import { CallTag, NoMarketValue } from "./call-tag";
import { fmtValue, posRank, SUBLIST_HEADING } from "./bits";
import { RULED, SheetSection } from "./sheet";

function Row({ p, view, starter }: { p: BlueprintPlayer; view: BlueprintView; starter: boolean }) {
  const call = view.calls[p.id];
  const rank = posRank(p);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
      <span className="min-w-0 flex-1 basis-32 break-words text-sm font-medium text-ink">
        {p.name}
        {starter && (
          // One visible word, so a screen reader following the pointer reads
          // what the eye sees; the comma keeps it apart from the name.
          <span className="ml-1.5 rounded border border-brand-cyan/40 px-1 text-[10px] font-bold uppercase tracking-wide text-brand-cyan">
            <span className="sr-only">, </span>
            Starter
          </span>
        )}
      </span>
      <span className="whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-ink">
        {p.value === null ? (
          <NoMarketValue />
        ) : (
          <>
            {fmtValue(p.value)}
            <span className="sr-only"> value</span>
          </>
        )}
      </span>
      {rank && (
        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-subtle">
          <span className="sr-only">position rank </span>
          {rank}
        </span>
      )}
      {call && <CallTag call={call} />}
    </li>
  );
}

function Group({ title, ids, view }: { title: string; ids: string[]; view: BlueprintView }) {
  const starters = new Set(view.depth.starterIds);
  return (
    <div className="min-w-0">
      <h3 className={SUBLIST_HEADING}>{title}</h3>
      {ids.length === 0 ? (
        <p className="mt-2 text-xs text-ink-subtle">Nobody rostered.</p>
      ) : (
        <ul role="list" className={`mt-2 ${RULED}`}>
          {ids.map((id) => view.players[id] && <Row key={id} p={view.players[id]} view={view} starter={starters.has(id)} />)}
        </ul>
      )}
    </div>
  );
}

export function DepthLists({ view, number }: { view: BlueprintView; number: string }) {
  const d = view.depth;
  return (
    <SheetSection id="bp-depth" number={number} title="Depth" helper="The whole roster by position. Starter marks this week's starting lineup.">
      <div className="grid items-start gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {d.groups.map((g) => (
          <Group key={g.position} title={positionHeading(g.position, "plural")} ids={g.playerIds} view={view} />
        ))}
      </div>
      {(d.reserveIds.length > 0 || d.taxiIds.length > 0 || d.otherIds.length > 0) && (
        <div className="mt-6 grid items-start gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          {d.reserveIds.length > 0 && <Group title="Injured reserve" ids={d.reserveIds} view={view} />}
          {d.taxiIds.length > 0 && <Group title="Taxi squad" ids={d.taxiIds} view={view} />}
          {d.otherIds.length > 0 && <Group title="Defense and specialists" ids={d.otherIds} view={view} />}
        </div>
      )}
    </SheetSection>
  );
}
