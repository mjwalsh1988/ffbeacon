import type { ReactNode } from "react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserIdentities } from "@/lib/user-identity";
import { formatEastern, formatRelative } from "@/lib/datetime";

const RECENT_ROUNDS_LIMIT = 10;

/** Mirrors STATUS_LABEL/STATUS_BADGE_CLASS in
 * app/admin/signal-scout/recent-rounds-table.tsx (not exported there). */
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

type UserStatsDetailRow = {
  user_id: string;
  total_points: number;
  rounds_played: number;
  rounds_won: number;
  rounds_solved_late: number;
  rounds_failed: number;
  rounds_skipped: number;
  rounds_burned: number;
  total_hints: number;
  total_wrong_guesses: number;
  current_signal_streak: number;
  best_signal_streak: number;
  current_daily_streak: number;
  best_daily_streak: number;
  last_played_date: string | null;
  first_played_at: string;
  updated_at: string;
  hidden_from_leaderboards: boolean;
  hidden_reason: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
};

type RecentRound = {
  id: string;
  target_player_id: string;
  status: string;
  score_awarded: number;
  hints_used: number;
  started_at: string;
};

function fmtCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function rateLabel(numerator: number, denominator: number): { text: string; srOnly?: string } {
  if (denominator <= 0) return { text: "-", srOnly: "no data" };
  return { text: `${((numerator / denominator) * 100).toFixed(1)}%` };
}

