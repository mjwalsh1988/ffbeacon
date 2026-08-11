/**
 * The methodology disclosure.
 *
 * A score nobody can interrogate is a score nobody trusts. This spells out every
 * input in plain language, including the parts that are estimates, and names the
 * one thing Power Pulse deliberately ignores.
 *
 * Native details/summary so it is keyboard operable and announced correctly with
 * no JavaScript and no ARIA of our own.
 */

export function HowPowerPulseWorks({
  scoringDescription,
  preseason,
}: {
  /** Plain-language summary of the league's own scoring rules. */
  scoringDescription: string;
  preseason: boolean;
}) {
  return (
    <details className="group rounded-card border border-line bg-base/40">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
        How Power Pulse works
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <div className="space-y-4 border-t border-line px-4 py-4 text-xs leading-relaxed text-ink-muted">
        <p>
          How many games a team should win from here, as a 1 to 99 score ranked
          inside this league only. A 70 is the seventieth percentile against
          these opponents, not against every league on the site.
        </p>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
            Where the numbers come from
          </h3>
          <ul className="mt-2 space-y-2">
            <li>
              <span className="font-semibold text-ink">Your league's scoring.</span>{" "}
              Every projection rescored under your actual settings, not generic
              PPR. Here: {scoringDescription}.
            </li>
            <li>
              <span className="font-semibold text-ink">Your best lineup, every week.</span>{" "}
              Your real starting slots filled optimally, including byes,
              superflex, and every flex variant.
            </li>
            <li>
              <span className="font-semibold text-ink">Opponent strength.</span>{" "}
              Points each NFL defense gave up to each position over the last two
              seasons, weighted toward the recent one.
            </li>
            <li>
              <span className="font-semibold text-ink">Player reliability.</span>{" "}
              How often each player beats their own projection, with this season
              weighted heaviest and small samples pulled toward neutral.
            </li>
            <li>
              <span className="font-semibold text-ink">Availability and injuries.</span>{" "}
              Current designations suppress the coming week, season-long ones the
              rest of the year, and the next player up takes the slot.
            </li>
            <li>
              <span className="font-semibold text-ink">The actual schedule.</span>{" "}
              Your real slate from Sleeper, simulated thousands of times for
              playoff and title odds.
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
            How the score is weighted
          </h3>
          <ul className="mt-2 space-y-1">
            <li>Scoring, meaning projected points per week: 55%</li>
            <li>Schedule-adjusted win rate: 25%</li>
            <li>Depth and bye coverage: 10%</li>
            <li>
              Recent form against expectation: 10%
              {preseason && " (redistributed until games are played)"}
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-purple">
            What it deliberately ignores
          </h3>
          <p className="mt-2">
            Draft picks. A 2028 first cannot start for you in week 4, so it has
            no place in a competitive score. Picks still count toward the
            trade-value rankings the value column compares against.
          </p>
        </div>

        <p className="text-ink-subtle">
          Limits: projections are one source's opinion, weekly outcomes are
          modeled as independent, and the bracket reseeds each round. The odds
          are a guide, not a promise.
        </p>
      </div>
    </details>
  );
}
