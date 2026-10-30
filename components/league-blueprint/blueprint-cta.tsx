/**
 * The league overview's call to action for the Team Blueprint (plan 20.1).
 * Names exactly what the page gives, shows the reader's real stored grade
 * when one exists and no number when it does not, and has ONE control. No
 * icon besides the arrow on the button, no glow, the hairline as the only
 * decoration. An h2 because the overview's panels are h2 siblings.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { withUsername } from "@/components/league-schedule/format";
import type { BlueprintCtaFigure } from "@/lib/league-blueprint/cta-data";

/**
 * The eyebrow says "New:" until this date and then simply names the feature,
 * so the word does not live on the page forever.
 */
const NEW_UNTIL = Date.parse("2027-02-01T05:00:00Z");

export function BlueprintCta({
  sleeperLeagueId,
  linkUsername,
  viewerRosterId,
  viewerTeamName,
  figure,
  now = Date.now(),
}: {
  sleeperLeagueId: string;
  linkUsername: string | null;
  viewerRosterId: number | null;
  viewerTeamName: string | null;
  figure: BlueprintCtaFigure | null;
  now?: number;
}) {
  const href =
    viewerRosterId != null
      ? withUsername(`/leagues/${sleeperLeagueId}/blueprint?roster=${viewerRosterId}`, linkUsername)
      : withUsername(`/leagues/${sleeperLeagueId}/blueprint`, linkUsername);
  return (
    <section
      aria-labelledby="blueprint-cta-heading"
      className="relative overflow-hidden rounded-card border border-line-accent bg-surface/60 px-4 py-4 sm:px-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            {now < NEW_UNTIL ? "New: Team Blueprint" : "Team Blueprint"}
          </p>
          <h2 id="blueprint-cta-heading" className="mt-1 text-[17px] font-bold leading-tight tracking-tight text-ink">
            {viewerTeamName ? `${viewerTeamName}'s blueprint` : "A blueprint for every team"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Grades by position, buy and sell calls, three trade shapes with a grade on each, and the two best trade
            partners in this league, on one page you can share as a picture.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:justify-end">
          {figure && (
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Overall grade</div>
              <div className="font-mono text-2xl font-black tabular-nums text-ink">
                {figure.overall.toFixed(1)}
                <span className="sr-only"> of 10</span>
              </div>
              <div className="font-mono text-[11px] tabular-nums text-ink-subtle">{figure.statusLabel}</div>
            </div>
          )}
          <Link
            href={href as Route}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            {viewerRosterId != null ? "Open my blueprint" : "Pick a team"}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
