import Link from "next/link";
import { ArrowRight, History, Radio } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { ActivityCard } from "./activity-card";
import { ActivityFilters, type ActivityFilterState } from "./activity-filters";
import {
  ACTIVITY_DEFAULT_DAYS,
  ACTIVITY_WINDOW_LADDER,
  type LoadedActivity,
} from "@/lib/league-activity/load";
import { ACTIVITY_CATEGORY_LABEL } from "@/lib/league-activity/types";

/**
 * The activity log, as a panel.
 *
 * Used twice: on the league overview above the power rankings, where it is a
 * capped scrolling column, and on `/leagues/[id]/activity`, where it runs the
 * full length of the page. The only difference between the two is
 * `scrollable`; everything else, including every filter and the load-more
 * ladder, is identical, so the two surfaces cannot drift apart.
 *
 * NO CLIENT JAVASCRIPT OF ITS OWN. Filters are links, "load more" is a link,
 * and every component in this file renders on the server, so the log works with
 * scripting off and the page pays no hydration for the feed itself.
 *
 * The one exception is worth naming rather than glossing: `SleeperAvatar` wraps
 * `ImageWithFallback`, which is a client component because it retries a dead
 * avatar URL. A team chip and each column of a two-sided card carry one, so a
 * long feed does open a few dozen small client boundaries. They are the only
 * ones, and they hold no state the log depends on.
 *
 * "LOAD MORE" IS A REAL NAVIGATION, and it points at the panel's own heading.
 * The heading is focusable (`headingFocusable`), so following the link moves
 * SCREEN READER FOCUS to "Activity" rather than only scrolling the viewport
 * there, which is the difference between a usable control and one that appears
 * to do nothing. Infinite scroll was rejected for the same reason: a list with
 * no end has nothing for a keyboard to reach.
 */

export interface ActivityPanelProps {
  id: string;
  loaded: LoadedActivity;
  filters: ActivityFilterState;
  /** Days in the current window. Zero means the whole log. */
  days: number;
  /** Cap the height and scroll inside. False on the full page. */
  scrollable: boolean;
  /** The "see everything" link. Null on the full page, which IS everything. */
  fullHref: string | null;
  /** Rendered under the title. */
  helper?: string;
  headingLevel?: 2 | 3;
  /**
   * Fragment for the skip link, when this panel has content after it.
   * Null on the full activity page, where the log IS the content.
   */
  skipHref?: string | null;
}

export function LeagueActivityPanel({
  id,
  loaded,
  filters,
  days,
  scrollable,
  fullHref,
  helper,
  headingLevel = 2,
  skipHref = null,
}: ActivityPanelProps) {
  const { cards, hasOlder, truncated, nextDays } = loaded;
  // TWO PHRASINGS, because one does not fit both sentences. "everything on
  // record" reads correctly on the button that fetches it and absurdly in
  // "No results in everything on record", so the whole-log case gets a noun
  // phrase for the sentences and the day windows read the same either way.
  const windowLabel = days === 0 ? "the full log" : `the last ${days} days`;
  const windowSuffix = days === 0 ? "on record" : `from the last ${days} days`;
  // A filter narrowing the view to nothing is NOT the same as a league with no
  // history, and the footer must not say the second when the first is true.
  const filtered = filters.category !== null || filters.rosterId !== null;
  const countPhrase =
    cards.length === 0
      ? filtered
        ? "Nothing matches this filter"
        : days === 0
          ? "Nothing on record yet"
          : `Nothing in ${windowLabel}`
      : `${cards.length} ${cards.length === 1 ? "entry" : "entries"} ${windowSuffix}`;

  return (
    <Panel
      id={id}
      eyebrow="League activity"
      title="Everything that happened"
      // THE COUNT LIVES IN THE HELPER, not only in the footer under forty cards.
      // Every filter chip and the load-more link land focus on this heading, and
      // the heading text is identical before and after. Without the count here,
      // a screen reader user who widens the window hears exactly what they heard
      // before pressing the link and has to traverse the whole feed to find out
      // whether anything happened.
      helper={`${countPhrase}. ${helper ?? "Trades, claims, lineup edits, results and rule changes, newest first, refreshed whenever the league syncs."}`}
      headingLevel={headingLevel}
      headingFocusable
      glow
      bodyClassName="p-0"
      action={
        fullHref ? (
          <Link
            href={fullHref}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line-accent bg-base/60 px-3 text-[12px] font-semibold text-ink-muted transition-colors hover:border-brand-cyan/50 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[36px]"
          >
            <History aria-hidden="true" className="h-3.5 w-3.5" />
            Full log
          </Link>
        ) : null
      }
    >
      <div className="border-b border-line bg-surface-elevated/30 px-4 py-3 sm:px-5">
        <ActivityFilters state={filters} />
      </div>

      {/*
        A WAY PAST THE FEED. Forty cards carry up to eighty links, and on the
        overview they all sit between the top of the page and the rankings
        table. A reader using headings can jump; a sighted keyboard user, a
        switch user or a voice user cannot, and would tab through all of them.
        The link is visually hidden until it takes focus, which is the standard
        skip-link shape.
      */}
      {scrollable && cards.length > 0 && skipHref && (
        <a
          href={skipHref}
          className="sr-only focus:not-sr-only focus:block focus:border-b focus:border-line focus:bg-surface-elevated focus:px-4 focus:py-2 focus:text-[12px] focus:font-semibold focus:text-brand-cyan sm:focus:px-5"
        >
          Skip past the activity log
        </a>
      )}

      {cards.length === 0 ? (
        <EmptyState
          filters={filters}
          windowLabel={windowLabel}
          hasOlder={hasOlder}
          whole={days === 0}
        />
      ) : (
        <div
          // A scroll container that is not focusable cannot be scrolled from
          // the keyboard, and one without a role carries no accessible name.
          // Both are needed; neither is enough on its own.
          {...(scrollable
            ? {
                // `region` rather than `group`: both expose the label, but a
                // region is a landmark, so a reader can reach the feed with D
                // in NVDA or the VoiceOver rotor instead of arrowing to it.
                // That matters here because the panel sits above the rankings.
                role: "region" as const,
                tabIndex: 0,
                "aria-label": `Activity entries, ${cards.length} shown, scrollable`,
              }
            : {})}
          className={
            scrollable
              ? "beacon-scroll max-h-[36rem] overflow-y-auto px-4 py-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan sm:px-5"
              : "px-4 py-4 sm:px-5"
          }
        >
          <ol className="space-y-3">
            {cards.map((card) => (
              <li key={card.id}>
                <ActivityCard card={card} headingLevel={headingLevel === 3 ? 4 : 3} />
              </li>
            ))}
          </ol>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface-elevated/40 px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2 text-[11px] leading-relaxed text-ink-subtle">
          <Radio aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
          <span>
            {countPhrase}.{truncated && " Showing the newest of a longer list."}
          </span>
        </p>

        {/*
          WIDENING THE WINDOW IS POINTLESS ONCE THE ROW CAP HAS BITTEN. The
          panel shows the 40 newest entries; if that cap truncated the list,
          asking for 60 days instead of 30 returns the same 40. So when the cap
          is what is limiting the view, the offer becomes the full log, which
          shows five times as many and has no cap in practice.
        */}
        {truncated && !fullHref ? (
          // THE FULL PAGE HAS NOWHERE TO ESCAPE TO. When the row cap truncates
          // it, widening the window returns the same rows and "load more" would
          // be a lie, so the offer is to NARROW instead, which genuinely reveals
          // different entries. Without this a busy league with more than 200
          // events inside the window was a dead end.
          <Link
            href={loadMoreHref(filters, narrowerRung(days))}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]"
          >
            {`Narrow to the last ${narrowerRung(days)} days`}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ) : truncated && fullHref ? (
          <Link
            href={fullHref}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]"
          >
            Open the full log
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ) : hasOlder && nextDays !== null ? (
          <Link
            href={loadMoreHref(filters, nextDays)}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]"
          >
            {nextDays === 0 ? "Load everything on record" : `Load the last ${nextDays} days`}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ) : (
          cards.length > 0 && (
            <p className="text-[11px] text-ink-subtle">
              {days === 0
                ? "That is the whole log."
                : "Nothing older than this window is on record."}
            </p>
          )
        )}
      </footer>
    </Panel>
  );
}

