import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern, formatDuration } from "@/lib/datetime";
import { ManagerPulseSubnav } from "@/components/admin/manager-pulse-subnav";
import { Pager } from "@/components/admin/pager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manager Pulse runs" };

const PAGE_SIZE = 20;

const RUN_STATUSES = [
  "pending",
  "capturing",
  "computing",
  "complete",
  "error",
  "throttled",
] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

type RunRow = {
  id: string;
  sleeper_user_id: string;
  sleeper_handle: string | null;
  season_from: number;
  season_to: number;
  status: string;
  leagues_total: number;
  leagues_done: number;
  leagues_failed: number;
  detail: string | null;
  counts_against_cooldown: boolean;
  requested_at: string;
  completed_at: string | null;
  section_status: Record<string, string> | null;
};

type RunLeagueRow = {
  run_id: string;
  sleeper_league_id: string;
  season: number;
  league_name: string | null;
  league_category: string | null;
  status: string;
  detail: string | null;
};

/** Same words the report and its progress panel use for these eight
 *  sections, so an admin reading a run's section_status recognizes the same
 *  names a reader would have seen on screen. */
const SECTION_LABEL: Record<string, string> = {
  identity: "Overview",
  results: "Results",
  drafting: "Drafting",
  affinity: "Who they like",
  trading: "Trading",
  rosterOps: "Roster moves",
  narrative: "How to deal",
  leagues: "Leagues",
};

const SECTION_ORDER = [
  "identity",
  "results",
  "drafting",
  "affinity",
  "trading",
  "rosterOps",
  "narrative",
  "leagues",
] as const;

/** manager_pulse_runs.section_status is a jsonb map of section id to
 *  "pending" | "ready" | "unavailable", populated as the capture drains. Read
 *  defensively since it is jsonb: anything other than a plain string map
 *  renders as though the run recorded nothing, rather than throwing. */
function sectionStatusEntries(value: Record<string, string> | null): Array<[string, string]> {
  if (!value || typeof value !== "object") return [];
  return SECTION_ORDER.filter((id) => typeof value[id] === "string").map((id) => [id, value[id]]);
}

/** Rows per page when paging manager_pulse_run_leagues. PostgREST caps a
 *  plain select at 1000 regardless of a larger `.limit()`. */
const LEAGUE_PAGE_SIZE = 1000;

/** Real ceiling on how many league rows this page will read across the
 *  20 runs on screen. 20 runs at up to 60 leagues each is 1200 rows, so the
 *  previous single unranged read (PostgREST's own 1000-row default) silently
 *  dropped some runs' leagues; this cap is high enough to cover a full page
 *  of runs at that size with headroom, and low enough to bound a pathological
 *  run count. */
const RUN_LEAGUE_ROW_CAP = 5000;

/** Every manager_pulse_run_leagues row for the given run ids, paged up to
 *  RUN_LEAGUE_ROW_CAP, deterministically ordered (season desc, then league id
 *  as a tiebreaker) so paging never returns overlapping or skipped rows. */
async function loadRunLeagues(
  admin: ReturnType<typeof createAdminClient>,
  runIds: string[],
): Promise<{ rows: RunLeagueRow[]; capped: boolean }> {
  if (runIds.length === 0) return { rows: [], capped: false };
  const rows: RunLeagueRow[] = [];
  let capped = false;
  for (let from = 0; from < RUN_LEAGUE_ROW_CAP; from += LEAGUE_PAGE_SIZE) {
    const to = Math.min(from + LEAGUE_PAGE_SIZE, RUN_LEAGUE_ROW_CAP) - 1;
    const { data, error } = await admin
      .from("manager_pulse_run_leagues")
      .select("run_id, sleeper_league_id, season, league_name, league_category, status, detail")
      .in("run_id", runIds)
      .order("season", { ascending: false })
      .order("sleeper_league_id", { ascending: true })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as RunLeagueRow[]));
    if (data.length < to - from + 1) break;
    if (to + 1 >= RUN_LEAGUE_ROW_CAP) capped = true;
  }
  return { rows, capped };
}

