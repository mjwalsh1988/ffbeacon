import type { Json } from "@/lib/database.types";

/**
 * Server-rendered FF Beacon ranking + value review. Sortable/filterable by format
 * and position via GET form (no client JS, fully keyboard + screen-reader
 * navigable). Each row expands to the full signal breakdown that fed the value,
 * including any silent/formula-induced delta and the placeholder badge.
 */

export type ReviewRow = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  value: number;
  rank: number;
  change7d: number | null;
  change30d: number | null;
  change90d: number | null;
  show7d: boolean;
  show30d: boolean;
  show90d: boolean;
  metadata: Record<string, unknown> | null;
};

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

export function RankingsReview({
  rows,
  formats,
  currentFormat,
  currentPosition,
  isPlaceholder,
  baselineSlug,
  total,
  cap,
}: {
  rows: ReviewRow[];
  formats: Array<{ slug: string }>;
  currentFormat: string;
  currentPosition: string;
  isPlaceholder: boolean;
  baselineSlug: string | null;
  total: number;
  cap: number;
}) {
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter rankings">
        <label className="text-xs text-ink-muted">Format
          <select name="format" defaultValue={currentFormat} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink">
            {formats.map((f) => <option key={f.slug} value={f.slug}>{f.slug}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Position
          <select name="position" defaultValue={currentPosition} className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink">
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-[44px] rounded-card border border-brand-purple bg-brand-purple/10 px-4 text-sm font-semibold text-ink hover:bg-brand-purple/20">
          Apply
        </button>
      </form>

      {isPlaceholder && (
        <p className="rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-sm text-signal-warning">
          Placeholder format: values are baselined from {baselineSlug ?? "a counterpart"} and not yet tuned for this format. Diverge with manual signals before relying on them.
        </p>
      )}

      <p className="text-sm text-ink-muted">
        Showing {rows.length} of {total} players for <span className="font-mono">{currentFormat}</span>
        {currentPosition !== "ALL" ? ` (${currentPosition})` : ""}
        {total > cap ? `. Capped at ${cap}; narrow by position to see more.` : "."}
      </p>

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">FF Beacon values and trend movement for {currentFormat}</caption>
          <thead>
            <tr className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="px-3 py-2">#</th>
              <th scope="col" className="px-3 py-2">Player</th>
              <th scope="col" className="px-3 py-2 text-right">Value</th>
              <th scope="col" className="px-3 py-2 text-right">7d</th>
              <th scope="col" className="px-3 py-2 text-right">30d</th>
              <th scope="col" className="px-3 py-2 text-right">90d</th>
              <th scope="col" className="px-3 py-2">Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} className="border-b border-line/60 align-top">
                <td className="px-3 py-2 tabular-nums text-ink-subtle">{r.rank}</td>
                <td className="px-3 py-2">
                  <span className="font-medium text-ink">{r.name}</span>{" "}
                  <span className="text-xs text-ink-subtle">{r.position}{r.team ? `, ${r.team}` : ""}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{Math.round(r.value)}</td>
                <Change value={r.change7d} show={r.show7d} window="7 day" />
                <Change value={r.change30d} show={r.show30d} window="30 day" />
                <Change value={r.change90d} show={r.show90d} window="90 day" />
                <td className="px-3 py-2">
                  <Breakdown metadata={r.metadata} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Change({ value, show, window }: { value: number | null; show: boolean; window: string }) {
  if (!show || value === null) {
    return <td className="px-3 py-2 text-right text-ink-subtle" aria-label={`No ${window} movement`}>n/a</td>;
  }
  const rounded = Math.round(value);
  const up = rounded > 0;
  const down = rounded < 0;
  const color = up ? "text-signal-success" : down ? "text-signal-danger" : "text-ink-muted";
  return (
    <td className={`px-3 py-2 text-right font-mono tabular-nums ${color}`}
      aria-label={`${window} change ${up ? "up" : down ? "down" : "flat"} ${Math.abs(rounded)}`}>
      {up ? "+" : ""}{rounded}
    </td>
  );
}

function Breakdown({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return <span className="text-xs text-ink-subtle">n/a</span>;
  const signal = String(metadata.signal ?? "unknown");
  const offset = Number(metadata.formula_offset ?? 0);
  const contributions = Array.isArray(metadata.contributions)
    ? (metadata.contributions as Array<Record<string, unknown>>)
    : [];
  const perf = metadata.stat_performance as { adjustment_pct?: number; confidence?: number } | undefined;
  const ai = metadata.ai_adjust as
    | { adjustment_pct?: number; confidence?: number; rationale?: string; cached?: boolean }
    | undefined;
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
        {signal}
        {metadata.placeholder === true ? ", placeholder" : ""}
        {offset !== 0 ? ", silent delta" : ""}
        {ai ? ", AI adjusted" : ""}
      </summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
        <Pair k="Signal" v={signal} />
        {metadata.base != null && <Pair k="Base" v={String(Math.round(Number(metadata.base)))} />}
        {metadata.factor != null && <Pair k="Factor" v={Number(metadata.factor).toFixed(3)} />}
        {metadata.scaled != null && <Pair k="Scaled" v={Number(metadata.scaled).toFixed(3)} />}
        {metadata.confidence_degraded === true && <Pair k="Confidence" v="degraded" />}
        {metadata.stat_score != null && <Pair k="Stat score" v={String(Math.round(Number(metadata.stat_score)))} />}
        {metadata.te_boost_pct != null && <Pair k="TE boost" v={`${(Number(metadata.te_boost_pct) * 100).toFixed(1)}%`} />}
        {perf?.adjustment_pct != null && <Pair k="Form adj" v={`${(perf.adjustment_pct * 100).toFixed(1)}% (conf ${Number(perf.confidence ?? 0).toFixed(2)})`} />}
        {ai?.adjustment_pct != null && <Pair k="AI adj" v={`${(ai.adjustment_pct * 100).toFixed(1)}% (conf ${Number(ai.confidence ?? 0).toFixed(2)})${ai.cached ? ", cached" : ""}`} />}
        {ai?.rationale ? <Pair k="AI rationale" v={ai.rationale} /> : null}
        {metadata.inherited_from != null && <Pair k="Inherited from" v={String(metadata.inherited_from)} />}
        {Number(metadata.manual_overrides ?? 0) > 0 && <Pair k="Manual overrides" v={String(metadata.manual_overrides)} />}
        {offset !== 0 && <Pair k="Silent offset" v={`${Math.round(offset)} (hidden from trends)`} />}
      </dl>
      {contributions.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Source contributions</p>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {contributions.map((c, i) => (
              <li key={i} className="font-mono">
                {String(c.source)}: raw {Math.round(Number(c.rawValue ?? 0))}, q {Number(c.quantile ?? 0).toFixed(2)}, mapped {Math.round(Number(c.mappedScaled ?? 0))}{c.thin ? " (thin)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink-subtle">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </>
  );
}

export type { Json };
