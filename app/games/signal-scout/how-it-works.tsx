/**
 * How It Works: a collapsible plain-language explainer for Signal Scout
 * (plan sections 4, 21). Server component, no client JS needed since native
 * <details>/<summary> gives free keyboard and screen reader disclosure
 * semantics without a click handler.
 *
 * All numbers come from the LIVE admin settings passed down from page.tsx
 * (scoring.starting_score, guest_daily_round_limit, scoring.max_wrong_guesses,
 * and the four tier costs). Never hardcode a number here; if the admin
 * changes a cost, this copy must reflect it on the next page load.
 *
 * LAYOUT: this component carries no page-level layout of its own (no max
 * width, no horizontal padding, no outer margin). It lives under the boards
 * inside leaderboard-rail.tsx, which decides where it sits and how much room
 * it gets.
 *
 * RENDERED TWICE: the rail puts it under the boards in the desktop sidebar
 * AND under the boards in the mobile slide-up modal. Both copies are in the
 * DOM at once whenever the modal is open (the sidebar copy is only
 * display:none), so the heading id CANNOT be hardcoded or the page would ship
 * a duplicate id. Every caller passes its own headingId.
 */

import { ChevronDown } from "lucide-react";

export interface HowItWorksProps {
  startingScore: number;
  guestDailyLimit: number;
  maxWrongGuesses: number;
  tierCosts: {
    weak: number;
    clear: number;
    ping: number;
    scan: number;
  };
  /** Unique per rendered copy. See the RENDERED TWICE note above. */
  headingId: string;
}

export function HowItWorks({
  startingScore,
  guestDailyLimit,
  maxWrongGuesses,
  tierCosts,
  headingId,
}: HowItWorksProps) {
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        How it works
      </h2>
      <details className="group rounded-modal border border-line bg-surface/50">
        {/* tabIndex={0} is load-bearing, not redundant: <summary> is already
            focusable, but the focus trap in components/slide-up-dialog.tsx
            enumerates focusables with
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            which <summary> matches none of. This explainer is the LAST thing
            in that modal, so without an explicit tabindex the trap treats the
            element before it as the final stop and wraps Tab back to the top,
            making this disclosure unreachable by keyboard inside the modal. */}
        <summary
          tabIndex={0}
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-base font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan [&::-webkit-details-marker]:hidden"
        >
          How Signal Scout works
          <ChevronDown
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-4 px-5 pb-5 text-sm text-ink-muted">
          <div>
            <h3 className="text-sm font-semibold text-ink">The objective</h3>
            <p className="mt-1 leading-relaxed">
              Every round hides one real NFL player behind a handful of
              clues. Buy hints to reveal more about them, then name the
              player before the signal burns out.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Scoring</h3>
            <p className="mt-1 leading-relaxed">
              Every round starts at {startingScore} points. Each hint you buy
              costs points based on its tier, and a wrong guess, a Bad Read,
              costs points too. {maxWrongGuesses} Bad Reads end the round. If
              you solve it with points still on the board, you bank whatever
              score remains.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Hint tiers</h3>
            <ul role="list" className="mt-1 space-y-1 leading-relaxed">
              <li>
                <span className="font-semibold text-ink">Weak Signal</span>,{" "}
                {tierCosts.weak} points: small nudges like age range or
                jersey number.
              </li>
              <li>
                <span className="font-semibold text-ink">Clear Signal</span>,{" "}
                {tierCosts.clear} points: sharper facts like college or exact
                age.
              </li>
              <li>
                <span className="font-semibold text-ink">Beacon Ping</span>,{" "}
                {tierCosts.ping} points: strong signals like exact position or
                a positional finish.
              </li>
              <li>
                <span className="font-semibold text-ink">Full Scan</span>,{" "}
                {tierCosts.scan} points: the big reveals like current team or
                a last name initial.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Burning out</h3>
            <p className="mt-1 leading-relaxed">
              Buying a hint you cannot afford burns the signal to zero, after
              an explicit confirmation. You can still guess after that, but
              the round cannot score, and your Signal Streak resets.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Streaks</h3>
            <p className="mt-1 leading-relaxed">
              Signal Streak grows only when you win a round with points
              left. Anything else resets it. Daily Scout Streak counts
              consecutive Eastern Time days with at least one completed
              round.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Guests</h3>
            <p className="mt-1 leading-relaxed">
              Guests get {guestDailyLimit} rounds per Eastern Time day. A
              free account removes the cap, saves your streaks, and puts you
              on the leaderboards.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}
