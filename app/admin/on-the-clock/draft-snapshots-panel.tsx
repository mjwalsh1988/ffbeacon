import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Admin visibility for completed-draft snapshots (server component, rendered on
 * /admin/on-the-clock below the settings manager). Shows the most recent
 * finalized snapshots with the provenance the finalizer recorded: which value
 * and ADP snapshot dates were used, how they were chosen (exact / previous /
 * during draft / next available / current fallback), and the overall
 * confidence. Drafts listed here render in snapshot mode; anything not listed
 * renders live. Deliberately read-only: recalculation is a manual, intentional
 * act (delete the row; the draft rebuilds on next open), not a button.
 */

const SOURCE_LABEL: Record<string, string> = {
  exact: "Exact date",
  during_draft: "During draft",
  previous: "Closest before",
  next_available: "Nearest after (estimated)",
  current_fallback: "Current data (fallback)",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  low: "border-red-500/40 bg-red-500/10 text-red-300",
};

function sourceLabel(v: string | null): string {
  return (v && SOURCE_LABEL[v]) || "Unknown";
}

export async function DraftSnapshotsPanel() {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("on_the_clock_draft_snapshots")
    .select(
      "sleeper_draft_id, sleeper_league_id, league_name, season, format_label, player_pool, draft_completed_at, finalized_at, value_snapshot_source, value_snapshot_date, adp_snapshot_source, adp_snapshot_date, adp_format_key, snapshot_confidence",
    )
    .order("finalized_at", { ascending: false })
    .limit(20);

  return (
    <section aria-labelledby="otc-snapshots-heading" className="mt-10">
      <h2 id="otc-snapshots-heading" className="text-lg font-semibold tracking-tight text-ink">
        Completed-draft snapshots
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        A completed draft opened in On The Clock locks its results into a snapshot on first open and
        renders in snapshot mode from then on (drafts not listed here render live). Each row shows
        which FF Beacon value date and Sleeper ADP date the draft was graded with and how those
        dates were chosen. To intentionally regrade a draft, delete its snapshot row in Supabase and
        reopen the draft.
      </p>

      {error ? (
        <p className="mt-4 rounded-card border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Could not load snapshots: {error.message}
        </p>
      ) : !rows || rows.length === 0 ? (
        <p className="mt-4 rounded-card border border-line bg-surface/50 px-3 py-3 text-sm text-ink-muted">
          No completed-draft snapshots exist yet. One is created the first time a finished draft is
          opened in the tool.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-card border border-line">
          <table className="w-max min-w-full border-collapse text-sm">
            <caption className="sr-only">
              The 20 most recently finalized completed-draft snapshots with their value and ADP
              provenance.
            </caption>
            <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  League / draft
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Finalized
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  FF Beacon values
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Sleeper ADP
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Confidence
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sleeper_draft_id} className="border-t border-line/60 align-top">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="block font-semibold text-ink">
                      {r.league_name || `League ${r.sleeper_league_id}`}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {r.season}, {r.format_label || "Unmatched format"},{" "}
                      {r.player_pool === "rookies" ? "Rookies only" : "All players"}
                    </span>
                    <span className="block font-mono text-[11px] text-ink-subtle">
                      draft {r.sleeper_draft_id}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    <span className="block">{formatEastern(r.finalized_at)}</span>
                    <span className="block text-ink-subtle">
                      Draft completed:{" "}
                      {r.draft_completed_at ? formatEastern(r.draft_completed_at) : "unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    <span className="block text-ink">
                      {r.value_snapshot_date ? formatEasternDate(r.value_snapshot_date) : "n/a"}
                    </span>
                    <span className="block text-ink-subtle">
                      {sourceLabel(r.value_snapshot_source)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    <span className="block text-ink">
                      {r.adp_snapshot_date
                        ? formatEasternDate(`${r.adp_snapshot_date}T12:00:00.000Z`)
                        : "n/a"}
                    </span>
                    <span className="block text-ink-subtle">
                      {sourceLabel(r.adp_snapshot_source)}
                      {r.adp_format_key ? `, market: ${r.adp_format_key}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        CONFIDENCE_CLASS[r.snapshot_confidence] ?? CONFIDENCE_CLASS.low
                      }`}
                    >
                      {r.snapshot_confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
