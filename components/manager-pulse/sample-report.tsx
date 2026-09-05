/**
 * The guest view of Manager Pulse: what /tools/manager-pulse shows below the
 * sign-in prompt, in full, before anyone has typed a Sleeper handle
 * (docs/manager-pulse-plan.md 7.2 and 7.3).
 *
 * Full fidelity on purpose: this renders SAMPLE_MANAGER_REPORT through the
 * SAME eight section components the real report uses, so a guest sees the
 * actual product rather than a mockup of it. The only difference from a real
 * report is the data underneath.
 *
 * FORWARD REFERENCES, CONFIRMED AGAINST A SIBLING FILE. The eight cards below
 * (IdentityCard through LeaguesTable) are owned by other agents building
 * sections 6.1 through 6.4 and 6.5 through 6.8 in parallel and did not exist
 * at the time this file was written. Their import paths and prop shape
 * (`{ report: ManagerReport; lens: LeagueLens }`, the FULL report rather than
 * a per-section slice, each card doing its own lens filtering) are not a
 * guess: they are copied verbatim from
 * app/tools/manager-pulse/[handle]/page.tsx's own forward references to the
 * same components (its `ReportSections`), which had already landed with that
 * exact contract when this file was written. If that page's contract changes
 * before the cards ship for real, this file needs the same update.
 *
 * FENCED BY FIVE INDEPENDENT SIGNALS (the Manager Ledger's own rule, restated
 * for this feature in CLAUDE.md and in plan section 7.3), and the three that
 * carry the weight are WORDS rather than styling:
 *   1. The handle in the fixture is `SampleManager` (lib/manager-pulse/sample.ts).
 *   2. Every player and league name in the fixture is an obvious placeholder.
 *   3. The "Sample" badge below, in text.
 *   4. The heading below, stating in words that these are not real numbers.
 *   5. The outer `<section aria-labelledby>` points at that heading, so
 *      entering the region announces the disclaimer first, and each inner
 *      card is additionally wrapped in its own labelled region carrying the
 *      same words. The two cards that render a `<table>` (leagues, affinity)
 *      also take an `isSample` prop that prefixes their own `<caption>` with
 *      the same disclaimer, since a caption is announced first on entering
 *      table navigation specifically; `SectionFrame` folds the same words
 *      into every card's own `<h2>` too. See `SampleSection` below for why
 *      the wrapping region still exists alongside those.
 *
 * STATIC ON PURPOSE. On the real page, `lens` is controlled from outside the
 * cards, by `LensSwitch` in components/manager-shell sitting above them; the
 * cards themselves read whatever `lens` they are given and do no switching of
 * their own. This file never renders a `LensSwitch`, so there is no control
 * anywhere in the sample that could imply a live dataset behind it. Every
 * card is given the same fixed lens, `report.defaultLens`, matching how the
 * real "ready" page picks one lens for the whole report on first load.
 */

import { SAMPLE_MANAGER_REPORT } from "@/lib/manager-pulse/sample";
import type { LeagueLens, ManagerSection } from "@/lib/manager-pulse/types";

// The same eight section components the real report renders, taking the same
// typed slices. That is the point of the sample: it is not a mock-up of the
// product, it is the product with a fixture behind it, so a layout that breaks
// here breaks there too.
import { ManagerMasthead } from "@/components/manager-pulse/manager-masthead";
import { ResultsSection } from "@/components/manager-pulse/results-section";
import { DraftingSection } from "@/components/manager-pulse/drafting-section";
import { AffinitySection } from "@/components/manager-pulse/affinity-section";
import { TradingSection } from "@/components/manager-pulse/trading-section";
import { RosterOpsSection } from "@/components/manager-pulse/roster-ops-section";
import { NarrativeSection } from "@/components/manager-pulse/narrative-section";
import { LeaguesSection } from "@/components/manager-pulse/leagues-section";

/** Same words the real page uses for these eight sections. */
const SECTION_LABEL: Record<ManagerSection, string> = {
  identity: "Overview",
  results: "Results",
  drafting: "Drafting",
  affinity: "Who they like",
  trading: "Trading",
  rosterOps: "Roster moves",
  narrative: "How to deal",
  leagues: "Leagues",
};

/**
 * Wraps one card in its own labelled region carrying the sample disclaimer,
 * so a reader who jumps straight to this section (skip links, heading
 * navigation, a screen reader's region list) still hears it is fake before
 * the section's own content.
 *
 * THIS IS A FALLBACK, and it is now the SECOND fence, not the first. The real
 * fence for a table is a `<caption>`, which is the first thing announced on
 * ENTERING TABLE NAVIGATION MODE specifically: `leagues-section.tsx` and
 * `affinity-section.tsx` accept an `isSample` prop that renders one, passed
 * from `SampleManagerReport` below. `section-frame.tsx` also folds the same
 * disclaimer into every section's own `<h2>` when `isSample` is set.
 *
 * This wrapper's own heading is an `<h2>`, not an `<h3>`, and deliberately so:
 * an `<h3>` sits below the section's own `<h2>` in the outline, so a reader
 * navigating by `h2` alone would skip straight past it. An `<h2>` is heard by
 * that same navigation, ahead of the section's own heading in document order.
 */
function SampleSection({ id, children }: { id: ManagerSection; children: React.ReactNode }) {
  const headingId = `manager-pulse-sample-${id}-caption`;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="sr-only">
        Sample data for {SECTION_LABEL[id]}. Not a real manager.
      </h2>
      {children}
    </section>
  );
}

export function SampleManagerReport() {
  const report = SAMPLE_MANAGER_REPORT;
  // One fixed lens for the whole sample. The real page lets a reader switch;
  // this one deliberately does not, because a control that filters invented
  // data invites a reader to explore it as though it meant something.
  const lens: LeagueLens = "all";
  const counts = {
    leagueSeasons: report.counts.leagueSeasons,
    dynasty: report.counts.dynasty,
    redraft: report.counts.redraft,
  };

  return (
    <section
      aria-labelledby="manager-pulse-sample-heading"
      className="space-y-6 rounded-modal border border-line bg-surface/60 p-4 sm:p-6"
    >
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Sample
        </p>
        <h2
          id="manager-pulse-sample-heading"
          className="text-lg font-semibold text-ink sm:text-xl"
        >
          Sample report. Every name and number below is made up.
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
          Sign in and search a real Sleeper handle to see their actual history
          in this exact layout.
        </p>
      </div>

      <SampleSection id="identity">
        <ManagerMasthead
          identity={report.identity}
          window={report.window}
          headingLevel={2}
          isSample
        />
      </SampleSection>

      <SampleSection id="narrative">
        <NarrativeSection narrative={report.narrative} />
      </SampleSection>

      <SampleSection id="results">
        <ResultsSection results={report.results} lens={lens} />
      </SampleSection>

      <SampleSection id="drafting">
        <DraftingSection drafting={report.drafting} lens={lens} />
      </SampleSection>

      <SampleSection id="affinity">
        <AffinitySection affinity={report.affinity} isSample />
      </SampleSection>

      <SampleSection id="trading">
        <TradingSection trading={report.trading} counts={counts} lens={lens} />
      </SampleSection>

      <SampleSection id="rosterOps">
        <RosterOpsSection rosterOps={report.rosterOps} totalLeagueSeasons={counts} lens={lens} />
      </SampleSection>

      <SampleSection id="leagues">
        <LeaguesSection
          leagues={report.leagues}
          totalLeagueSeasons={report.counts.leagueSeasons}
          isSample
        />
      </SampleSection>
    </section>
  );
}
