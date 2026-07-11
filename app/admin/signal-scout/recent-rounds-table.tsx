import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserIdentities } from "@/lib/user-identity";
import { formatEastern, formatRelative } from "@/lib/datetime";
import { Pager } from "@/components/admin/pager";

const PAGE_SIZE = 15;

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  won: "Won",
  solved_late: "Solved late",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  active: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan",
  won: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  solved_late: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  failed: "border-red-500/40 bg-red-500/10 text-red-300",
  skipped: "border-line bg-surface/40 text-ink-subtle",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        STATUS_BADGE_CLASS[status] ?? STATUS_BADGE_CLASS.skipped
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * Most recent Signal Scout rounds, paginated. Owns its own count + range
 * query and both identity resolutions (round owner, target player) so it
 * stays self-contained, matching the DraftSnapshotsPanel colocated-panel
 * pattern used elsewhere in /admin.
 */
export async function RecentRoundsTable({ page }: { page: number }) {
  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("signal_scout_rounds")
    .select("id", { count: "exact", head: true });

  if (countError) {
    console.error("[signal-scout-admin] recent rounds count failed", countError);
    return <ErrorBox message="Could not load recent rounds." />;
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: rows, error } = await admin
    .from("signal_scout_rounds")
    .select(
      "id, user_id, guest_id, target_player_id, status, score_awarded, hints_used, wrong_guess_count, burned_out_at, started_at",
    )
    .order("started_at", { ascending: false })
    .range(from, to);

  if (error) {
    console.error("[signal-scout-admin] recent rounds query failed", error);
    return <ErrorBox message="Could not load recent rounds." />;
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
        No Signal Scout rounds have been played yet.
      </p>
    );
  }

  const userIds = [...new Set(rows.filter((r) => r.user_id).map((r) => r.user_id as string))];
  const identities = await resolveUserIdentities(admin, userIds, "private");

  const playerIds = [...new Set(rows.map((r) => r.target_player_id))];
  const { data: players } = playerIds.length
    ? await admin.from("players").select("id, full_name, first_name, last_name, position").in("id", playerIds)
    : { data: [] };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  const nowMs = Date.now();

  return (
    <>
      <div
        tabIndex={0}
        role="region"
        aria-label="Recent Signal Scout rounds table, scrollable"
        className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <table className="w-max min-w-full border-collapse text-sm">
          <caption className="sr-only">
            Most recent Signal Scout rounds, newest first, page {currentPage} of {totalPages}.
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Started
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Scout
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Target player
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Score awarded
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Hints
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Bad reads
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Burned
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((round) => {
              const player = playerById.get(round.target_player_id);
              const playerName = player?.full_name || `${player?.first_name ?? ""} ${player?.last_name ?? ""}`.trim() || "Unknown player";
              const scout = round.user_id
                ? (identities.get(round.user_id)?.displayName ?? "Unknown scout")
                : round.guest_id
                  ? `Guest ${round.guest_id.slice(0, 8)}`
                  : "Unknown scout";
              return (
                <tr key={round.id} className="border-t border-line/60 align-top">
                  <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
                    <span title={formatEastern(round.started_at)}>
                      {formatRelative(round.started_at, nowMs)}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-ink">
                    {round.guest_id && !round.user_id ? (
                      <span className="font-mono text-xs">{scout}</span>
                    ) : (
                      scout
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink">
                    {playerName}
                    {player?.position ? (
                      <span className="ml-1.5 text-xs text-ink-subtle">{player.position}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={round.status} />
                  </td>
                  <td className="px-3 py-2 text-ink">{round.score_awarded}</td>
                  <td className="px-3 py-2 text-ink">{round.hints_used}</td>
                  <td className="px-3 py-2 text-ink">{round.wrong_guess_count}</td>
                  <td className="px-3 py-2 text-ink-muted">{round.burned_out_at ? "Yes" : "No"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager
        basePath="/admin/signal-scout"
        paramName="roundsPage"
        currentPage={currentPage}
        totalPages={totalPages}
        label="Recent rounds pages"
        hash="recent-rounds"
      />
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
      {message}
    </p>
  );
}
