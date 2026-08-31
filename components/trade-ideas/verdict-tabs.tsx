"use client";

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Scale, TrendingUp } from "lucide-react";
import {
  emphasisForDynastyFlag,
  type LeagueEmphasis,
} from "@/lib/league-emphasis";

/**
 * The two halves of a trade evaluation, one at a time.
 *
 * WHY THIS IS A TAB SET AND NOT A LONGER PAGE
 *   The evaluation answers two questions that routinely disagree: what the deal
 *   does to your lineup and your season, and what the assets are worth. Stacked,
 *   that is four panels and about three screens of scrolling on a phone, and the
 *   value half, which is the half a reader checks second, is the half nobody
 *   reaches. Two tabs put both answers one press apart and neither below the
 *   fold.
 *
 * WHY IT IS CLIENT STATE AND NOT A URL
 *   Every other switch in Trade Ideas is an address, because a suggested deal
 *   and a built one are different things to look at and worth sending to a
 *   leaguemate. This one is not: both tabs describe the SAME evaluation, both
 *   are already computed and already in the markup, and putting it in the query
 *   string would mean a full server round trip (and a fresh rate-limit claim on
 *   the server-rendered build path) to move between two things that are on the
 *   page. So the panels are rendered on the server, handed here as children, and
 *   this component does nothing but decide which one is visible.
 *
 * WHY THE TAB STRIP IS FRAMED
 *   As two bare cards on the page background they read as a summary of what is
 *   below rather than as a choice: nothing said the second one was reachable, so
 *   the Value half went unvisited for the same reason it would have gone
 *   unscrolled. The strip now sits in its own bordered tray under an eyebrow and
 *   a "Pick a view" hint, the same shape every other control group on the site
 *   wears, and the open tab carries the beacon gradient along its bottom edge.
 *   The affordance is the frame, the hint and the hover, never colour alone.
 *
 * ACCESSIBILITY. The WAI tabs pattern, manual activation: arrow keys move focus
 * between tabs and Enter or Space selects, so a screen reader user can pass over
 * a tab without the panel underneath changing out from under them. Home and End
 * jump to the ends. The inactive panel is `hidden`, which takes it out of the
 * accessibility tree as well as off the screen, so nothing is announced twice
 * and nothing off-screen is reachable by Tab.
 */

type TabKey = "impact" | "value";

/**
 * The order, which never varies. Only the LABELS change with league format, so
 * the keyboard handler reads this rather than closing over the labelled array:
 * a useCallback with empty deps over a per-render array is a stale closure
 * waiting to happen, even where the values it reads happen to be constant.
 */
const TAB_ORDER: TabKey[] = ["impact", "value"];

/**
 * The tabs, in order. "Your season" is first in EVERY league, dynasty included,
 * because who wins games is the question everywhere.
 *
 * What changes with format is what the second tab is called. In a dynasty
 * league the value of an asset is a standing a reader is genuinely managing
 * across seasons; in a redraft league it is only what a player would fetch in a
 * deal, and calling that tab "Value" invites a redraft reader to weigh it as a
 * verdict on the trade when the verdict is on the first tab.
 */
function tabsFor(emphasis: LeagueEmphasis): {
  key: TabKey;
  label: string;
  sub: string;
  Icon: typeof Scale;
}[] {
  return [
    {
      key: "impact",
      label: "Your season",
      sub: "Lineup and wins",
      Icon: TrendingUp,
    },
    {
      key: "value",
      label: emphasis.winsFirst ? "Leverage" : "Value",
      sub: emphasis.winsFirst ? "What it would fetch" : "What it is worth",
      Icon: Scale,
    },
  ];
}