/**
 * Nothing to show, and the honest reason why.
 *
 * Three genuinely different situations, and collapsing them into one "no
 * activity" line would be the feature lying about itself. A filtered window
 * with history behind it is not the same as a league we have only just met.
 */
function EmptyState({
  filters,
  windowLabel,
  hasOlder,
  whole,
}: {
  filters: ActivityFilterState;
  windowLabel: string;
  hasOlder: boolean;
  /** True when the window is the whole log, so there is no "widen it" advice. */
  whole: boolean;
}) {
  const filtered = filters.category !== null || filters.rosterId !== null;
  const what = filters.category
    ? ACTIVITY_CATEGORY_LABEL[filters.category].toLowerCase()
    : "activity";

  return (
    <div className="px-4 py-10 text-center sm:px-5">
      <p className="text-[15px] font-semibold text-ink">
        {filtered
          ? whole
            ? `No ${what} anywhere in this league's log`
            : `No ${what} in ${windowLabel}`
          : whole
            ? "Nothing recorded for this league yet"
            : `Nothing recorded in ${windowLabel}`}
      </p>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
        {filtered
          ? hasOlder
            ? "There is older activity behind this window. Widen it below, or clear the filter."
            : "Nothing matches this filter anywhere in the log."
          : hasOlder
            ? "There is older activity behind this window. Widen it below."
            : // The first-sight rule, said out loud. A league we have only just
              // met has no history to diff against, and inventing one would be
              // worse than an empty panel.
              "The log fills as the league syncs. Trades and results are read from what Sleeper already recorded; lineup, settings and manager changes are only detectable once we have seen the league twice."}
      </p>
    </div>
  );
}

/**
 * The rung below this one.
 *
 * Only reached when the row cap truncated the view, where the useful direction
 * is inward rather than outward. Falls back to the default window, which is the
 * narrowest rung there is.
 */
function narrowerRung(days: number): number {
  const below = [...ACTIVITY_WINDOW_LADDER].filter((d) => d < days || days === 0);
  return below.length > 0 ? below[below.length - 1] : ACTIVITY_DEFAULT_DAYS;
}

function loadMoreHref(filters: ActivityFilterState, nextDays: number): string {
  const qs = new URLSearchParams(filters.carry);
  qs.set("adays", nextDays === 0 ? "all" : String(nextDays));
  if (filters.category) qs.set("acat", filters.category);
  else qs.delete("acat");
  if (filters.rosterId != null) qs.set("ateam", String(filters.rosterId));
  else qs.delete("ateam");
  return `${filters.basePath}?${qs.toString()}${filters.anchor}`;
}
