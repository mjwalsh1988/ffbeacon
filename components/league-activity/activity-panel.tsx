import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";
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
 * ONE SURFACE: the league overview, above the power rankings, capped and
 * scrolling. It used to have a second home at `/leagues/[id]/activity`, which
 * rendered this same component from this same loader at full length and added
 * nothing but the per-team filter. That filter now renders here behind a
 * disclosure, so the route was a second URL for one control and it is gone.
 *
 * The `fullHref` prop went with the route. Carrying a prop that is always null
 * would leave a dead branch in the footer and a dead "Full log" button in the
 * header, both pointing at nothing. What the footer does instead is what that
 * null already meant: a truncated view offers to NARROW the window, which
 * reveals different entries, rather than to widen one that would return the
 * same forty rows.
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
  helper,
  headingLevel = 2,
  skipHref = null,
}: ActivityPanelProps) {
  const { cards, hasOlder, truncated, nextDays } = loaded;
  // The narrower window, or null when there is none. A link to the window the
  // reader is already on is a dead control, so the footer says what it is
  // showing instead of offering one.
  const narrower = narrowerRung(days);
  const canNarrow = truncated && narrower !== days && narrower > 0;
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
        {canNarrow ? (
          // NOWHERE TO ESCAPE TO. When the row cap truncates the view,
          // widening the window returns the same rows and "load more" would be
          // a lie, so the offer is to NARROW instead, which genuinely reveals
          // different entries.
          <Link
            href={loadMoreHref(filters, narrower)}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]"
          >
            {`Narrow to the last ${narrower} days`}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ) : truncated ? (
          // Truncated with nowhere narrower to go. The count in the footer
          // already says how many are shown; this says why there are no more
          // and what will actually reveal different entries.
          <p className="text-[11px] text-ink-subtle">
            Use the filters above to see different entries.
          </p>
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

      <TimestampNote />
    </Panel>
  );
}

/**
 * Why two entries an hour apart can carry very different kinds of time.
 *
 * This used to be a rail panel on the full activity route. It is not
 * decoration: the log mixes three sorts of entry, and only one of them has a
 * timestamp Sleeper actually published. Without this, "seen this week" beside
 * "7:42 PM" reads as sloppiness rather than as the honest answer it is.
 *
 * A `<details>` because it is reference material, not something a reader needs
 * on the way past, and because the element carries its own expanded state and
 * announces it with no JavaScript.
 */
function TimestampNote() {
  return (
    <details className="group border-t border-line px-4 py-2.5 sm:px-5">
      {/* A HEADING INSIDE THE SUMMARY. These three explanations used to sit in
          a Panel with an h2 on the removed activity route. Without a heading
          they are the one block on the page documenting what the timestamps
          mean and the only one a reader jumping by heading cannot find. Same
          pattern and same reason as components/manager-ledger/how-it-works.tsx. */}
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-ink-subtle transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-[32px]">
        <span role="heading" aria-level={3}>
          What lands in the log, and when
        </span>
        <span
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
        >
          {"\u25BE"}
        </span>
      </summary>
      <dl className="mt-2 space-y-2.5 pb-1 text-[12px] leading-relaxed">
        <div>
          <dt className="font-semibold text-ink">Timed to the second</dt>
          <dd className="mt-0.5 text-ink-muted">
            Trades, waiver claims and free agent moves. Sleeper records when each one
            happened, so the log prints that time.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Timed to the week</dt>
          <dd className="mt-0.5 text-ink-muted">
            Final scores. One entry per game, carrying both the win and the loss, so a
            result is never posted twice.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Spotted between syncs</dt>
          <dd className="mt-0.5 text-ink-muted">
            Lineup edits, scoring and roster rule changes, managers arriving and leaving.
            Sleeper timestamps none of these, so each entry says the window it was seen
            in rather than a time nobody measured.
          </dd>
        </div>
      </dl>
    </details>
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
