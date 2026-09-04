import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDuration } from "@/lib/datetime";
import { ManagerPulseSubnav } from "@/components/admin/manager-pulse-subnav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manager Pulse draft clock" };

/**
 * Distinct draft count, the season breakdown and the median observation gap
 * all need row-level data: Postgres has no distinct-count or median exposed
 * through a plain PostgREST select, and this page owns no RPC to add one.
 * The exact, cheap figures (total picks, null-gap count, autopick coverage)
 * are still pulled as SQL aggregates via head:true counts. This cap bounds
 * the one row-level read the page needs; it is stated on the page whenever
 * it is reached.
 *
 * PostgREST caps a plain `select()` at 1000 rows regardless of `.limit()`,
 * so reaching this cap requires paging with `.range()`
 * (`PAGE_SIZE`-row slices) rather than one `.limit(MAX_OBSERVATION_ROWS)`
 * call. The previous single-call version silently returned at most 1000
 * rows no matter what MAX_OBSERVATION_ROWS said, which meant `rowsCapped`
 * could never observe the real cap being reached.
 */
const PAGE_SIZE = 1000;
const MAX_OBSERVATION_ROWS = 5000;

type ObservationRow = {
  sleeper_draft_id: string;
  season: number | null;
  observation_gap_ms: number | null;
};

function median(sortedAscending: number[]): number {
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 !== 0
    ? sortedAscending[mid]
    : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

/** Pages `draft_pick_observations` up to `MAX_OBSERVATION_ROWS`, newest
 *  first. Returns whether the real cap was reached, which the page renders
 *  as an honest note whenever it fires. */
async function loadObservationRows(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ rows: ObservationRow[]; capped: boolean }> {
  const rows: ObservationRow[] = [];
  let capped = false;
  for (let from = 0; from < MAX_OBSERVATION_ROWS; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, MAX_OBSERVATION_ROWS) - 1;
    const { data, error } = await admin
      .from("draft_pick_observations")
      .select("sleeper_draft_id, season, observation_gap_ms")
      .order("first_seen_at", { ascending: false })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as ObservationRow[]));
    if (data.length < to - from + 1) break;
    if (to + 1 >= MAX_OBSERVATION_ROWS) capped = true;
  }
  return { rows, capped };
}

