"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { ChevronDown, Info, SlidersHorizontal } from "lucide-react";
import type { FormatOption } from "./signal-check-builder";

/**
 * Compact league-format control: a small chip in the toolbar row showing the
 * format currently in force, plus a change button that expands the full list
 * underneath. Format drives every player value, so the current one is always
 * visible, but the full set of cards only takes up the page when someone asks
 * for it. The list itself is still a real radiogroup (native radios hidden
 * behind styled cards) so arrow keys and selection semantics come for free.
 *
 * The panel collapses with a grid-rows transition and flips to
 * `visibility: hidden` when closed, which keeps the radios out of the tab order
 * and out of the accessibility tree while it is shut.
 */
export function LeagueFormatSelector({
  formats,
  value,
  onChange,
  preselected = false,
  open,
  onOpenChange,
  leading,
}: {
  formats: FormatOption[];
  value: string;
  onChange: (slug: string) => void;
  /** True while the selection is the one carried over from the reader's header
   * format. A chip that is already filled in with no explanation is confusing,
   * especially read aloud, so we say where it came from until they change it. */
  preselected?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rendered to the left of the format chip, in the same toolbar row. */
  leading?: ReactNode;
}) {
  const panelId = useId();
  const headingId = useId();
  const noteId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const active = formats.find((f) => f.slug === value);
  const chipLabel = active?.display ?? "Not set yet";

  // Opening the list should land the reader on the option that is already
  // checked, so arrow keys move from where they are rather than from the top.
  useEffect(() => {
    if (!open) return;
    const group = groupRef.current;
    if (!group) return;
    const target =
      group.querySelector<HTMLInputElement>("input[type=radio]:checked") ??
      group.querySelector<HTMLInputElement>("input[type=radio]");
    target?.focus();
  }, [open]);

  function close(returnFocus: boolean) {
    onOpenChange(false);
    if (returnFocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function select(slug: string) {
    onChange(slug);
    close(true);
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={
            active
              ? `League format: ${active.display}. Change format.`
              : "League format not set yet. Choose a format."
          }
          className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-card border px-3 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            active
              ? "border-line bg-surface hover:border-brand-cyan/60"
              : "border-brand-purple/60 bg-brand-purple/10 hover:border-brand-purple"
          }`}
        >
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
          <span
            aria-hidden="true"
            className="hidden text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-subtle sm:inline"
          >
            Format
          </span>
          <span
            aria-hidden="true"
            className="min-w-0 truncate rounded-full border border-brand-purple/50 bg-brand-purple/10 px-2 py-0.5 text-xs font-semibold text-ink"
          >
            {chipLabel}
          </span>
          <span aria-hidden="true" className="text-xs font-medium text-brand-cyan">
            Change
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div
          className={`overflow-hidden transition-[visibility] duration-200 motion-reduce:transition-none ${
            open ? "visible" : "invisible"
          }`}
        >
          <section
            aria-labelledby={headingId}
            className="mt-3 rounded-modal border border-line bg-surface/40 p-4 sm:p-5"
          >
            <h3 id={headingId} className="text-sm font-semibold text-ink">
              Pick your league format
            </h3>
            <p id={noteId} className="mt-1 flex items-start gap-1.5 text-sm text-ink-muted">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
              <span>
                League format changes what every player is worth. Make sure this matches your
                league before you check the trade.
                {preselected
                  ? " We started you on the format you have selected in the site header."
                  : ""}
              </span>
            </p>

            <div
              ref={groupRef}
              role="radiogroup"
              aria-label="League format"
              aria-describedby={noteId}
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
                      onChange={() => select(f.slug)}
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
        </div>
      </div>
    </div>
  );
}
