import Link from "next/link";
import { Clock, Hammer, Info, Loader, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";

/**
 * Every state the evaluation can be in other than "here is the answer".
 *
 * WHY RATE LIMITING IS A STATE AND NOT AN ERROR
 *   Running a lot of evaluations is the feature working. A reader who tries six
 *   deals in a minute is doing exactly what a trade builder is for, and throwing
 *   a 429 for the whole document would punish them for it: the response would
 *   take the masthead, the tabs, and the navigation down with the one panel that
 *   could not be computed. So the limit is reported inside the evaluation slot,
 *   in the reader's own terms, while the rest of the page renders normally. The
 *   copy says what happened and what happens next. It does not apologise and it
 *   does not use the word "error", because nothing went wrong.
 *
 * WHY LOADING NAMES THE WORK
 *   A bare spinner is invisible to a screen reader and uninformative to
 *   everybody else. Rebuilding a lineup for every remaining week and simulating
 *   the rest of the season takes real time, and a reader who knows that waits
 *   for it. A reader who sees an unexplained pause reaches for the back button.
 *
 * Server component: every case is static markup.
 */

type StateKind = "loading" | "rate-limited" | "error" | "invalid-link" | "empty";

const COPY: Record<
  StateKind,
  {
    eyebrow: string;
    title: string;
    body: string;
    Icon: typeof Info;
    /** Loading and rate-limited are progress reports, so they announce. */
    live: boolean;
  }
> = {
  loading: {
    eyebrow: "Working",
    title: "Rebuilding your lineup for every remaining week",
    body: "Each week is re-optimised with the trade applied, then the rest of the season is simulated against the real schedule.",
    Icon: Loader,
    live: true,
  },
  "rate-limited": {
    eyebrow: "Slow down a moment",
    title: "That is a lot of evaluations in one minute",
    body: "You have run a lot of evaluations in the last minute. This one will run again shortly.",
    Icon: Clock,
    live: true,
  },
  error: {
    eyebrow: "Not computed",
    title: "This trade could not be evaluated",
    body: "Something went wrong reading the league. Nothing has been saved and nothing has changed.",
    Icon: TriangleAlert,
    live: false,
  },
  "invalid-link": {
    eyebrow: "Out of date",
    title: "This link no longer matches the league",
    body: "The trade in this link references players or picks that are not on those rosters any more, so it cannot be evaluated. Build it again with the current rosters.",
    Icon: Info,
    live: false,
  },
  empty: {
    eyebrow: "Nothing to evaluate",
    title: "Add something to both sides",
    body: "Pick at least one player or pick for each side of the deal and the evaluation appears here.",
    Icon: Hammer,
    live: false,
  },
};

export function EvaluationState({
  kind,
  message,
  retryHref,
}: {
  kind: StateKind;
  /** Replaces the default body when the caller knows something more specific. */
  message?: string;
  /** Renders a retry link. Also the "build it again" target for invalid-link. */
  retryHref?: string;
}) {
  const copy = COPY[kind];
  const Icon = copy.Icon;
  const linkLabel = kind === "invalid-link" ? "Open the trade builder" : "Try again";

  return (
    <Panel eyebrow={copy.eyebrow} title={copy.title}>
      <p
        {...(copy.live ? { role: "status" as const } : {})}
        className="flex items-start gap-2 text-sm leading-relaxed text-ink-muted"
      >
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
        <span>{message ?? copy.body}</span>
      </p>
      {retryHref && (
        <Link
          href={retryHref}
          className="mt-3 inline-flex min-h-11 items-center rounded-card border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {linkLabel}
        </Link>
      )}
    </Panel>
  );
}
