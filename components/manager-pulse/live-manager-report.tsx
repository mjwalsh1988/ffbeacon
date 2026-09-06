"use client";

/**
 * The whole "building" experience for a Manager Pulse report
 * (docs/manager-pulse/manager-pulse-audit-and-speed-plan.md MPS-T043, section 4.2).
 *
 * Renders the capture progress panel, and, as soon as ANY live report has
 * been written (`manager_pulse_live_reports`, produced by the drainer at its
 * own checkpoints), the same masthead / rail / section tree the finished
 * report renders, over whatever league-seasons have been read so far. A
 * coverage banner sits above the masthead the whole time this is not final,
 * so a reader always knows in words how much of the report they are looking
 * at. Nothing here is written to `manager_pulse_cache`; this only reads.
 *
 * Called by app/tools/manager-pulse/[handle]/page.tsx's "building" branch
 * (MPS-T044) as:
 *   <LiveManagerReport handle=... initialProgress={result.progress} polling={...} lens={...} />
 *
 * WHY THE SECTION TREE IS DUPLICATED HERE RATHER THAN IMPORTED FROM THE PAGE
 * The page's own `ReportSections` composes the seven section components for
 * the READY branch, but it lives in a server module. This file is a client
 * component (it has to poll and hold state), and client-boundary.test.ts
 * requires it to import only from components/manager-pulse/*,
 * components/manager-shell/*, lib/manager-pulse/types, lib/datetime and
 * React/Next client modules - not from a page file. So the same seven
 * components, in the same order, are composed again directly from their own
 * modules. If that order ever needs to change, change it in both places.
 *
 * ABSOLUTE RULE: the live region names the COVERAGE, never the contents. The
 * banner's text changes only at checkpoints (when `coverage`/`coverageTotal`
 * change), never on every poll.
 */

import { useEffect, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import type { CaptureProgress, LeagueLens, ManagerReport } from "@/lib/manager-pulse/types";
import {
  MANAGER_NAV_ITEMS,
  managerSectionElementId,
  type ManagerSection,
} from "@/components/manager-shell";
import { useCaptureProgress, type CaptureProgressPollingOptions } from "./use-capture-progress";
import { CaptureProgressPanel } from "./capture-progress";

/**
 * THE REPORT TREE IS LAZILY LOADED, and that is the point of the split.
 *
 * This module is "use client", so every module it imports statically is
 * compiled into this route's client bundle and shipped on EVERY render of the
 * page, including the warm READY path where the same tree is rendered as
 * server components with no client JavaScript at all. That path is the common
 * case for a repeat reader. Reaching the tree through next/dynamic puts it in
 * its own chunk, fetched only once a live report actually exists to render.
 *
 * There is no loading fallback on purpose: the progress panel above is
 * already on screen and already says what is happening, and swapping in a
 * second spinner underneath it would announce nothing new while adding a
 * layout shift.
 */
const LiveReportBody = nextDynamic(() =>
  import("./live-report-body").then((mod) => mod.LiveReportBody),
);

/** How many times the client re-checks for `final: true` after the run itself
 *  reports "complete", before giving up and leaving the newest live report on
 *  screen. Finalize (lib/manager-pulse/finalize.ts) and this poll can race by
 *  a second, so a few retries at the normal poll interval cover that gap. */
const FINAL_RETRY_LIMIT = 5;

type ReportApiResponse = {
  final: boolean;
  version: number;
  coverage: number;
  coverageTotal: number;
  computedAt: string | null;
  report: unknown;
};

function isReportApiResponse(value: unknown): value is ReportApiResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.final === "boolean" &&
    typeof v.coverage === "number" &&
    typeof v.coverageTotal === "number" &&
    (v.computedAt === null || typeof v.computedAt === "string") &&
    "report" in v
  );
}

/** The minimal shape check T043 asks for: a report is an object carrying an
 *  `identity` and a `counts`. Anything else (null, a malformed partial write)
 *  is treated as "nothing to show yet" rather than rendered. */
