import Link from "next/link";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_CHIP,
  ACTIVITY_CATEGORY_LABEL,
  type ActivityCategory,
} from "@/lib/league-activity/types";

/**
 * The filter chips.
 *
 * LINKS, NOT BUTTONS, and no client JavaScript anywhere in this file. The feed
 * is server rendered and server paginated, so a filter is genuinely a different
 * URL: making it a link means it is shareable, it survives a back button, it
 * works before hydration, and a keyboard user gets the browser's own behaviour
 * for free.
 *
 * WHICH IS WHY THE ACTIVE ONE IS `aria-current` AND NOT `aria-pressed`.
 * `aria-pressed` describes a toggle button that changes state in place; these
 * navigate. A screen reader announcing "pressed" over a link that just moved
 * the page would be describing something that did not happen.
 *
 * A CHIP FOR A CATEGORY WITH NOTHING IN IT IS STILL RENDERED, disabled and
 * labelled as empty. Hiding it would make the filter row change shape as the
 * window widens, which is disorienting, and "there were no trades this
 * fortnight" is itself an answer.
 *
 * THAT EMPTINESS IS ONLY KNOWABLE WHILE NO CATEGORY IS SELECTED. `available` is
 * derived from the rows the page actually loaded, and those rows are already
 * narrowed by whatever chip is active: pick Results in a league with no results
 * yet and the loaded set is empty, which would mark Moves as empty too and
 * strand the reader on a dead filter with no way back except "Everything". So
 * the disabled state is applied ONLY on the unfiltered view, where the loaded
 * set genuinely represents the whole window. Answering it properly under a
 * filter would cost a second query for a hint, which is not worth a round trip.
 */

export interface ActivityFilterState {
  /** The path the chips point at, without a query string. */
  basePath: string;
  /** Every param that must survive a filter change (username, source, days). */
  carry: Record<string, string>;
  /** The fragment focus lands on after the navigation. */
  anchor: string;
  category: ActivityCategory | null;
  available: ActivityCategory[];
  rosterId: number | null;
  teams: Array<{ rosterId: number; label: string }>;
  /** Team chips are only worth the space on the full page. */
  showTeams: boolean;
}

export function ActivityFilters({ state }: { state: ActivityFilterState }) {
  const href = (params: Record<string, string | null>) => {
    const qs = new URLSearchParams(state.carry);
    for (const [key, value] of Object.entries(params)) {
      if (value === null) qs.delete(key);
      else qs.set(key, value);
    }
    const s = qs.toString();
    return `${state.basePath}${s ? `?${s}` : ""}${state.anchor}`;
  };

  return (
    <div className="space-y-2.5">
      <nav aria-label="Filter activity by kind">
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <Chip
              href={href({ acat: null })}
              active={state.category === null}
              label="Everything"
              ariaLabel="Everything, show every kind of activity"
            />
          </li>
          {ACTIVITY_CATEGORIES.map((cat) => {
            const empty = state.category === null && !state.available.includes(cat);
            return (
              <li key={cat}>
                <Chip
                  href={href({ acat: cat })}
                  active={state.category === cat}
                  disabled={empty && state.category !== cat}
                  label={ACTIVITY_CATEGORY_CHIP[cat]}
                  ariaLabel={`${ACTIVITY_CATEGORY_CHIP[cat]}, show only ${ACTIVITY_CATEGORY_LABEL[
                    cat
                  ].toLowerCase()}`}
                />
              </li>
            );
          })}
        </ul>
      </nav>

      {state.showTeams && state.teams.length > 0 && (
        <nav aria-label="Filter activity by team">
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <Chip
                href={href({ ateam: null })}
                active={state.rosterId === null}
                label="All teams"
                ariaLabel="All teams, show activity for every team"
                subtle
              />
            </li>
            {state.teams.map((team) => (
              <li key={team.rosterId}>
                <Chip
                  href={href({ ateam: String(team.rosterId) })}
                  active={state.rosterId === team.rosterId}
                  label={team.label}
                  ariaLabel={`${team.label}, show only activity involving this team`}
                  subtle
                />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
  ariaLabel,
  disabled = false,
  subtle = false,
}: {
  href: string;
  active: boolean;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  subtle?: boolean;
}) {
  const size = subtle
    ? "px-2.5 py-1.5 text-[11px]"
    : "px-3 py-1.5 text-[12px]";

  if (disabled) {
    // Rendered as plain text rather than a link: there is nothing to navigate
    // to, and a link that leads to an empty list is a dead end a keyboard user
    // has to tab through.
    //
    // THE STATE IS REAL TEXT, NOT AN `aria-label`. A bare span maps to ARIA
    // role=generic, on which naming is prohibited, so Chrome and Firefox both
    // discard the label and a reader hears the bare word "Settings" with no
    // hint that it is empty. A visually hidden span is the only version of this
    // that actually reaches the accessibility tree.
    return (
      <span
        className={`inline-flex min-h-[44px] cursor-default items-center rounded-full border border-line bg-base/30 font-semibold text-ink-subtle/60 sm:min-h-[32px] ${size}`}
      >
        {label}
        <span className="sr-only">, nothing in this window</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-[44px] items-center rounded-full border font-semibold transition-colors sm:min-h-[32px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${size} ${
        active
          ? // The active chip is not colour alone: it also carries the only
            // filled background and the only bright text in the row.
            "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
          : "border-line bg-base/50 text-ink-muted hover:border-line-accent hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
