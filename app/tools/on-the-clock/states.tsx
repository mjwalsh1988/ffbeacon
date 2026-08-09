/**
 * Shared empty / loading / error blocks for On The Clock. Brand-consistent with
 * the rest of the site (League Pulse / FAAB): dashed-border empty cards, a
 * role="status" loading card, and a role="alert" danger card. No color-only
 * state: every block carries text.
 */

import { Loader2, AlertTriangle, Inbox, Hourglass, type LucideIcon } from "lucide-react";

export function LoadingCard({ label = "Loading draft..." }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-card border border-line bg-surface/60 p-6 text-sm text-ink-muted"
    >
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-brand-cyan" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

type HeadingLevel = 2 | 3 | 4;

/**
 * The title is a real heading, not a styled paragraph.
 *
 * These cards frequently ARE the whole panel: a tab that has nothing to show yet
 * renders one and nothing else. As a paragraph, that left the panel with no
 * heading at all, so pressing H or opening the headings list inside it found
 * nothing, which is exactly the state a user is in while they wait for a draft
 * to start.
 */
export function EmptyCard({
  title,
  body,
  headingLevel = 2,
}: {
  title: string;
  body: string;
  headingLevel?: HeadingLevel;
}) {
  const Heading = (`h${headingLevel}` as const) as "h2" | "h3" | "h4";
  return (
    <div className="flex items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Inbox className="h-5 w-5" />
      </span>
      <div>
        <Heading className="text-base font-semibold text-ink">{title}</Heading>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </div>
  );
}

/**
 * "Nothing has happened yet", for the three tabs that only have an answer once
 * picks start landing.
 *
 * Distinct from EmptyCard on purpose. An empty state says the data is missing;
 * this one says the data does not exist yet and names exactly what will make it
 * appear. Before it existed, a pre-draft room showed a full set of awards
 * reading "Up for grabs", a grade table of zeroes, and a Draft Pulse ranking of
 * teams with nothing on them, all of which look like real answers.
 *
 * `points` lists what WILL be here, so the tab still sells itself while it
 * waits. Presentational only.
 */
export function NotStartedCard({
  eyebrow,
  title,
  body,
  points = [],
  icon: Icon = Hourglass,
  headingLevel = 2,
}: {
  eyebrow: string;
  title: string;
  body: string;
  /** What this tab will show once the draft is under way. */
  points?: string[];
  icon?: LucideIcon;
  headingLevel?: HeadingLevel;
}) {
  // A real heading, for the same reason as EmptyCard above: this card is often
  // the entire contents of a tab panel.
  const Heading = (`h${headingLevel}` as const) as "h2" | "h3" | "h4";
  return (
    <div
      className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/40 p-6 sm:p-8"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
      }}
    >
      {/* Beacon hairline, matching the cockpit shells. Decorative. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            {eyebrow}
          </p>
          <Heading className="mt-1 text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {title}
          </Heading>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{body}</p>
          {points.length > 0 && (
            <ul role="list" className="mt-4 space-y-1.5">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm text-ink-muted">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-cyan" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
