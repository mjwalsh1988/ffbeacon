import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import { formatEastern } from "@/lib/datetime";
import { ManagerPulseSubnav } from "@/components/admin/manager-pulse-subnav";
import { HandleInvalidatePanel, ModelVersionInvalidatePanel, type VersionBreakdownRow } from "./cache-actions-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manager Pulse cache" };

/** Rows per page when scanning for model versions. PostgREST silently caps a
 * plain `select()` at 1000 rows regardless of `.limit()`, so a version scan
 * has to page with `.range()` to see past the first 1000. */
const VERSION_SCAN_PAGE_SIZE = 1000;

/** Real ceiling on how many rows the version scan will page through, per
 * table. Bounded rather than unbounded: this feature is young and the table
 * is not expected to hold more than a few thousand rows for a long while,
 * but a scan still has to have a ceiling so a future spike in stored reports
 * cannot turn this page into a full table read. Exact per-version counts
 * still come from head:true queries, so the counts shown are always exact
 * for whatever versions this scan finds; only the SET of versions could miss
 * one that appears exclusively beyond the cap. */
const VERSION_SCAN_ROW_CAP = 10000;

/**
 * Every distinct `model_version` seen across up to `VERSION_SCAN_ROW_CAP`
 * rows of `table`, paged in `VERSION_SCAN_PAGE_SIZE`-row slices (finding 5:
 * the previous single `.limit(5000)` call was silently truncated to 1000 rows
 * by PostgREST's own cap, with no order-by, so which 1000 came back was
 * undefined). Ordered by `generated_at` descending so a truncated scan still
 * favors the newest, most relevant versions.
 */
async function scanModelVersions(
  admin: ReturnType<typeof createAdminClient>,
  table: "manager_pulse_cache" | "manager_pulse_tendencies",
): Promise<{ versions: Set<string>; truncated: boolean }> {
  const versions = new Set<string>();
  let truncated = false;
  for (let from = 0; from < VERSION_SCAN_ROW_CAP; from += VERSION_SCAN_PAGE_SIZE) {
    const to = Math.min(from + VERSION_SCAN_PAGE_SIZE, VERSION_SCAN_ROW_CAP) - 1;
    const { data, error } = await admin
      .from(table)
      .select("model_version")
      .order("generated_at", { ascending: false })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    for (const row of data) versions.add(row.model_version);
    if (data.length < to - from + 1) break;
    if (to + 1 >= VERSION_SCAN_ROW_CAP) truncated = true;
  }
  return { versions, truncated };
}

type ReportMetaRow = {
  id: string;
  sleeper_user_id: string;
  sleeper_handle: string | null;
  season_from: number;
  season_to: number;
  model_version: string;
  league_seasons_counted: number;
  dynasty_seasons_counted: number;
  redraft_seasons_counted: number;
  generated_at: string;
};

type TendencyMetaRow = {
  sleeper_user_id: string;
  sleeper_handle: string | null;
  dynasty_sample: number;
  redraft_sample: number;
  seasons_covered: number;
  model_version: string;
  generated_at: string;
};

