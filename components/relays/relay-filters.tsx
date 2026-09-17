/**
 * The hub's kind and week filters: a plain GET form, native selects with
 * labels, and a submit button. A keyboard reader tabs through two labelled
 * controls and a button; a crawler and a reader with JavaScript off get the
 * same working form. The chosen values are shareable as `?kind=&week=`, which
 * is why nothing here is client state.
 *
 * Other active filters (team, player) are carried through as hidden fields so
 * changing the week inside a team's coverage keeps the team.
 *
 * Server component.
 */

import { RELAY_KINDS, RELAY_KIND_LABELS } from "@/lib/relays/types";

export function RelayFilters({
  action,
  kind,
  week,
  weeks,
  carry = {},
}: {
  /** The path the form submits to. */
  action: string;
  kind: string | null;
  week: number | null;
  /** Weeks that have Relays this season, newest first. */
  weeks: number[];
  /** Filters to keep as hidden fields. */
  carry?: Record<string, string>;
}) {
  const select =
    "min-h-11 rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
  return (
    <form
      action={action}
      method="get"
      aria-label="Filter the reports"
      className="mb-5 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface/60 p-3"
    >
      {Object.entries(carry).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-col gap-1">
        <label htmlFor="relay-kind" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Kind
        </label>
        <select id="relay-kind" name="kind" defaultValue={kind ?? ""} className={select}>
          <option value="">All kinds</option>
          {RELAY_KINDS.map((k) => (
            <option key={k} value={k}>
              {RELAY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="relay-week" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Week
        </label>
        <select id="relay-week" name="week" defaultValue={week === null ? "" : String(week)} className={select}>
          <option value="">Every week</option>
          {weeks.map((w) => (
            <option key={w} value={String(w)}>
              Week {w}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="min-h-11 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Apply filters
      </button>
    </form>
  );
}
