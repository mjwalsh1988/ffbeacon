/**
 * What the Decisions page measures, and what it deliberately does not.
 *
 * A server component and a plain `<details>`, closed by default. Every claim on
 * this page is checkable, and this is where a reader goes to check it, so the
 * text names the exact rule rather than gesturing at a methodology.
 *
 * The last two entries matter most. A page that grades people has to be honest
 * about the two places its arithmetic is unfair, or the first manager to spot
 * one stops believing the rest of it.
 */

export function HowLedgerWorks({
  gradedWeeks,
  ungradableSlots,
}: {
  gradedWeeks: number[];
  ungradableSlots: string[];
}) {
  const weekList =
    gradedWeeks.length === 0
      ? "no weeks yet"
      : gradedWeeks.length === 1
        ? `week ${gradedWeeks[0]}`
        : `weeks ${gradedWeeks[0]} to ${gradedWeeks[gradedWeeks.length - 1]}`;

  return (
    <details className="group rounded-card border border-line bg-surface">
      {/* The heading lives INSIDE the summary, which the HTML spec allows and
          which is what puts this block in the heading outline. Without it, the
          one section that documents what every figure on the page means is the
          only one a reader jumping by heading cannot find. */}
      <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
        <h2 className="text-sm font-semibold text-ink">
          How these numbers are worked out
        </h2>
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <p>
          Everything here has already happened. It covers {weekList}, and it uses the points
          every player really scored, bench included. Nothing on this page is a projection.
        </p>
        <p>
          <strong className="text-ink">Started.</strong> How much of what you could have
          scored you actually put in your lineup. The comparison is the best lineup your own
          players could have made that week, filled the way your league&apos;s rules allow.
        </p>
        <p>
          <strong className="text-ink">Wins left behind.</strong> Losses where that best
          lineup would have beaten your opponent&apos;s real score. Their bench is left
          alone: you cannot set someone else&apos;s lineup.
        </p>
        <p>
          <strong className="text-ink">Waivers</strong> count what each pickup scored in your
          lineup afterward. <strong className="text-ink">Trades</strong> count what came in
          against what the players you sent scored elsewhere.{" "}
          <strong className="text-ink">Draft</strong> compares each pick to the average pick
          in the same round of the same draft. Keepers are left out.
        </p>
        <p>
          A player you drafted and later traded still counts on your draft. Picking him and
          trading him are two different decisions with two different ledgers.
        </p>
        <p>
          <strong className="text-ink">Only players you could have started.</strong> Anyone
          on IR or the taxi squad is left out of the best lineup. Those lists are
          today&apos;s, since Sleeper keeps no week by week history, but anyone who actually
          started a week always counts for that week.
        </p>
        <p>
          <strong className="text-ink">Two things this cannot price.</strong> Draft picks
          traded away score no points, so they are in no total, and a trade that moved them
          says so. And you are only measured against players you already had: getting the
          roster is a different job from running it, which is why the points rank sits beside
          the decisions rank instead of inside it.
        </p>
        {ungradableSlots.length > 0 ? (
          <p>
            <strong className="text-ink">In this league.</strong> The lineup figures leave
            out {ungradableSlots.length} starting{" "}
            {ungradableSlots.length === 1 ? "slot" : "slots"} ({ungradableSlots.join(", ")}),
            because we have no eligibility rules for them. Records and scores use the
            league&apos;s own totals.
          </p>
        ) : null}
      </div>
    </details>
  );
}
