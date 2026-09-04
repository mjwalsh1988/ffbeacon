import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Clock, SearchX, Users } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isValidSleeperHandle } from "@/lib/manager-pulse/discover";
import type { LeagueLens, ManagerReport, ManagerSection } from "@/lib/manager-pulse/types";
import { formatEastern } from "@/lib/datetime";
import {
  ManagerShell,
  LensSwitch,
  defaultLens,
  MANAGER_NAV_ITEMS,
  managerSectionElementId,
} from "@/components/manager-shell";
import { ManagerSearchForm } from "../manager-search-form";
import { ManagerReportSkeleton } from "./report-skeleton";

// lib/manager-pulse/service.ts (Wave 3, B2) landed while this page was being
// written. THE PUBLIC DOOR per docs/manager-pulse-plan.md 3.1:
// getManagerFootprint(admin, userId, request) never throws. `userId` is the
// SIGNED-IN READER (what the cooldown metres), never the report's subject.
import { getManagerFootprint } from "@/lib/manager-pulse/service";

// components/manager-pulse/capture-progress.tsx owns its own polling (GET
// /api/manager-pulse/runs/[id] via use-capture-progress.ts). It takes the whole
// CaptureProgress this render already has, so the panel paints real counts on
// first frame instead of an empty bar waiting for its first poll to land.
import { CaptureProgressPanel } from "@/components/manager-pulse/capture-progress";

// The eight report sections (Wave 4, C2 covers 6.1-6.4, C3 covers 6.5-6.8),
// matching their actual prop shapes: each takes the specific ManagerReport
// slice it renders (not the whole report), and only the ones built on
// PoolableStat / PerTypeStat data (Results, Drafting, Trading, Roster moves)
// take `lens` - Identity, Affinity and How to deal read plain arrays/counts
// and filter nothing themselves. EVERY SECTION RENDERS ITS OWN
// <section id="..."> VIA components/manager-pulse/section-frame.tsx, id set to
// the literal ManagerSection string with one exception (rosterOps ->
// "roster-ops"), which is why nav-items.ts's managerSectionElementId is a
// lookup against the real ids rather than a blind pass-through.
import { IdentitySection } from "@/components/manager-pulse/identity-section";
import { ResultsSection } from "@/components/manager-pulse/results-section";
import { DraftingSection } from "@/components/manager-pulse/drafting-section";
import { AffinitySection } from "@/components/manager-pulse/affinity-section";
import { TradingSection } from "@/components/manager-pulse/trading-section";
import { RosterOpsSection } from "@/components/manager-pulse/roster-ops-section";
import { NarrativeSection } from "@/components/manager-pulse/narrative-section";
import { LeaguesSection } from "@/components/manager-pulse/leagues-section";
import { LimitsNote } from "@/components/manager-pulse/limits-note";
import { SectionFrame } from "@/components/manager-pulse/section-frame";

export const dynamic = "force-dynamic";