async function oldestNewest(
  admin: ReturnType<typeof createAdminClient>,
  table: "manager_pulse_cache" | "manager_pulse_tendencies",
): Promise<{ oldest: string | null; newest: string | null }> {
  const [oldestRes, newestRes] = await Promise.all([
    admin.from(table).select("generated_at").order("generated_at", { ascending: true }).limit(1).maybeSingle(),
    admin.from(table).select("generated_at").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    oldest: oldestRes.data?.generated_at ?? null,
    newest: newestRes.data?.generated_at ?? null,
  };
}

export default async function ManagerPulseCachePage({
  searchParams,
}: {
  searchParams: Promise<{ handle?: string }>;
}) {
  await requireAdmin("/admin/manager-pulse/cache");
  const admin = createAdminClient();

  const { handle: handleParam } = await searchParams;
  const handle = (handleParam ?? "").trim();

  const settings = await loadManagerPulseSettings(admin);

  const [
    reportCountRes,
    tendencyCountRes,
    reportSpan,
    tendencySpan,
    reportVersionScan,
    tendencyVersionScan,
  ] = await Promise.all([
    admin.from("manager_pulse_cache").select("id", { count: "exact", head: true }),
    admin.from("manager_pulse_tendencies").select("sleeper_user_id", { count: "exact", head: true }),
    oldestNewest(admin, "manager_pulse_cache"),
    oldestNewest(admin, "manager_pulse_tendencies"),
    scanModelVersions(admin, "manager_pulse_cache"),
    scanModelVersions(admin, "manager_pulse_tendencies"),
  ]);

  const totalReports = reportCountRes.count ?? 0;
  const totalTendencies = tendencyCountRes.count ?? 0;

  const versionScanTruncated = reportVersionScan.truncated || tendencyVersionScan.truncated;

  const versionSet = new Set<string>([settings.modelVersion]);
  for (const version of reportVersionScan.versions) versionSet.add(version);
  for (const version of tendencyVersionScan.versions) versionSet.add(version);

  const versionRows: VersionBreakdownRow[] = await Promise.all(
    Array.from(versionSet).map(async (version) => {
      const [reportCount, tendencyCount] = await Promise.all([
        admin
          .from("manager_pulse_cache")
          .select("id", { count: "exact", head: true })
          .eq("model_version", version),
        admin
          .from("manager_pulse_tendencies")
          .select("sleeper_user_id", { count: "exact", head: true })
          .eq("model_version", version),
      ]);
      return {
        version,
        reportCount: reportCount.count ?? 0,
        tendencyCount: tendencyCount.count ?? 0,
        isCurrent: version === settings.modelVersion,
      };
    }),
  );
  versionRows.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.reportCount + b.tendencyCount - (a.reportCount + a.tendencyCount);
  });

  let handleReports: ReportMetaRow[] = [];
  let handleTendencies: TendencyMetaRow[] = [];
  if (handle) {
    const [reportsRes, tendenciesRes] = await Promise.all([
      admin
        .from("manager_pulse_cache")
        .select(
          "id, sleeper_user_id, sleeper_handle, season_from, season_to, model_version, league_seasons_counted, dynasty_seasons_counted, redraft_seasons_counted, generated_at",
        )
        .ilike("sleeper_handle", handle)
        .order("generated_at", { ascending: false })
        .limit(20),
      admin
        .from("manager_pulse_tendencies")
        .select(
          "sleeper_user_id, sleeper_handle, dynasty_sample, redraft_sample, seasons_covered, model_version, generated_at",
        )
        .ilike("sleeper_handle", handle)
        .order("generated_at", { ascending: false })
        .limit(5),
    ]);
    handleReports = (reportsRes.data ?? []) as ReportMetaRow[];
    handleTendencies = (tendenciesRes.data ?? []) as TendencyMetaRow[];
  }

  return (
    <>
      <ManagerPulseSubnav />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Manager Pulse cache</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          What is stored, how old it is, and how to clear it. This page never reads the report or
          tendency documents themselves, only their metadata.
        </p>

        <section aria-labelledby="mp-cache-overview" className="mt-8">
          <h2 id="mp-cache-overview" className="text-lg font-semibold tracking-tight text-ink">
            What is stored
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Reports (manager_pulse_cache)
              </p>
              <p className="mt-1 text-2xl font-bold text-ink">{totalReports}</p>
              <p className="mt-2 text-xs text-ink-subtle">
                Oldest {formatEastern(reportSpan.oldest)}, newest {formatEastern(reportSpan.newest)}
              </p>
            </div>
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Tendencies (manager_pulse_tendencies)
              </p>
              <p className="mt-1 text-2xl font-bold text-ink">{totalTendencies}</p>
              <p className="mt-2 text-xs text-ink-subtle">
                Oldest {formatEastern(tendencySpan.oldest)}, newest {formatEastern(tendencySpan.newest)}
              </p>
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-ink">Breakdown by model version</h3>
          {versionScanTruncated ? (
            <p className="mt-1 text-xs text-signal-warning">
              The version scan is capped at {VERSION_SCAN_ROW_CAP} rows per table. A version that only
              appears past that cap will not be listed here, though its counts below are still exact
              for every version that was found.
            </p>
          ) : null}
          <div className="mt-2 overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Manager Pulse reports and tendency rows by model version, current version first
              </caption>
              <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Version
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Reports
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Tendencies
                  </th>
                </tr>
              </thead>
              <tbody>
                {versionRows.map((v) => (
                  <tr key={v.version} className="border-t border-line/60">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                      {v.version}
                      {v.isCurrent ? (
                        <span className="ml-1.5 inline-flex items-center rounded-full border border-brand-purple/40 bg-brand-purple/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
                          Current
                        </span>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 text-ink-muted">{v.reportCount}</td>
                    <td className="px-3 py-2 text-ink-muted">{v.tendencyCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mt-6 text-sm font-semibold text-ink">Clear a superseded model version</h3>
            <p className="mt-1 text-xs text-ink-muted">
              The current version is never offered here. Clearing a superseded version does not
              affect the live report anyone is reading right now.
            </p>
            <ModelVersionInvalidatePanel versions={versionRows} />
          </div>
        </section>

        <section aria-labelledby="mp-cache-lookup" className="mt-10">
          <h2 id="mp-cache-lookup" className="text-lg font-semibold tracking-tight text-ink">
            Look up a handle
          </h2>
          <form
            method="GET"
            role="search"
            aria-label="Look up a Sleeper handle's stored cache"
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="mp-handle-search" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Sleeper handle
              </label>
              <input
                id="mp-handle-search"
                type="text"
                name="handle"
                defaultValue={handle}
                className="min-h-11 w-64 rounded-card border border-line bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Look up
            </button>
            {handle ? (
              <Link
                href="/admin/manager-pulse/cache"
                className="inline-flex min-h-11 items-center px-1 text-sm text-brand-cyan underline underline-offset-2"
              >
                Clear
              </Link>
            ) : null}
          </form>

          {handle ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-ink">Report rows for {handle}</h3>
              {handleReports.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No stored report rows for this handle.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-card border border-line">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Stored Manager Pulse report rows for {handle}</caption>
                    <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Window
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Version
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          League-seasons
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Generated
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {handleReports.map((r) => (
                        <tr key={r.id} className="border-t border-line/60">
                          <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                            {r.season_from} to {r.season_to}
                          </th>
                          <td className="px-3 py-2 text-ink-muted">{r.model_version}</td>
                          <td className="px-3 py-2 text-ink-muted">
                            {r.league_seasons_counted} ({r.dynasty_seasons_counted} dynasty,{" "}
                            {r.redraft_seasons_counted} redraft)
                          </td>
                          <td className="px-3 py-2 text-ink-muted">{formatEastern(r.generated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="mt-6 text-sm font-semibold text-ink">Tendency row for {handle}</h3>
              {handleTendencies.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No stored tendency row for this handle.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-card border border-line">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Stored Manager Pulse tendency rows for {handle}</caption>
                    <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Version
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Seasons covered
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Dynasty sample
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Redraft sample
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">
                          Generated
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {handleTendencies.map((t) => (
                        <tr key={t.sleeper_user_id} className="border-t border-line/60">
                          <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                            {t.model_version}
                          </th>
                          <td className="px-3 py-2 text-ink-muted">{t.seasons_covered}</td>
                          <td className="px-3 py-2 text-ink-muted">{t.dynasty_sample}</td>
                          <td className="px-3 py-2 text-ink-muted">{t.redraft_sample}</td>
                          <td className="px-3 py-2 text-ink-muted">{formatEastern(t.generated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="mt-6 text-sm font-semibold text-ink">Clear this handle</h3>
              <HandleInvalidatePanel
                handle={handle}
                reportCount={handleReports.length}
                tendencyCount={handleTendencies.length}
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">
              Enter a handle to see what is stored for that manager and clear it.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