export function VerdictTabs({
  impact,
  value,
  emphasis = emphasisForDynastyFlag(true),
}: {
  /** The lineup and season half, server rendered. */
  impact: ReactNode;
  /** The trade value half plus the Signal Check second opinion. */
  value: ReactNode;
  /**
   * Names the value tab for this league. Defaults to the dynasty wording, which
   * is what every caller rendered before this existed.
   */
  emphasis?: LeagueEmphasis;
}) {
  const TABS = tabsFor(emphasis);
  const [active, setActive] = useState<TabKey>("impact");
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabId = (key: TabKey) => `${baseId}-tab-${key}`;
  const panelId = (key: TabKey) => `${baseId}-panel-${key}`;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const order = TAB_ORDER;
      const current = order.indexOf(
        (document.activeElement?.getAttribute("data-tab-key") as TabKey) ??
          "impact",
      );
      if (current < 0) return;
      let next = -1;
      if (event.key === "ArrowRight") next = (current + 1) % order.length;
      else if (event.key === "ArrowLeft")
        next = (current - 1 + order.length) % order.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = order.length - 1;
      if (next < 0) return;
      event.preventDefault();
      refs.current[order[next]]?.focus();
    },
    [],
  );

  return (
    <div>
      {/* The tray. Its visible eyebrow is a plain paragraph, not a label: a
          tablist is named by its aria-label, and a second accessible name would
          have a screen reader announce the group twice before the first tab. */}
      <div className="rounded-modal border border-line-accent bg-surface/50 p-3 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Explore the detail
          </p>
          {/* Says out loud that these are pressable. They are obvious once you
              have pressed one; this is for the reader who has not. aria-hidden
              because the tablist role already tells a screen reader exactly
              this, in its own words. */}
          <p aria-hidden="true" className="text-[11px] text-ink-subtle">
            Pick a view
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Trade evaluation detail"
          onKeyDown={onKeyDown}
          className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          {TABS.map(({ key, label, sub, Icon }) => {
            const selected = key === active;
            return (
              <button
                key={key}
                ref={(node) => {
                  refs.current[key] = node;
                }}
                type="button"
                role="tab"
                id={tabId(key)}
                data-tab-key={key}
                aria-selected={selected}
                aria-controls={panelId(key)}
                // Roving tabindex: exactly one tab is in the tab order, and the
                // arrow keys move between the rest. Leaving all of them tabbable
                // makes a reader pass through every tab to reach the panel.
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(key)}
                className={`group relative flex min-h-11 flex-col justify-center overflow-hidden rounded-card border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:flex-1 sm:px-4 ${
                  selected
                    ? "border-brand-cyan/60 bg-brand-cyan/10 shadow-[0_0_34px_-14px_rgba(34,211,238,0.9)]"
                    : "border-line-accent bg-base/70 hover:border-brand-cyan/50 hover:bg-surface-elevated"
                }`}
              >
                {/* The beacon gradient, under the open tab only. A second signal
                    beside the fill, so which tab is open survives with no colour
                    perception at all. */}
                {selected && (
                  // pointer-events-none: the underline spans the bottom of the
                  // tab, so without it a hover down there finds a nameless
                  // decorative span instead of the tab.
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-beacon"
                  />
                )}
                <span
                  className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${
                    selected
                      ? "text-ink"
                      : "text-ink-muted group-hover:text-ink"
                  }`}
                >
                  <Icon
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      selected
                        ? "text-brand-cyan"
                        : "text-ink-subtle group-hover:text-brand-cyan"
                    }`}
                  />
                  {label}
                </span>
                <span
                  className={`mt-0.5 text-[11px] leading-tight transition-colors ${
                    selected ? "text-ink-muted" : "text-ink-subtle"
                  }`}
                >
                  {sub}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* tabIndex 0 on the panel, per the WAI pattern: the panel body is not
          always focusable on its own, and without it a keyboard reader tabbing
          off the tab list lands past the content it just chose. */}
      <div
        role="tabpanel"
        id={panelId("impact")}
        aria-labelledby={tabId("impact")}
        tabIndex={0}
        hidden={active !== "impact"}
        className="mt-4 rounded-modal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {impact}
      </div>
      <div
        role="tabpanel"
        id={panelId("value")}
        aria-labelledby={tabId("value")}
        tabIndex={0}
        hidden={active !== "value"}
        className="mt-4 rounded-modal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {value}
      </div>
    </div>
  );
}