/**
 * These pages describe a named real person, assembled from their public
 * Sleeper history. They must never be indexed (docs/manager-pulse-plan.md
 * 7.1), regardless of whether the lookup below succeeds.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: rawHandle } = await params;
  const handle = rawHandle.trim().toLowerCase();
  return {
    title: isValidSleeperHandle(handle) ? `Manager Pulse: ${handle}` : "Manager Pulse",
    robots: { index: false, follow: false },
  };
}

export default async function ManagerPulseReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ lens?: string }>;
}) {
  const { handle: rawHandle } = await params;
  const { lens: lensParam } = await searchParams;
  const handle = rawHandle.trim().toLowerCase();

  // SIGNED IN ONLY, gated server-side, independently of the entry page's own
  // gate (docs/manager-pulse-plan.md 7.2: a client prop is never a security
  // boundary). Cheap: one auth read, no Sleeper call and no compute, so it
  // stays on the page's own await rather than inside the boundary below.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/tools/manager-pulse/${handle}`)}`);
  }

  // Also cheap and synchronous: a regex test against the URL segment, no
  // network or database round trip.
  if (!isValidSleeperHandle(handle)) {
    return <InvalidHandleState handle={rawHandle} />;
  }

  // EVERYTHING THAT CAN COST A SLEEPER ROUND TRIP OR A COMPUTE LIVES INSIDE
  // THIS ONE BOUNDARY (docs/manager-pulse-plan.md 7.4, finding 1). The page
  // itself never awaits `getManagerFootprint`: on a cold lookup that call can
  // carry several Sleeper requests, and blocking the whole page on it left
  // eight `<Suspense>` boundaries below with nothing left to suspend on,
  // since they all read slices of the one already-resolved report. One real
  // boundary, one real fallback, following the same cheap/expensive split
  // `app/leagues/[league_id]/page.tsx` uses for `pulseLeagueCore` versus its
  // derived work.
  return (
    <Suspense fallback={<ManagerReportSkeleton />}>
      <ManagerReportBoundary handle={handle} userId={user.id} lensParam={lensParam} />
    </Suspense>
  );
}

/**
 * The one async child the page's `<Suspense>` boundary wraps. Owns the whole
 * `getManagerFootprint` call and every status it can return; nothing above it
 * in the tree touches the report.
 */
async function ManagerReportBoundary({
  handle,
  userId,
  lensParam,
}: {
  handle: string;
  userId: string;
  lensParam: string | undefined;
}) {
  const adminClient = createAdminClient();
  const result = await getManagerFootprint(adminClient, userId, { handle });

  if (result.status === "not_found") {
    return <NotFoundState handle={result.handle} />;
  }
  if (result.status === "throttled") {
    return <ThrottledState retryAfterSeconds={result.retryAfterSeconds} />;
  }
  if (result.status === "empty") {
    return <EmptyState handle={handle} reason={result.reason} />;
  }
  if (result.status === "error") {
    return <ErrorState handle={handle} />;
  }

  if (result.status === "building") {
    const requestedLens = isLens(lensParam) ? lensParam : "all";
    return (
      <ManagerShell handle={handle}>
        <div className="space-y-6">
          <ReportHeading handle={handle} />
          <CaptureProgressPanel progress={result.progress} />
          <PartialSections partial={result.partial} lens={requestedLens} />
        </div>
      </ManagerShell>
    );
  }

  // result.status === "ready"
  const report = result.report;
  const requestedLens = isLens(lensParam) ? lensParam : defaultLens(report.counts);

  return (
    <ManagerShell handle={handle}>
      <div className="space-y-8">
        <ReportHeading handle={handle} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Suspense fallback={<div className="h-11 w-64 rounded-card bg-surface/60" aria-hidden="true" />}>
            <LensSwitch
              lens={requestedLens}
              counts={{
                leagueSeasons: report.counts.leagueSeasons,
                dynasty: report.counts.dynasty,
                redraft: report.counts.redraft,
              }}
            />
          </Suspense>
          {result.stale && (
            <p role="status" className="text-xs text-ink-subtle">
              Showing a saved report from {formatEastern(result.generatedAt)} while
              we check for anything newer.
            </p>
          )}
        </div>

        <ReportSections report={report} lens={requestedLens} />

        <LimitsNote limits={report.limits} />
      </div>
    </ManagerShell>
  );
}

/**
 * The page's one <h1>. None of the eight report sections render one:
 * components/manager-pulse/section-frame.tsx gives every section its own
 * <h2>, the same way components/dashboard-panel.tsx's Panel does elsewhere, so
 * this is the only place on the page that names the manager at heading level
 * one. Kept deliberately light (an eyebrow plus the handle) because the
 * Overview section immediately below already carries the avatar and the
 * headline "league-seasons found" figure; this exists for the heading
 * hierarchy, not to repeat that card.
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

function isLens(value: string | undefined): value is LeagueLens {
  return value === "all" || value === "dynasty" || value === "redraft";
}

/* ---------- Ready: the full report, one boundary per section ---------- */

