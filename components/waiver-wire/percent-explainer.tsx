/**
 * Why every bid on the waiver board is a percentage.
 *
 * The rule would read as a quirk without its evidence, so the evidence is the
 * section: how big a FAAB budget actually is across the leagues we sync, read
 * at render from `lib/waiver-wire/budgets.ts`. When no single budget covers
 * even two thirds of leagues, any dollar figure on a public page is wrong for
 * most of the people reading it.
 *
 * The bars are decoration: each one's league count and share are printed in
 * the row beside it, and the list is a real list.
 *
 * Presentational server component.
 */

import type { BudgetSpread } from "@/lib/waiver-wire/budgets";

/** "$1,000" rather than "$1000". Plain string work, no locale involved. */
function money(n: number): string {
  return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** The worked example: one percentage, the dollars it means in each common league. */
const EXAMPLE_PCT = 20;

export function PercentExplainer({
  spread,
  headingId,
  headingLevel = 2,
  eyebrow,
  bare = false,
}: {
  spread: BudgetSpread;
  headingId: string;
  headingLevel?: 2 | 3;
  eyebrow?: string;
  /** No frame of its own, for when it sits inside a lesson card that has one. */
  bare?: boolean;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const Sub = headingLevel === 2 ? "h3" : "h4";
  const top = spread.buckets[0];
  const examples = spread.buckets.slice(0, 3).map((b) => b.budget);
  if (examples.length === 0) examples.push(100, 1000);

  return (
    <section
      aria-labelledby={headingId}
      className={
        bare
          ? "relative"
          : "relative overflow-hidden rounded-3xl border border-line bg-surface/40 p-4 sm:p-7"
      }
    >
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          {eyebrow}
        </p>
      )}
      <Heading
        id={headingId}
        className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl"
      >
        Why we give FAAB bids as a percentage of your budget
      </Heading>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-muted">
        A $20 bid is a fifth of the budget in one league and a fiftieth of it in another, so a
        dollar amount on a page like this is only right for readers whose league happens to
        match it. A percentage of the season budget is right in every league. That is how the
        FAAB calculator works internally, and it is how every bid on this page is written.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <Sub className="text-sm font-semibold text-ink">
            {spread.total > 0
              ? `Season budgets across ${spread.total} synced leagues`
              : "Season budgets in the leagues we sync"}
          </Sub>
          {spread.total > 0 ? (
            <ul role="list" className="mt-3 space-y-2.5">
              {[
                ...spread.buckets.map((b) => ({ label: money(b.budget), leagues: b.leagues })),
                ...(spread.otherLeagues > 0
                  ? [{ label: "Something else", leagues: spread.otherLeagues }]
                  : []),
              ].map((row) => {
                const pct = share(row.leagues, spread.total);
                return (
                  <li key={row.label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-mono font-semibold tabular-nums text-ink">
                        {row.label}
                        <span className="sr-only"> budget</span>
                      </span>
                      <span className="text-xs text-ink-muted">
                        {row.leagues} {row.leagues === 1 ? "league" : "leagues"},{" "}
                        <span className="font-mono tabular-nums text-ink">{pct}%</span>
                        <span className="sr-only"> of synced leagues</span>
                      </span>
                    </div>
                    <span aria-hidden="true" className="mt-1 block h-2 w-full rounded-full bg-line/70">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(1.5, pct)}%`,
                          backgroundImage: "linear-gradient(90deg, #22D3EE 0%, #A855F7 100%)",
                        }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              We have not read this season&apos;s league budgets yet.
            </p>
          )}
          {top && spread.total > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
              The most common budget, {money(top.budget)}, covers {share(top.leagues, spread.total)}% of
              these leagues. Any single dollar figure would be wrong for the rest.
            </p>
          )}
        </div>

        <div>
          <Sub className="text-sm font-semibold text-ink">
            One bid, {EXAMPLE_PCT}% of budget, in {examples.length} common leagues
          </Sub>
          <ul role="list" className="mt-3 grid grid-cols-3 gap-2">
            {examples.map((budget) => (
              <li
                key={budget}
                className="rounded-2xl border border-line bg-base/50 px-2 py-3 text-center"
              >
                <span className="block font-mono text-lg font-bold tabular-nums text-brand-cyan sm:text-xl">
                  {money((EXAMPLE_PCT / 100) * budget)}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-subtle">
                  in a {money(budget)} league
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Same decision, same share of what you started with. Two more things to adjust for:
            if you have already spent some of your budget, a bid is a bigger share of what is
            left, so treat the range as a share of the full season budget. And bid a number that
            does not end in 0 or 5, because round numbers are where ties happen.
          </p>
        </div>
      </div>
    </section>
  );
}
