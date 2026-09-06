"use client";

/**
 * The masthead, rail and section tree of a Manager Pulse report, as a client
 * component, in its own module.
 *
 * WHY THIS IS A SEPARATE FILE, and it is the whole reason: it is the heavy
 * half of the building branch, and it is lazily loaded. On the READY path
 * (a repeat reader whose report is already warm, which is the common case)
 * app/tools/manager-pulse/[handle]/page.tsx renders this same tree as SERVER
 * components, shipping no client JavaScript for it at all. But
 * live-manager-report.tsx is "use client", so anything it imports statically
 * is compiled into this route's client bundle and shipped on every render of
 * the page, ready path included. Splitting the tree out and reaching it
 * through next/dynamic puts it in its own chunk, fetched only when a live
 * report actually arrives.
 *
 * Nothing about the rendering changed in the move. The heading rule is the
 * one thing to be careful of: `headingLevel` is 2 while ReportHeading in
 * live-manager-report.tsx still carries the page's h1, and 1 once the report
 * is final and this is the sole h1. Getting that wrong puts an h2 above the
 * h1, which is what the accessibility review caught the first time.
 */

import { Suspense } from "react";
import type { LeagueLens, ManagerReport } from "@/lib/manager-pulse/types";
import { LensSwitch } from "@/components/manager-shell";
import { ManagerMasthead } from "./manager-masthead";
import { ReportColumns } from "./report-columns";
import { ReportRail } from "./report-rail";
import { ResultsSection } from "./results-section";
import { DraftingSection } from "./drafting-section";
import { AffinitySection } from "./affinity-section";
import { TradingSection } from "./trading-section";
import { RosterOpsSection } from "./roster-ops-section";
import { NarrativeSection } from "./narrative-section";
import { LeaguesSection } from "./leagues-section";

export type LiveReportBodyProps = {
  report: ManagerReport;
  lens: LeagueLens;
  generatedAt: string;
  /** 1 once the report is final (the page's sole h1); 2 while it is still
   *  live and ReportHeading carries the h1 instead. */
  headingLevel?: 1 | 2;
};

/**
 * The masthead / rail / section tree, identical in shape whether it is fed the
 * newest live report or the final one: the same code, over a shorter or longer
 * league-season list, per section 4.2 of
 * docs/manager-pulse/manager-pulse-audit-and-speed-plan.md.
 */
export function LiveReportBody({
  report,
  lens,
  generatedAt,
  headingLevel = 1,
}: LiveReportBodyProps) {
  const counts = {
    leagueSeasons: report.counts.leagueSeasons,
    dynasty: report.counts.dynasty,
    redraft: report.counts.redraft,
  };

  return (
    <div className="space-y-6">
      <ManagerMasthead
        identity={report.identity}
        window={report.window}
        headingLevel={headingLevel}
        controls={
          <Suspense
            fallback={<div className="h-11 w-64 rounded-card bg-surface/60" aria-hidden="true" />}
          >
            <LensSwitch lens={lens} counts={counts} />
          </Suspense>
        }
      />

      <ReportColumns
        railLabel="Report summary and coverage"
        rail={<ReportRail report={report} lens={lens} generatedAt={generatedAt} />}
      >
        <div className="space-y-6">
          {/* HOW TO DEAL LEADS. Same order as app/tools/manager-pulse/[handle]/page.tsx's ReportSections. */}
          <NarrativeSection narrative={report.narrative} />
          <ResultsSection results={report.results} lens={lens} />
          <DraftingSection drafting={report.drafting} lens={lens} />
          <AffinitySection affinity={report.affinity} />
          <TradingSection trading={report.trading} counts={counts} lens={lens} />
          <RosterOpsSection rosterOps={report.rosterOps} totalLeagueSeasons={counts} lens={lens} />
          <LeaguesSection leagues={report.leagues} totalLeagueSeasons={report.counts.leagueSeasons} />
        </div>
      </ReportColumns>
    </div>
  );
}