/**
 * Every section renders its own `<section id="...">` (see the import comment
 * above). No per-section `<Suspense>` here: `report` is the one already-
 * resolved document `ManagerReportBoundary` awaited, so every section below
 * receives plain, already-present props and none of them can suspend on its
 * own. Wrapping each in its own boundary was decoration (finding 1) - the
 * real boundary is the one around `ManagerReportBoundary` itself, since the
 * service returns one atomic report rather than eight independent streams.
 */
function ReportSections({ report, lens }: { report: ManagerReport; lens: LeagueLens }) {
  const counts = { leagueSeasons: report.counts.leagueSeasons, dynasty: report.counts.dynasty, redraft: report.counts.redraft };
  return (
    <div className="space-y-8">
      <IdentitySection identity={report.identity} window={report.window} />
      <ResultsSection results={report.results} lens={lens} />
      <DraftingSection drafting={report.drafting} lens={lens} />
      <AffinitySection affinity={report.affinity} />
      <TradingSection trading={report.trading} counts={counts} lens={lens} />
      <RosterOpsSection rosterOps={report.rosterOps} totalLeagueSeasons={counts} lens={lens} />
      <NarrativeSection narrative={report.narrative} />
      <LeaguesSection leagues={report.leagues} />
    </div>
  );
}

/* ---------- Building: real sections where we have them, a placeholder otherwise ---------- */

function PartialSections({
  partial,
  lens,
}: {
  partial: Partial<Pick<ManagerReport, ManagerSection>>;
  lens: LeagueLens;
}) {
  const counts = partial.identity
    ? {
        leagueSeasons: partial.identity.leagueSeasonsFound,
        dynasty: partial.identity.splits.dynasty + partial.identity.splits.bestBallDynasty,
        redraft: partial.identity.splits.redraft + partial.identity.splits.bestBallRedraft,
      }
    : { leagueSeasons: 0, dynasty: 0, redraft: 0 };

  return (
    <div className="space-y-8">
      {MANAGER_NAV_ITEMS.map((item) => (
        <PartialSection
          key={item.id}
          id={item.id}
          label={item.label}
          partial={partial}
          counts={counts}
          lens={lens}
        />
      ))}
    </div>
  );
}

