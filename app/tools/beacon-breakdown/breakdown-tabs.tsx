"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type BreakdownTab = {
  id: string;
  label: string;
  /** Rendered icon element (e.g. <Swords className="h-4 w-4" />). Passed as a
   * node, not a component, so it can cross the server -> client boundary. */
  icon?: ReactNode;
  content: ReactNode;
};

/**
 * WAI-ARIA tabs for the Beacon Breakdown result. Tab content is passed in as
 * rendered nodes (the server-rendered breakdown, and the client stats compare),
 * so both panels stay mounted and keep their state; only visibility toggles.
 * Automatic-activation pattern: arrow keys move focus and select in one step.
 */
export function BreakdownTabs({ tabs }: { tabs: BreakdownTab[] }) {
  const baseId = useId();
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(tabs[next].id);
    btnRefs.current[next]?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Breakdown views"
        className="flex gap-6 border-b border-line"
      >
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`relative -mb-px flex items-center gap-2 px-1 pb-3 pt-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                selected ? "text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {tab.icon && (
                <span
                  aria-hidden="true"
                  className={selected ? "text-brand-cyan" : "text-ink-subtle"}
                >
                  {tab.icon}
                </span>
              )}
              {tab.label}
              {/* Active-tab underline in the beacon gradient. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full"
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

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className="mt-5 focus-visible:outline-none"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
