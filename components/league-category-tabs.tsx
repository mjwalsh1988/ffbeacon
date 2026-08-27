"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LeagueCategoryGroup } from "@/lib/league-category";

/**
 * Dynasty / Redraft / Best Ball as tabs rather than four tables stacked down the
 * page.
 *
 * The dashboard is a list you scan to answer "how am I doing", and someone who
 * plays dynasty and best ball keeps those two questions separate. Stacked, the
 * second category starts below however many rows the first one has, so reaching
 * it means scrolling past leagues you were not asking about. As tabs, every
 * category starts at the same place.
 *
 * WHY NOT BreakdownTabs
 *   app/tools/beacon-breakdown/breakdown-tabs.tsx is the same ARIA pattern and
 *   the same visual language, and this borrows both. What it cannot do is lose a
 *   tab: its tab set is fixed, so holding the selection as an id is safe. Here
 *   the Show-all filter can empty a whole category out from under the selection,
 *   and a selection pointing at a tab that no longer exists would hide every
 *   panel at once. So the selection is a REQUEST, and the active tab is derived
 *   from it each render, falling back to the first tab that does exist. No
 *   effect, no synchronising, nothing to get out of step.
 *
 * Panels all stay mounted with `hidden` on the inactive ones, which keeps every
 * tab's aria-controls pointing at a real element. That is the same amount of DOM
 * the stacked layout rendered, so it costs nothing to be correct here.
 *
 * Automatic activation: arrow keys move focus and select in one step, matching
 * the tabs already in this codebase. Switching is instant, so making a reader
 * press Enter after arrowing would be ceremony for nothing.
 */
export function LeagueCategoryTabs({
  groups,
  label,
  renderGroup,
}: {
  groups: LeagueCategoryGroup[];
  /** Accessible name for the tablist, e.g. "League types". */
  label: string;
  renderGroup: (group: LeagueCategoryGroup) => ReactNode;
}) {
  const baseId = useId();
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Derived, never stored: a category the filter emptied cannot strand the view.
  const activeKey =
    groups.find((g) => g.key === requestedKey)?.key ?? groups[0]?.key ?? "";

  if (groups.length === 0) return null;

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % groups.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + groups.length) % groups.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = groups.length - 1;
    else return;
    event.preventDefault();
    setRequestedKey(groups[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div>
      {/* The rule lives on this wrapper, not on the scroller, so the active
          underline can sit flush against it without a negative margin. A
          negative margin inside an overflow-x container buys a stray vertical
          scrollbar. */}
      <div className="border-b border-line">
        <div className="overflow-x-auto">
          <div
            role="tablist"
            aria-label={label}
            className="flex min-w-max gap-5 sm:gap-6"
          >
            {groups.map((group, i) => {
              const selected = group.key === activeKey;
              const count = group.leagues.length;
              return (
                <button
                  key={group.key}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${group.key}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel-${group.key}`}
                  // The count is a pill, which reads as a bare number. Spelling
                  // it out here is what makes the tab announce as "Dynasty, 7
                  // leagues" rather than "Dynasty 7".
                  aria-label={`${group.label}, ${count} ${count === 1 ? "league" : "leagues"}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setRequestedKey(group.key)}
                  onKeyDown={(event) => onKeyDown(event, i)}
                  className={`relative flex min-h-11 flex-none items-center gap-2 whitespace-nowrap px-1 pb-3 pt-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    selected ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {group.label}
                  <span
                    aria-hidden="true"
                    className={`inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[10px] tabular-nums ${
                      selected
                        ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
                        : "border-line bg-base text-ink-subtle"
                    }`}
                  >
                    {count}
                  </span>
                  {/* Active underline in the beacon gradient, sitting on the
                      wrapper's rule.

                      pointer-events-none because this span is stretched across
                      the bottom of the TAB ITSELF. Without it the bottom strip
                      of every tab hit-tests to a decorative element with no
                      accessible name, and a screen reader following the mouse
                      announces nothing for a tab the reader is pointing at. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                    style={{
                      backgroundImage: selected
                        ? "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)"
                        : "none",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {groups.map((group) => (
        <div
          key={group.key}
          role="tabpanel"
          id={`${baseId}-panel-${group.key}`}
          aria-labelledby={`${baseId}-tab-${group.key}`}
          hidden={group.key !== activeKey}
          tabIndex={0}
          className="mt-5 focus-visible:outline-none"
        >
          {renderGroup(group)}
        </div>
      ))}
    </div>
  );
}