export default async function ManagerPulseObservationsPage() {
  await requireAdmin("/admin/manager-pulse/observations");
  const admin = createAdminClient();

  const [totalPicksRes, nullGapRes, autopickKnownRes, autopickTrueRes, observations] = await Promise.all([
    admin.from("draft_pick_observations").select("id", { count: "exact", head: true }),
    admin
      .from("draft_pick_observations")
      .select("id", { count: "exact", head: true })
      .is("observation_gap_ms", null),
    admin
      .from("draft_pick_observations")
      .select("id", { count: "exact", head: true })
      .not("was_autopick", "is", null),
    admin
      .from("draft_pick_observations")
      .select("id", { count: "exact", head: true })
      .eq("was_autopick", true),
    loadObservationRows(admin),
  ]);

  const totalPicks = totalPicksRes.count ?? 0;
  const nullGapCount = nullGapRes.count ?? 0;
  const autopickKnownCount = autopickKnownRes.count ?? 0;
  const autopickTrueCount = autopickTrueRes.count ?? 0;
  const rows = observations.rows;
  const rowsCapped = observations.capped;

  return (
    <>
      <ManagerPulseSubnav />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Manager Pulse draft clock</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Sleeper publishes no timestamp on a draft pick. This table is our own measurement, written
          only while a live draft is being watched, so it is the honest answer to whether the draft
          clock feature is working yet.
        </p>

        {totalPicks === 0 ? (
          <div className="mt-8 rounded-card border border-line bg-surface/40 p-6">
            <p className="text-sm text-ink">Nothing observed yet.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Per-pick timing accumulates from the first live draft the On The Clock poller watches.
              Nothing is wrong; there is simply no draft to have measured yet.
            </p>
          </div>
        ) : (
          <>
            {rowsCapped ? (
              <p className="mt-4 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                Distinct drafts, the season breakdown and the median gap below are computed from the{" "}
                {MAX_OBSERVATION_ROWS} most recent observations, not the full history. The counts above
                the fold (total picks, null gaps, autopick coverage) are exact for every observation
                ever recorded.
              </p>
            ) : null}

            <section aria-labelledby="mp-obs-totals" className="mt-6">
              <h2 id="mp-obs-totals" className="text-lg font-semibold tracking-tight text-ink">
                Totals
              </h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <StatCard label="Picks observed" value={totalPicks} />
                <StatCard
                  label={`Distinct drafts observed${rowsCapped ? " (recent)" : ""}`}
                  value={new Set(rows.map((r) => r.sleeper_draft_id)).size}
                />
              </div>
            </section>

            <SeasonBreakdown rows={rows} rowsCapped={rowsCapped} />

            <MedianGap rows={rows} rowsCapped={rowsCapped} />

            <section aria-labelledby="mp-obs-gaps" className="mt-8">
              <h2 id="mp-obs-gaps" className="text-lg font-semibold tracking-tight text-ink">
                Observations with no measurable gap
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-ink-muted">
                <span className="text-2xl font-bold text-ink">{nullGapCount}</span> of {totalPicks}{" "}
                observations have no gap recorded. Those picks were seen for the first time in a bulk
                first poll of an in-progress draft, so no elapsed time between picks could be derived
                for them. This number is expected to be large early on and is not a sign anything is
                broken.
              </p>
            </section>

            <section aria-labelledby="mp-obs-autopick" className="mt-8">
              <h2 id="mp-obs-autopick" className="text-lg font-semibold tracking-tight text-ink">
                Autopick coverage
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-ink-muted">
                <span className="text-2xl font-bold text-ink">{autopickKnownCount}</span> of{" "}
                {totalPicks} observations recorded whether the pick was made on autopick.{" "}
                {autopickTrueCount} of those were on autopick. Autopick status is only obtainable while
                a draft is live, so a pick observed after the draft finished carries no autopick value.
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function SeasonBreakdown({ rows, rowsCapped }: { rows: ObservationRow[]; rowsCapped: boolean }) {
  const bySeason = new Map<string, { drafts: Set<string>; picks: number }>();
  for (const row of rows) {
    const key = row.season != null ? String(row.season) : "Unknown season";
    const existing = bySeason.get(key);
    if (existing) {
      existing.drafts.add(row.sleeper_draft_id);
      existing.picks += 1;
    } else {
      bySeason.set(key, { drafts: new Set([row.sleeper_draft_id]), picks: 1 });
    }
  }
  const seasonRows = Array.from(bySeason.entries()).sort((a, b) => {
    if (a[0] === "Unknown season") return 1;
    if (b[0] === "Unknown season") return -1;
    return Number(b[0]) - Number(a[0]);
  });

  return (
    <section aria-labelledby="mp-obs-seasons" className="mt-8">
      <h2 id="mp-obs-seasons" className="text-lg font-semibold tracking-tight text-ink">
        Coverage by season
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Newest season first{rowsCapped ? ", from the most recent observations" : ""}.
      </p>
      <div className="mt-3 overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">Draft pick observation coverage by season, newest first</caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Season
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Drafts
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Picks
              </th>
            </tr>
          </thead>
          <tbody>
            {seasonRows.map(([season, { drafts, picks }]) => (
              <tr key={season} className="border-t border-line/60">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                  {season}
                </th>
                <td className="px-3 py-2 text-ink-muted">{drafts.size}</td>
                <td className="px-3 py-2 text-ink-muted">{picks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MedianGap({ rows, rowsCapped }: { rows: ObservationRow[]; rowsCapped: boolean }) {
  const gaps = rows
    .map((r) => r.observation_gap_ms)
    .filter((g): g is number => g != null)
    .sort((a, b) => a - b);

  return (
    <section aria-labelledby="mp-obs-median" className="mt-8">
      <h2 id="mp-obs-median" className="text-lg font-semibold tracking-tight text-ink">
        Median observation gap
      </h2>
      {gaps.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No observation carries a measurable gap yet, so no median can be computed.
        </p>
      ) : (
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          <span className="text-2xl font-bold text-ink">{formatDuration(median(gaps))}</span>, about{" "}
          {Math.round(median(gaps) / 1000)} seconds. This is the error bar the report quotes on every
          per-pick timing figure it derives from these rows, measured across {gaps.length} observation
          {gaps.length === 1 ? "" : "s"}
          {rowsCapped ? " (the most recent sample)" : ""}.
        </p>
      )}
    </section>
  );
}