function PartialSection({
  id,
  label,
  partial,
  counts,
  lens,
}: {
  id: ManagerSection;
  label: string;
  partial: Partial<Pick<ManagerReport, ManagerSection>>;
  counts: { leagueSeasons: number; dynasty: number; redraft: number };
  lens: LeagueLens;
}) {
  // Every list and figure the section itself renders already states its own
  // sample size, so a section that has not landed yet renders as a plain
  // waiting notice rather than a zero the report never claimed.
  if (id === "identity") {
    return partial.identity ? (
      <IdentitySection identity={partial.identity} />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  if (id === "results") {
    return partial.results ? (
      <ResultsSection results={partial.results} lens={lens} />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  if (id === "drafting") {
    return partial.drafting ? (
      <DraftingSection drafting={partial.drafting} lens={lens} />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  if (id === "affinity") {
    return partial.affinity ? (
      <AffinitySection affinity={partial.affinity} />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  if (id === "trading") {
    return partial.trading ? (
      <TradingSection trading={partial.trading} counts={counts} lens={lens} />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  if (id === "rosterOps") {
    return partial.rosterOps ? (
      <RosterOpsSection
        rosterOps={partial.rosterOps}
        totalLeagueSeasons={counts}
        lens={lens}
      />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  if (id === "narrative") {
    return partial.narrative ? (
      <NarrativeSection narrative={partial.narrative} />
    ) : (
      <PendingSection id={id} label={label} />
    );
  }
  return partial.leagues ? (
    <LeaguesSection leagues={partial.leagues} />
  ) : (
    <PendingSection id={id} label={label} />
  );
}

/**
 * Renders inside `SectionFrame` so it carries the same `id` and `<h2>` a
 * finished section would. The nav rail and the mobile dock link to
 * `#identity`, `#results` and so on unconditionally, so during a build those
 * anchors have to exist or activating a nav link does nothing. No
 * `role="status"` here: the capture progress panel above is the one live
 * region on this page, and eight static "still reading" strings are not
 * status updates.
 */
function PendingSection({ id, label }: { id: ManagerSection; label: string }) {
  return (
    <SectionFrame id={managerSectionElementId(id)} title={label}>
      <p className="rounded-modal border border-dashed border-line bg-surface/30 p-5 text-sm text-ink-muted sm:p-6">
        {label} is still reading leagues. It will appear here on its own once it
        is ready.
      </p>
    </SectionFrame>
  );
}

/* ---------- Not found ---------- */

function NotFoundState({ handle }: { handle: string }) {
  return (
    <StatePage
      icon={SearchX}
      eyebrow="Manager Pulse"
      title={`We couldn't find "${handle}" on Sleeper.`}
      body="Check the spelling, or try again. Sleeper handles are case-insensitive, so capitalization never matters here."
    >
      <div className="mx-auto mt-6 max-w-md text-left">
        <ManagerSearchForm defaultHandle={handle} />
      </div>
    </StatePage>
  );
}

/* ---------- Throttled ---------- */

function ThrottledState({ retryAfterSeconds }: { retryAfterSeconds: number }) {
  const retryAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  return (
    <StatePage
      icon={Clock}
      eyebrow="Manager Pulse"
      title="One lookup at a time."
      body={`You can look up another manager after ${formatEastern(retryAt)}. Reports you have already generated stay available in the meantime.`}
    >
      <Link
        href="/tools/manager-pulse"
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Back to Manager Pulse
      </Link>
    </StatePage>
  );
}

/* ---------- Empty ---------- */

function EmptyState({ handle, reason }: { handle: string; reason: "no_leagues" | "window_empty" }) {
  const body =
    reason === "no_leagues"
      ? `We found "${handle}" on Sleeper, but no leagues at all, current or past.`
      : `We found "${handle}" on Sleeper, but no leagues in the seasons this report covers.`;
  return (
    <StatePage icon={Users} eyebrow="Manager Pulse" title="Nothing to report yet." body={body}>
      <Link
        href="/tools/manager-pulse"
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Look up someone else
      </Link>
    </StatePage>
  );
}

/* ---------- Error ---------- */

function ErrorState({ handle }: { handle: string }) {
  return (
    <StatePage
      icon={AlertTriangle}
      eyebrow="Manager Pulse"
      title="We couldn't build this report."
      body="Something went wrong while reading Sleeper. Try again, or head back to search."
      isError
    >
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={`/tools/manager-pulse/${encodeURIComponent(handle)}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Retry
        </Link>
        <Link
          href="/tools/manager-pulse"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Back to Manager Pulse
        </Link>
      </div>
    </StatePage>
  );
}

/* ---------- Invalid handle segment ---------- */

function InvalidHandleState({ handle }: { handle: string }) {
  return (
    <StatePage
      icon={SearchX}
      eyebrow="Manager Pulse"
      title="That's not a Sleeper handle."
      body={`"${handle}" doesn't match Sleeper's handle grammar: letters, numbers, and underscores only.`}
    >
      <div className="mx-auto mt-6 max-w-md text-left">
        <ManagerSearchForm />
      </div>
    </StatePage>
  );
}

/* ---------- Shared state-page shell ---------- */

function StatePage({
  icon: Icon,
  eyebrow,
  title,
  body,
  isError = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  eyebrow: string;
  title: string;
  body: string;
  /** Only ErrorState passes this. Throttled and Empty are not errors, so the
   *  container never carries role="alert"; when a state genuinely is one, the
   *  role sits on the short body paragraph alone. */
  isError?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <main id="main">
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6 lg:px-8">
        <div className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 shadow-2xl shadow-black/40">
          <span
            aria-hidden="true"
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
          >
            <Icon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {title}
          </h1>
          <p
            role={isError ? "alert" : undefined}
            className="mx-auto mt-3 max-w-md text-sm text-ink-muted"
          >
            {body}
          </p>
          {children}
        </div>
      </div>
    </main>
  );
}
