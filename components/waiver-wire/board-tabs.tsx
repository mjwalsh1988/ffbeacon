"use client";

/**
 * The board's position switcher, and the "show more" under each grid.
 *
 * WHY TABS. The board used to be six position panels stacked one under the
 * next, which on a phone is a very long scroll of identical boxes with no way
 * to get to tight ends except past every running back and receiver. Tabs make
 * the board one object: pick a position, see its best adds, done.
 *
 * EVERYTHING IS IN THE HTML. Every panel is rendered on the server and the
 * inactive ones carry `hidden`, so a crawler, a reader with scripting off
 * (who sees the first panel and the links underneath it) and a reader
 * searching the page with find-in-page all get every player. Switching a tab
 * writes `?pos=` into the address bar with replaceState, so the view a reader
 * shares is the view the next person opens, and the canonical stays bare.
 *
 * THE ARIA TABS PATTERN, AUTOMATIC ACTIVATION. Arrow keys move and select,
 * Home and End jump, only the selected tab is in the tab order, and each panel
 * is labelled by its tab. A roving tabindex rather than aria-activedescendant,
 * because the buttons are real buttons.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

export type BoardTab = {
  key: string;
  /** Short visible label on a phone, e.g. "RB". */
  short: string;
  /** Full label, e.g. "Running backs". Visible from sm, spoken always. */
  label: string;
  count: number;
  /** Position colour for the active underline and dot. */
  hue: string;
  content: ReactNode;
};

export function BoardTabs({
  tabs,
  initialKey,
  label,
  param = "pos",
}: {
  tabs: BoardTab[];
  initialKey: string;
  /** Names the tab list, e.g. "Waiver wire pickups by position". */
  label: string;
  /** The search parameter the selected tab is mirrored into. */
  param?: string;
}) {
  const baseId = useId();
  const [active, setActive] = useState(
    tabs.some((t) => t.key === initialKey) ? initialKey : (tabs[0]?.key ?? ""),
  );
  const buttons = useRef<Map<string, HTMLButtonElement>>(new Map());

  const select = useCallback(
    (key: string, focus: boolean) => {
      setActive(key);
      if (focus) buttons.current.get(key)?.focus();
      try {
        const url = new URL(window.location.href);
        url.searchParams.set(param, key);
        window.history.replaceState(window.history.state, "", url);
      } catch {
        // An address bar we cannot write to changes nothing about the board.
      }
    },
    [param],
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex((t) => t.key === active);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(tabs[next].key, true);
  }

  return (
    <div>
      {/* Without scripting the tabs cannot switch, so every panel and every
          collapsed list is shown instead. */}
      <noscript>
        <style>{"[data-noscript-show][hidden]{display:block!important}"}</style>
      </noscript>
      <div
        role="tablist"
        aria-label={label}
        className="beacon-scroll grid auto-cols-[minmax(2.75rem,1fr)] grid-flow-col gap-1 overflow-x-auto rounded-2xl border border-line bg-base/60 p-1"
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                if (el) buttons.current.set(tab.key, el);
                else buttons.current.delete(tab.key);
              }}
              id={`${baseId}-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.key, false)}
              onKeyDown={onKeyDown}
              className={`relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-14 sm:px-2 sm:text-[13px] ${
                selected
                  ? "bg-surface-elevated text-ink shadow-[0_6px_24px_-12px_rgba(34,211,238,0.6)]"
                  : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink"
              }`}
            >
              <span className="flex items-center gap-1.5 text-center leading-tight">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: tab.hue, opacity: selected ? 1 : 0.55 }}
                />
                {/* The visible text is the start of the accessible name, so a
                    voice-control user can say what they see. */}
                <span className="sm:hidden">
                  {tab.short}
                  <span className="sr-only">, {tab.label}</span>
                </span>
                <span className="max-sm:hidden">{tab.label}</span>
              </span>
              <span
                className={`rounded-full px-1.5 font-mono text-[10px] tabular-nums sm:text-[11px] ${
                  selected ? "bg-brand-cyan/15 text-brand-cyan" : "bg-ink/[0.06] text-ink-subtle"
                }`}
              >
                {tab.count}
                <span className="sr-only"> worth a claim</span>
              </span>
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full"
                  style={{ background: tab.hue }}
                />
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={`${baseId}-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.key}`}
          hidden={tab.key !== active}
          data-noscript-show=""
          tabIndex={0}
          className="mt-4 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}

/**
 * A card grid that shows its first few and reveals the rest on request.
 *
 * Two lists rendered on the server, the second one `hidden` until asked for,
 * so every card is in the HTML from the start and nothing is withheld from a
 * crawler or from find-in-page. When the rest are revealed, focus moves to the
 * first newly shown card's link rather than being dropped when the button
 * disappears.
 */
export function RevealGrid({
  first,
  rest,
  restCount,
  restStart,
  moreLabel,
  className,
}: {
  /** The number the second list continues from. */
  restStart: number;
  first: ReactNode;
  rest: ReactNode;
  restCount: number;
  /** e.g. "running backs", for "Show 12 more running backs". */
  moreLabel: string;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const restRef = useRef<HTMLOListElement>(null);
  const [focusFirstNew, setFocusFirstNew] = useState(false);

  useEffect(() => {
    if (!open || !focusFirstNew) return;
    restRef.current?.querySelector<HTMLElement>("a")?.focus();
    setFocusFirstNew(false);
  }, [open, focusFirstNew]);

  return (
    <>
      <ol role="list" className={className}>
        {first}
      </ol>
      {restCount > 0 && (
        <ol
          ref={restRef}
          role="list"
          start={restStart}
          hidden={!open}
          data-noscript-show=""
          className={`mt-2 sm:mt-3 ${className}`}
        >
          {rest}
        </ol>
      )}
      {restCount > 0 && !open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setFocusFirstNew(true);
          }}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-base/50 px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/50 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Show {restCount} more {moreLabel}
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </>
  );
}
