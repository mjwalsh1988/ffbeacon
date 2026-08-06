"use client";

import { useId } from "react";
import { Info } from "lucide-react";
import type { FormatOption } from "./signal-check-builder";

/**
 * Prominent, card-style league-format picker. A real radiogroup (native radio
 * inputs visually hidden behind styled cards) so keyboard + screen-reader users
 * get arrow-key navigation and proper selection semantics for free. Format
 * drives player values, so this is treated as a first-class step, not a small
 * dropdown.
 */
export function LeagueFormatSelector({
  formats,
  value,
  onChange,
  preselected = false,
}: {
  formats: FormatOption[];
  value: string;
  onChange: (slug: string) => void;
  /** True while the selection is the one carried over from the reader's header
   * format. A radio that is already checked with no explanation is confusing,
   * especially read aloud, so we say where it came from until they change it. */
  preselected?: boolean;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-beacon text-xs font-bold text-black"
        >
          1
        </span>
        <div>
          <h2 id={headingId} className="text-base font-semibold text-ink">
            Pick your league format
          </h2>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-muted">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
            <span>
              League format changes what every player is worth. Make sure this matches your league
              before you check the trade.
            </span>
          </p>
          {preselected && (
            <p className="mt-2 text-sm text-ink-subtle">
              We started you on the format you have selected in the site header. Pick a different
              one below if this trade is for another league.
            </p>
          )}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="League format"
        className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {formats.map((f) => {
          const selected = f.slug === value;
          return (
            <label
              key={f.slug}
              className={`group relative flex min-h-[64px] cursor-pointer flex-col justify-center rounded-card border p-3 transition-colors ${
                selected
                  ? "border-brand-purple bg-brand-purple/10"
                  : "border-line bg-base hover:border-brand-cyan/50"
              } focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan`}
            >
              <input
                type="radio"
                name="sc-format"
                value={f.slug}
                checked={selected}
                onChange={() => onChange(f.slug)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{f.display}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-brand-purple bg-brand-purple" : "border-line"
                  }`}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-black" />}
                </span>
              </span>
              <span className="mt-1 text-xs text-ink-subtle">
                {f.leagueType === "dynasty" ? "Dynasty" : "Redraft"}
                {", "}
                {f.allowsPicks ? "players and picks" : "players only"}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