function statusTone(status: string): string {
  if (status === "error") return "border-signal-danger/40 bg-signal-danger/10 text-signal-danger";
  if (status === "complete") return "border-signal-success/40 bg-signal-success/10 text-signal-success";
  if (status === "throttled") return "border-signal-warning/40 bg-signal-warning/10 text-signal-warning";
  if (status === "capturing" || status === "computing")
    return "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";
  return "border-line bg-surface text-ink-muted";
}

function leagueStatusTone(status: string): string {
  if (status === "failed") return "border-signal-danger/40 bg-signal-danger/10 text-signal-danger";
  if (status === "done" || status === "fresh")
    return "border-signal-success/40 bg-signal-success/10 text-signal-success";
  if (status === "queued") return "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";
  return "border-line bg-surface text-ink-muted";
}

export default async function ManagerPulseRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  await requireAdmin("/admin/manager-pulse/runs");

  const { page: pageParam, status: statusParam } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const statusFilter = statusParam && isRunStatus(statusParam) ? statusParam : null;

  const admin = createAdminClient();

  const from = (pageNum - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("manager_pulse_runs")
    .select(
      "id, sleeper_user_id, sleeper_handle, season_from, season_to, status, leagues_total, leagues_done, leagues_failed, detail, counts_against_cooldown, requested_at, completed_at, section_status",
      { count: "exact" },
    )
    .order("requested_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, count, error } = await query.range(from, to);

  const runs = (data ?? []) as RunRow[];
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(pageNum, totalPages);

  const runIds = runs.map((r) => r.id);
  const { rows: leagueRows, capped: leaguesCapped } = await loadRunLeagues(admin, runIds);

  const leaguesByRun = new Map<string, RunLeagueRow[]>();
  for (const row of leagueRows) {
    const existing = leaguesByRun.get(row.run_id);
    if (existing) existing.push(row);
    else leaguesByRun.set(row.run_id, [row]);
  }

  return (
    <>
      <ManagerPulseSubnav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Manager Pulse runs</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Every requested lookup, newest first: who was looked up, how far the capture got, and what
          it says when something stalls.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          A run marked <span className="font-semibold text-ink">free run</span> queued no new work,
          because every league-season it needed was already fresh. A free run does not spend the
          reader&apos;s hourly cooldown, so two runs close together for the same handle is not a sign
          the limit is broken.
        </p>

        {error ? (
          <p className="mt-6 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
            Could not load runs. {error.message}
          </p>
        ) : (
          <>
            <form
              method="GET"
              role="search"
              aria-label="Filter runs by status"
              className="mt-6 flex flex-wrap items-end gap-3"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="run-status" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Filter by status
                </label>
                <select
                  id="run-status"
                  name="status"
                  defaultValue={statusFilter ?? ""}
                  className="min-h-11 w-56 rounded-card border border-line bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <option value="">All statuses</option>
                  {RUN_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Filter
              </button>
              {statusFilter ? (
                <Link
                  href="/admin/manager-pulse/runs"
                  className="inline-flex min-h-11 items-center px-1 text-sm text-brand-cyan underline underline-offset-2"
                >
                  Clear filter
                </Link>
              ) : null}
            </form>

            <p className="mt-4 text-sm text-ink-muted">
              {totalCount} run{totalCount === 1 ? "" : "s"}
              {statusFilter ? ` with status "${statusFilter}"` : ""}.
            </p>

            {leaguesCapped ? (
              <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                This page reads at most {RUN_LEAGUE_ROW_CAP} league-season rows across the runs shown
                below. Some runs&apos; league lists on this page may be incomplete; narrow the status
                filter or move to a different page to see the rest.
              </p>
            ) : null}

            {runs.length === 0 ? (
              <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
                No runs match that filter.
              </p>
            ) : (
              <>
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Manager Pulse runs table, scrollable"
                  className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <table className="w-max min-w-full border-collapse text-sm">
                    <caption className="sr-only">
                      Manager Pulse runs, newest first, page {currentPage} of {totalPages}
                    </caption>
                    <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Handle
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Window
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Status
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Progress
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Requested
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Duration
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Detail
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Leagues
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => {
                        const leagues = leaguesByRun.get(run.id) ?? [];
                        const sectionEntries = sectionStatusEntries(run.section_status);
                        const durationMs =
                          run.status === "complete" && run.completed_at
                            ? new Date(run.completed_at).getTime() - new Date(run.requested_at).getTime()
                            : null;
                        return (
                          <tr key={run.id} className="border-t border-line/60 align-top">
                            <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                              {run.sleeper_handle ?? run.sleeper_user_id}
                            </th>
                            <td className="px-3 py-2 text-ink-muted">
                              {run.season_from} to {run.season_to}
                              {!run.counts_against_cooldown ? (
                                <span className="ml-1.5 inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
                                  Free run
                                  <span className="sr-only">
                                    : this run queued no new work, so it did not use the reader&apos;s
                                    hourly cooldown.
                                  </span>
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusTone(run.status)}`}
                              >
                                {run.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-ink">
                              {run.leagues_done} of {run.leagues_total}
                              {run.leagues_failed > 0 ? (
                                <span className="ml-1 text-signal-danger">
                                  , {run.leagues_failed} failed
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-ink-muted">{formatEastern(run.requested_at)}</td>
                            <td className="px-3 py-2 text-ink-muted">{formatDuration(durationMs)}</td>
                            <td className="max-w-xs px-3 py-2 text-ink-muted">
                              {run.detail ?? ""}
                            </td>
                            <td className="px-3 py-2">
                              <details>
                                <summary className="min-h-11 cursor-pointer select-none rounded-card px-2 py-2 text-xs font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
                                  {leagues.length} league{leagues.length === 1 ? "" : "s"}
                                </summary>
                                {leagues.length === 0 ? (
                                  <p className="mt-2 max-w-xs text-xs text-ink-subtle">
                                    No league-seasons recorded for this run.
                                  </p>
                                ) : (
                                  <ul className="mt-2 max-w-xs space-y-2">
                                    {leagues.map((lg) => (
                                      <li
                                        key={`${lg.run_id}-${lg.sleeper_league_id}-${lg.season}`}
                                        className="rounded-card border border-line/60 bg-surface/40 p-2"
                                      >
                                        <p className="text-xs font-medium text-ink">
                                          {lg.league_name ?? "Unnamed league"}{" "}
                                          <span className="text-ink-subtle">{lg.season}</span>
                                        </p>
                                        <span
                                          className={`mt-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${leagueStatusTone(lg.status)}`}
                                        >
                                          {lg.status}
                                        </span>
                                        {lg.detail ? (
                                          <p className="mt-1 text-[11px] text-ink-subtle">{lg.detail}</p>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <p className="mt-3 text-xs font-semibold text-ink-subtle">
                                  Section status
                                </p>
                                {sectionEntries.length === 0 ? (
                                  <p className="mt-1 max-w-xs text-xs text-ink-subtle">
                                    No section status has been recorded for this run yet.
                                  </p>
                                ) : (
                                  <ul className="mt-1 max-w-xs space-y-1">
                                    {sectionEntries.map(([id, status]) => (
                                      <li
                                        key={id}
                                        className="flex items-center justify-between gap-2 text-xs text-ink-muted"
                                      >
                                        <span className="text-ink">{SECTION_LABEL[id] ?? id}</span>
                                        <span>{status}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager
                  basePath="/admin/manager-pulse/runs"
                  paramName="page"
                  currentPage={currentPage}
                  totalPages={totalPages}
                  label="Manager Pulse run pages"
                  extraParams={statusFilter ? { status: statusFilter } : undefined}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