function isReportShape(value: unknown): value is ManagerReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.identity === "object" &&
    v.identity !== null &&
    typeof v.counts === "object" &&
    v.counts !== null
  );
}

type ReportState = {
  report: ManagerReport | null;
  coverage: number;
  coverageTotal: number;
  computedAt: string | null;
  final: boolean;
};

const EMPTY_REPORT_STATE: ReportState = {
  report: null,
  coverage: 0,
  coverageTotal: 0,
  computedAt: null,
  final: false,
};

export function LiveManagerReport({
  handle,
  initialProgress,
  polling,
  lens,
}: {
  handle: string;
  initialProgress: CaptureProgress;
  polling: CaptureProgressPollingOptions;
  lens: LeagueLens;
}) {
  // The ONE poller against this run. CaptureProgressPanel used to call this
  // same hook a second time on the same runId (its `initial` was this hook's
  // own result), which started a second poller drifting against this one -
  // one request per second per tab instead of one per two, and the two
  // disagreeing about which numbers were current. The panel is now
  // presentational only and takes `progress` (and `unavailable`) as plain
  // props from here.
  const { progress, unavailable } = useCaptureProgress(initialProgress, polling);

  const [state, setState] = useState<ReportState>(EMPTY_REPORT_STATE);

  const seenVersionRef = useRef(-1);
  const finalRetriesRef = useRef(0);

  useEffect(() => {
    if (state.final) return;

    const isCompleteTrigger = progress.status === "complete";
    const versionRose = progress.partialVersion > seenVersionRef.current;
    if (!isCompleteTrigger && !versionRose) return;
    if (versionRose) seenVersionRef.current = progress.partialVersion;

    const controller = new AbortController();
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/manager-pulse/runs/${progress.runId}/report`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (cancelled || !isReportApiResponse(body)) return;

        const report = isReportShape(body.report) ? body.report : null;
        if (report) {
          setState({
            report,
            coverage: body.coverage,
            coverageTotal: body.coverageTotal,
            computedAt: body.computedAt,
            final: body.final,
          });
        }

        // Once the run itself says "complete", keep asking until the report
        // route says `final: true` too (finalize.ts writes the final report
        // slightly after the run's own status flips), or until the retry
        // budget is spent. A run that never finalizes is left showing its
        // newest live report rather than spinning forever.
        if (isCompleteTrigger && !body.final && finalRetriesRef.current < FINAL_RETRY_LIMIT) {
          finalRetriesRef.current += 1;
          retryTimer = setTimeout(fetchOnce, polling.pollIntervalMs ?? 2000);
        }
      } catch {
        // A dropped fetch leaves the newest report on screen. The next
        // partialVersion bump, or the completion retry above, tries again.
      }
    };

    void fetchOnce();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state.final is read, not depended on: it is only used to short-circuit re-running this effect once we already have the final report, and adding it as a dependency would rerun the fetch on every state.final flip instead of only on the triggers this effect actually watches.
  }, [progress.partialVersion, progress.status, progress.runId, polling.pollIntervalMs]);

  // ALWAYS THE SAME OUTER ELEMENT, live or final. This used to return
  // <LiveReportBody> as the root the instant state.final flipped true, while
  // every other branch returned this <div> wrapping the panel, the banner and
  // LiveReportBody. React sees a different element type at the same
  // position and unmounts the whole subtree to rebuild it: a keyboard user's
  // activeElement fell back to <body> and a screen reader's virtual cursor
  // reset to the top of the document, on a report they may have been reading
  // for two minutes. Keeping this <div> as the root for every stage, and only
  // varying what renders inside it, lets LiveReportBody reconcile in place
  // instead of remounting.
  //
  // Focus is deliberately left alone on the final transition rather than
  // moved to a heading: the "Complete" sentence already reaches the live
  // region below (CaptureProgressPanel's sr-only status, fired when
  // progress.status turns "complete", which happens before this state
  // finishes fetching the final report), so a reader has already been told
  // the run is done by the time the swap itself happens.
  return (
    <div className="space-y-6">
      {/* One <h1> per page. During the whole live phase (report landed or
          not) this is it; ManagerMasthead below renders at heading level 2
          so there is never a second, conflicting h1 - and never one that
          sits, mis-ordered, after the panel's own "Reading leagues" <h2>.
          Once final, this is gone and ManagerMasthead becomes the sole h1. */}
      {!state.final && <ReportHeading handle={handle} />}

      {!state.final && (
        <CaptureProgressPanel
          progress={progress}
          unavailable={unavailable}
          liveCoverage={
            state.report ? { coverage: state.coverage, coverageTotal: state.coverageTotal } : null
          }
        />
      )}

      {/* Plain visible text, not a live region: CaptureProgressPanel's own
          sr-only region is the only speaker for a live-report checkpoint (see
          its header). This states the same coverage in words above the fold,
          for a reader looking at (or already inside) the report itself. */}
      {!state.final && state.report && (
        <p className="text-sm text-ink-muted">
          Based on {state.coverage} of {state.coverageTotal} league-seasons so far. Updating as the
          rest are read.
        </p>
      )}

      {state.report ? (
        <LiveReportBody
          report={state.report}
          lens={lens}
          generatedAt={state.computedAt ?? state.report.generatedAt}
          headingLevel={state.final ? 1 : 2}
        />
      ) : (
        <PendingSections />
      )}
    </div>
  );
}

/**
 * The page's one <h1> for the whole live phase, whether a live report has
 * landed yet or not. ManagerMasthead (rendered inside LiveReportBody) is
 * given headingLevel={2} for as long as this renders alongside it, so the two
 * never disagree about which element is the page's h1 and never put the
 * masthead's heading ahead of - or after, in the wrong order relative to -
 * this one. Only once the report is final does this stop rendering and
 * ManagerMasthead take over as the sole h1. Moved here from
 * app/tools/manager-pulse/[handle]/page.tsx's now-deleted ReportHeading: kept
 * deliberately light (an eyebrow plus the handle) for the same reason that one
 * was, and required for one thing: proper heading hierarchy, which the
 * "report not built yet" state would otherwise carry no <h1> for at all.
 */
function ReportHeading({ handle }: { handle: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        Manager Pulse
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{handle}</h1>
    </div>
  );
}


/**
 * The eight report sections, before any live report has landed: one anchor
 * and a waiting notice each (moved here from app/tools/manager-pulse/[handle]/page.tsx,
 * MPS-T043/T044). No `lens` prop: there is no data yet to filter.
 */
function PendingSections() {
  return (
    <div className="space-y-3">
      {MANAGER_NAV_ITEMS.map((item) => (
        <PendingSection key={item.id} id={item.id} label={item.label} />
      ))}
    </div>
  );
}

/**
 * The anchor a nav row needs for a section that has not landed yet.
 *
 * The nav rail and the mobile dock link to `#identity`, `#results` and so on
 * unconditionally, so during a build those anchors have to exist or activating
 * a nav link does nothing.
 *
 * ONE LINE, NOT A CARD. Eight full-height cards each saying "still reading
 * leagues" filled three screens with the same sentence written eight times,
 * under a progress panel that had already listed all eight sections and their
 * state. This is the anchor and the heading, and nothing else.
 *
 * No `role="status"`: the capture progress panel above is the one live region
 * on this page, and eight static strings are not status updates.
 */
function PendingSection({ id, label }: { id: ManagerSection; label: string }) {
  const headingId = `${managerSectionElementId(id)}-heading`;
  return (
    <section
      id={managerSectionElementId(id)}
      aria-labelledby={headingId}
      className="flex scroll-mt-24 items-center justify-between gap-3 rounded-card border border-dashed border-line bg-surface/30 px-4 py-3"
    >
      <h2 id={headingId} className="text-sm font-semibold text-ink-muted">
        {label}
      </h2>
      <span className="text-xs text-ink-subtle">Still reading leagues</span>
    </section>
  );
}
