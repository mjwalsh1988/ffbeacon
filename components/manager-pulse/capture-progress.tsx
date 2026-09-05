"use client";

/**
 * The panel shown while a Manager Pulse capture is draining
 * (docs/manager-pulse-plan.md 7.4): the real progress bar, the counted line,
 * and a per-section readiness list, so a reader can see which parts of the
 * report already exist while the rest is still being read from Sleeper.
 *
 * Called as `<CaptureProgressPanel progress={result.progress} />` from
 * app/tools/manager-pulse/[handle]/page.tsx's "building" branch: `progress`
 * is the `CaptureProgress` the page already read server-side (so the first
 * paint shows real numbers, not a placeholder), and this component takes over
 * polling from there via useCaptureProgress.
 *
 * ABSOLUTE RULE: THE LIVE REGION ANNOUNCES ON MEANINGFUL CHANGE ONLY. A bar
 * that speaks every 1500ms is unusable with a screen reader. The visible
 * numbers update every poll (a sighted reader can watch them), but the actual
 * `aria-live="polite"` region only gets new text when a section becomes ready
 * or the run finishes, tracked by comparing this poll's `sectionStatus` and
 * `status` against the previous one.
 *
 * `detail` is server-written text (see the API route's own header) and is
 * rendered as a plain text node, never as HTML.
 *
 * Mobile: one column, nothing hidden, usable at 360px.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CaptureProgress, ManagerSection, SectionStatus } from "@/lib/manager-pulse/types";
import { useCaptureProgress, type CaptureProgressPollingOptions } from "./use-capture-progress";
import { ProgressBar } from "./progress-bar";

// Same order as MANAGER_NAV_ITEMS, and it has to stay that way: a reader
// watching this list fill in and then scrolling the finished report should
// meet the sections in the same sequence twice.
const SECTION_ORDER: ManagerSection[] = [
  "identity",
  "narrative",
  "results",
  "drafting",
  "affinity",
  "trading",
  "rosterOps",
  "leagues",
];

/**
 * Same words app/tools/manager-pulse/[handle]/page.tsx uses for these eight
 * sections (its ReportSections and MANAGER_NAV_ITEMS), so a reader sees one
 * name for a section whether they are watching it get built or reading it
 * once it is done.
 */
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

const STATUS_WORD: Record<SectionStatus, string> = {
  pending: "Reading",
  ready: "Ready",
  unavailable: "Not available",
};

const RUN_STATUS_LABEL: Record<CaptureProgress["status"], string> = {
  pending: "Queued",
  capturing: "Reading leagues",
  computing: "Building the report",
  complete: "Complete",
  error: "Could not finish",
  throttled: "Paused, too many recent runs",
};

function sectionDotClass(status: SectionStatus | undefined): string {
  if (status === "ready") return "bg-signal-success";
  if (status === "unavailable") return "bg-ink-subtle";
  return "bg-brand-cyan";
}

export function CaptureProgressPanel({
  progress: initial,
  polling,
}: {
  progress: CaptureProgress;
  /** Overrides for the poller's four load-governing constants. See
   *  use-capture-progress.ts; omitted today because no settings group backs
   *  them yet, so the hook's own defaults apply. */
  polling?: CaptureProgressPollingOptions;
}) {
  const { progress, unavailable } = useCaptureProgress(initial, polling);
  const router = useRouter();

  const [announcement, setAnnouncement] = useState("");
  const prevSectionStatus = useRef<Partial<Record<ManagerSection, SectionStatus>>>({});
  const prevRunStatus = useRef<CaptureProgress["status"] | null>(null);
  // The server-rendered sections never repaint on their own once the run
  // moves past "capturing": the poll stops and nothing else tells Next to
  // re-render the page with the now-ready (or now-building) report. Fires
  // exactly once, for "computing" as well as "complete" - the worker sets
  // "computing" itself, but only a page render closes the run to "complete"
  // (`closeRun` lives inside `getManagerFootprint`), so a run parked at
  // "computing" needs this refresh to ever finish. "error" and "throttled"
  // leave the reader on the same partial page on purpose, with their own
  // explanation.
  const refreshedRef = useRef(false);

  useEffect(() => {
    const shouldRefresh = progress.status === "complete" || progress.status === "computing";
    if (shouldRefresh && !refreshedRef.current) {
      refreshedRef.current = true;
      router.refresh();
    }
  }, [progress.status, router]);

  useEffect(() => {
    const newlyReady = SECTION_ORDER.filter((section) => {
      const before = prevSectionStatus.current[section];
      const now = progress.sectionStatus[section];
      return now === "ready" && before !== "ready";
    }).map((section) => SECTION_LABEL[section]);
    prevSectionStatus.current = { ...progress.sectionStatus };

    const statusJustChanged = progress.status !== prevRunStatus.current;
    const wasFirstRead = prevRunStatus.current === null;
    prevRunStatus.current = progress.status;

    if (newlyReady.length > 0) {
      setAnnouncement(
        newlyReady.length === 1 ? `${newlyReady[0]} ready.` : `${newlyReady.join(", ")} ready.`,
      );
      return;
    }

    // Announce a status change (queued to reading, reading to building, and
    // so on), but not the very first read on mount, which is not a change at
    // all and would just narrate the page loading.
    if (statusJustChanged && !wasFirstRead) {
      setAnnouncement(RUN_STATUS_LABEL[progress.status]);
    }
  }, [progress]);

  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{RUN_STATUS_LABEL[progress.status]}</h2>
        {unavailable ? (
          <span className="text-xs text-ink-subtle">Could not check for updates</span>
        ) : null}
      </div>

      <div className="mt-3">
        <ProgressBar
          id={`manager-pulse-progress-${progress.runId}`}
          done={progress.leaguesDone}
          failed={progress.leaguesFailed}
          total={progress.leaguesTotal > 0 ? progress.leaguesTotal : null}
          ariaLabelledBy={`manager-pulse-progress-count-${progress.runId}`}
        />
        {/* Named by, not repeated after, the bar above: the bar's own
            aria-valuetext already carries this count, so a labelledby link
            gives the bar its name instead of the two being announced back to
            back as two separate copies of the same sentence. */}
        <p id={`manager-pulse-progress-count-${progress.runId}`} className="mt-2 text-xs text-ink-muted">
          {progress.leaguesTotal > 0
            ? `${progress.leaguesDone} of ${progress.leaguesTotal} leagues read`
            : "Preparing to read leagues"}
        </p>
        {progress.leaguesFailed > 0 ? (
          <p className="mt-1 text-xs text-ink-muted">
            {progress.leaguesFailed} league{progress.leaguesFailed === 1 ? "" : "s"} could not be
            read
          </p>
        ) : null}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {SECTION_ORDER.map((section) => {
          const status = progress.sectionStatus[section] ?? "pending";
          return (
            <li key={section} className="flex min-h-11 items-center gap-2 py-1 text-sm">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${sectionDotClass(status)}`}
              />
              <span className="text-ink">{SECTION_LABEL[section]}</span>
              <span className="ml-auto text-xs text-ink-muted">{STATUS_WORD[status]}</span>
            </li>
          );
        })}
      </ul>

      {progress.detail ? (
        <p className="mt-4 text-xs leading-relaxed text-ink-subtle">{progress.detail}</p>
      ) : null}
    </div>
  );
}