async function loadUserStats(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<UserStatsDetailRow | null> {
  const { data, error } = await admin
    .from("signal_scout_user_stats")
    .select(
      "user_id, total_points, rounds_played, rounds_won, rounds_solved_late, rounds_failed, rounds_skipped, rounds_burned, total_hints, total_wrong_guesses, current_signal_streak, best_signal_streak, current_daily_streak, best_daily_streak, last_played_date, first_played_at, updated_at, hidden_from_leaderboards, hidden_reason, hidden_at, hidden_by",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[signal-scout-admin] user detail stats lookup failed", error);
    return null;
  }
  return data;
}

function StatItem({ label, value, srOnly }: { label: string; value: ReactNode; srOnly?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">
        {value}
        {srOnly ? <span className="sr-only"> ({srOnly})</span> : null}
      </dd>
    </div>
  );
}

/**
 * Per-user activity and moderation detail for the Signal Scout Users admin
 * page (SS-T039), modeled on
 * app/admin/signal-scout/players/player-detail-panel.tsx: a stats dl grid,
 * the full moderation state, and the 10 most recent rounds.
 *
 * IDENTITY RESOLUTION: this panel runs its own scoped resolveUserIdentities
 * call for [userId, hidden_by] rather than reusing the page's batched call
 * over the current page's rows. The selected user may not even be on the
 * currently loaded page (they are reached by id, not by scrolling to them),
 * so the page-level batch cannot be relied on to already contain them. This
 * mirrors PlayerDetailPanel's own updated_by resolution (player-detail-panel.tsx),
 * which makes the same one-extra-query tradeoff for the same reason: the
 * detail panel only renders at all when a specific id is selected, so it
 * stays a small, self-contained subtree.
 */
export async function UserDetailPanel({ userId }: { userId: string }) {
  const admin = createAdminClient();

  const stats = await loadUserStats(admin, userId);
  if (!stats) {
    return (
      <section
        aria-labelledby="user-detail-heading"
        className="rounded-card border border-line bg-surface/40 p-6"
      >
        <h2 id="user-detail-heading" className="text-lg font-semibold text-ink">
          User not found
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          No Signal Scout record matches that user id.{" "}
          <Link href="/admin/signal-scout/users" className="text-brand-cyan underline underline-offset-2">
            Back to the full list
          </Link>
          .
        </p>
      </section>
    );
  }

  const identityIds = stats.hidden_by ? [userId, stats.hidden_by] : [userId];
  const identities = await resolveUserIdentities(admin, identityIds, "private");
  const displayName = identities.get(userId)?.displayName ?? "Unknown scout";
  const hiddenByName = stats.hidden_by
    ? (identities.get(stats.hidden_by)?.displayName ?? "Unknown admin")
    : null;

  const { data: roundsData, error: roundsError } = await admin
    .from("signal_scout_rounds")
    .select("id, target_player_id, status, score_awarded, hints_used, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(RECENT_ROUNDS_LIMIT);
  if (roundsError) {
    console.error("[signal-scout-admin] user detail rounds query failed", roundsError);
  }
  const rounds: RecentRound[] = roundsData ?? [];

  const playerIds = [...new Set(rounds.map((r) => r.target_player_id))];
  const { data: playersData, error: playersError } = playerIds.length
    ? await admin
        .from("players")
        .select("id, full_name, first_name, last_name, position")
        .in("id", playerIds)
    : { data: [], error: null };
  if (playersError) {
    console.error("[signal-scout-admin] user detail target players query failed", playersError);
  }
  const playerById = new Map((playersData ?? []).map((p) => [p.id, p]));

  const nowMs = Date.now();
  const winRate = rateLabel(stats.rounds_won, stats.rounds_played);
  const burnRate = rateLabel(stats.rounds_burned, stats.rounds_played);

  return (
    <section
      aria-labelledby="user-detail-heading"
      className="rounded-card border border-line bg-surface/40 p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="user-detail-heading" className="text-lg font-semibold text-ink">
            {displayName}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Hidden from leaderboards:{" "}
            <span className="font-semibold text-ink">
              {stats.hidden_from_leaderboards ? "Yes" : "No"}
            </span>
          </p>
        </div>
        <Link
          href="/admin/signal-scout/users"
          className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Close detail
        </Link>
      </div>

      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Stats</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-line bg-surface/60 p-3 sm:grid-cols-3">
        <StatItem label="Total points" value={fmtCount(stats.total_points)} />
        <StatItem label="Rounds played" value={fmtCount(stats.rounds_played)} />
        <StatItem label="Wins" value={fmtCount(stats.rounds_won)} />
        <StatItem label="Win rate" value={winRate.text} srOnly={winRate.srOnly} />
        <StatItem label="Solved late" value={fmtCount(stats.rounds_solved_late)} />
        <StatItem label="Failed" value={fmtCount(stats.rounds_failed)} />
        <StatItem label="Skipped" value={fmtCount(stats.rounds_skipped)} />
        <StatItem label="Burned" value={fmtCount(stats.rounds_burned)} />
        <StatItem label="Burn rate" value={burnRate.text} srOnly={burnRate.srOnly} />
        <StatItem label="Hints used" value={fmtCount(stats.total_hints)} />
        <StatItem label="Wrong guesses" value={fmtCount(stats.total_wrong_guesses)} />
        <StatItem label="Current signal streak" value={fmtCount(stats.current_signal_streak)} />
        <StatItem label="Best signal streak" value={fmtCount(stats.best_signal_streak)} />
        <StatItem label="Current daily streak" value={fmtCount(stats.current_daily_streak)} />
        <StatItem label="Best daily streak" value={fmtCount(stats.best_daily_streak)} />
        <StatItem
          label="Last played"
          value={stats.last_played_date ?? "-"}
          srOnly={stats.last_played_date ? undefined : "no data"}
        />
        <StatItem
          label="First played"
          value={
            <span title={formatEastern(stats.first_played_at)}>
              {formatRelative(stats.first_played_at, nowMs)}
            </span>
          }
        />
        <StatItem
          label="Last updated"
          value={
            <span title={formatEastern(stats.updated_at)}>{formatRelative(stats.updated_at, nowMs)}</span>
          }
        />
      </dl>

      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Moderation</h3>
      <div className="mt-2 rounded-card border border-line bg-surface/60 p-3 text-sm text-ink-muted">
        <p>
          Hidden:{" "}
          <span className="font-semibold text-ink">{stats.hidden_from_leaderboards ? "Yes" : "No"}</span>
        </p>
        {stats.hidden_from_leaderboards ? (
          <>
            <p className="mt-1">
              Reason: {stats.hidden_reason && stats.hidden_reason.trim() ? stats.hidden_reason : "(none)"}
            </p>
            <p className="mt-1">
              Hidden by {hiddenByName ?? "Unknown admin"}
              {stats.hidden_at ? (
                <>
                  ,{" "}
                  <span title={formatEastern(stats.hidden_at)}>{formatRelative(stats.hidden_at, nowMs)}</span>
                </>
              ) : null}
            </p>
          </>
        ) : null}
      </div>

      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Recent rounds
      </h3>
      {rounds.length === 0 ? (
        <p className="mt-2 rounded-card border border-line bg-surface/60 p-3 text-sm text-ink-muted">
          No rounds played yet.
        </p>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label={`Recent rounds for ${displayName}, scrollable`}
          className="mt-2 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <table className="w-max min-w-full border-collapse text-sm">
            <caption className="sr-only">
              {displayName}'s {rounds.length} most recent Signal Scout rounds, newest first.
            </caption>
            <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Started
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
              </tr>
            </thead>
            <tbody>
              {rounds.map((round) => {
                const player = playerById.get(round.target_player_id);
                const playerName =
                  player?.full_name ||
                  `${player?.first_name ?? ""} ${player?.last_name ?? ""}`.trim() ||
                  "Unknown player";
                return (
                  <tr key={round.id} className="border-t border-line/60 align-top">
                    <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
                      <span title={formatEastern(round.started_at)}>
                        {formatRelative(round.started_at, nowMs)}
                      </span>
                    </th>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
