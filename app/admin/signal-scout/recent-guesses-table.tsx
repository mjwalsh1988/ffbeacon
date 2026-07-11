import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern, formatRelative } from "@/lib/datetime";
import { Pager } from "@/components/admin/pager";

const PAGE_SIZE = 15;

/**
 * Most recent Signal Scout guesses, paginated. Owns its own count + range
 * query and the target player-name resolution, matching the
 * DraftSnapshotsPanel colocated-panel pattern used elsewhere in /admin.
 */
export async function RecentGuessesTable({ page }: { page: number }) {
  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("signal_scout_guesses")
    .select("round_id", { count: "exact", head: true });

  if (countError) {
    console.error("[signal-scout-admin] recent guesses count failed", countError);
    return <ErrorBox message="Could not load recent guesses." />;
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: rows, error } = await admin
    .from("signal_scout_guesses")
    .select("round_id, guessed_player_id, is_correct, guess_number, created_at")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    console.error("[signal-scout-admin] recent guesses query failed", error);
    return <ErrorBox message="Could not load recent guesses." />;
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
        No guesses have been made yet.
      </p>
    );
  }

  const playerIds = [...new Set(rows.map((r) => r.guessed_player_id))];
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
        aria-label="Recent Signal Scout guesses table, scrollable"
        className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <table className="w-max min-w-full border-collapse text-sm">
          <caption className="sr-only">
            Most recent Signal Scout guesses, newest first, page {currentPage} of {totalPages}.
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Time
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Guessed player
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Correct
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Guess number
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Round id
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((guess, index) => {
              const player = playerById.get(guess.guessed_player_id);
              const playerName = player?.full_name || `${player?.first_name ?? ""} ${player?.last_name ?? ""}`.trim() || "Unknown player";
              return (
                <tr key={`${guess.round_id}-${guess.guess_number}-${index}`} className="border-t border-line/60 align-top">
                  <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
                    <span title={formatEastern(guess.created_at)}>
                      {formatRelative(guess.created_at, nowMs)}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-ink">
                    {playerName}
                    {player?.position ? (
                      <span className="ml-1.5 text-xs text-ink-subtle">{player.position}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-ink">{guess.is_correct ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-ink">{guess.guess_number}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-subtle" title={guess.round_id}>
                    <span aria-hidden="true">{guess.round_id.slice(0, 8)}</span>
                    <span className="sr-only">{guess.round_id}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager
        basePath="/admin/signal-scout"
        paramName="guessesPage"
        currentPage={currentPage}
        totalPages={totalPages}
        label="Recent guesses pages"
        hash="recent-guesses"
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
