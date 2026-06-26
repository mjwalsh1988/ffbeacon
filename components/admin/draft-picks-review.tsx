import { formatEastern } from "@/lib/datetime";

/**
 * Server-rendered draft pick value review. Mirrors the player RankingsReview
 * pattern: a no-JS GET form, fully keyboard + screen-reader navigable, with a
 * source and format picker. Gives the admin the same visibility into draft pick
 * values that the player table gives for players, for every source that stores
 * picks (not just the blended FF Beacon source). Read-only: this never writes to
 * the pipeline.
 *
 * Picks are ranked by value (descending) so the order doubles as a ranking. The
 * season / round / slot are merged into the "Pick" label so every datum stays on
 * screen at mobile widths without a hidden column.
 */

export type PickRow = {
  rank: number;
  label: string;
  season: number;
  round: number;
  position: string;
  value: number;
};

export type PickCombo = {
  source: string;
  sourceDisplay: string;
  formatSlug: string;
};

export function DraftPicksReview({
  combos,
  currentSource,
  currentFormat,
  sourceDisplay,
  picks,
  total,
  capturedAt,
  preserveParams,
}: {
  combos: PickCombo[];
  currentSource: string;
  currentFormat: string;
  sourceDisplay: string;
  picks: PickRow[];
  total: number;
  capturedAt: string | null;
  preserveParams: Record<string, string>;
}) {
  // Distinct sources, in first-seen order, by display name.
  const sources: Array<{ slug: string; display: string }> = [];
  for (const c of combos) {
    if (!sources.some((s) => s.slug === c.source)) {
      sources.push({ slug: c.source, display: c.sourceDisplay });
    }
  }
  // Formats available for the currently selected source.
  const formatsForSource = combos
    .filter((c) => c.source === currentSource)
    .map((c) => c.formatSlug);

  return (
    <section aria-labelledby="draft-picks-heading" className="space-y-4">
      <header className="space-y-1">
        <h2 id="draft-picks-heading" className="text-xl font-semibold tracking-tight text-ink">
          Draft pick values
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Stored draft pick values for every source that publishes them, by format. Ranked by value.
          This view is read-only.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter draft pick values">
        {Object.entries(preserveParams).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="text-xs text-ink-muted">Source
          <select
            name="pickSource"
            defaultValue={currentSource}
            className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink"
          >
            {sources.map((s) => (
              <option key={s.slug} value={s.slug}>{s.display}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Format
          <select
            name="pickFormat"
            defaultValue={currentFormat}
            className="mt-1 block min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink"
          >
            {formatsForSource.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[44px] rounded-card border border-brand-purple bg-brand-purple/10 px-4 text-sm font-semibold text-ink hover:bg-brand-purple/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Apply
        </button>
      </form>

      {picks.length === 0 ? (
        <p className="rounded-card border border-line bg-surface/40 px-3 py-2 text-sm text-ink-muted">
          No stored draft pick values for {sourceDisplay} in <span className="font-mono">{currentFormat}</span>.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {picks.length} picks for {sourceDisplay} in <span className="font-mono">{currentFormat}</span>
            {capturedAt ? <>, as of {formatEastern(capturedAt)}</> : null}.
          </p>

          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {sourceDisplay} draft pick values for {currentFormat}, ranked by value
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="px-3 py-2">#</th>
                  <th scope="col" className="px-3 py-2">Pick</th>
                  <th scope="col" className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p) => (
                  <tr key={`${p.season}-${p.round}-${p.position}`} className="border-b border-line/60">
                    <td className="px-3 py-2 tabular-nums text-ink-subtle">{p.rank}</td>
                    <td className="px-3 py-2 font-medium text-ink">{p.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{Math.round(p.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface/40">
                  <td className="px-3 py-2" />
                  <th scope="row" className="px-3 py-2 text-left font-semibold text-ink-muted">
                    Total ({picks.length} picks)
                  </th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-ink">
                    {Math.round(total).toLocaleString("en-US")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
