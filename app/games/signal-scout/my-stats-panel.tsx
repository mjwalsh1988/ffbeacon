import { Target } from "lucide-react";
import { StatReadout } from "@/components/dashboard-panel";
import type { MyScoutStats } from "./signal-scout-client";

/**
 * "My Scout Record" stats panel (plan signal-scout-plan.md section 3).
 *
 * It lives in the RAIL now, above the leaderboards, rather than beside the
 * start button in the game column. Your own record and everyone else's are the
 * same kind of thing, so they belong together, and the game column is left for
 * the game.
 *
 * Server-safe presentational component: renders straight from the stats the
 * server page resolves from signal_scout_user_stats, so it carries no
 * "use client" of its own.
 *
 * RENDERED TWICE, like the How It Works explainer beneath it: once in the rail
 * and once in the slide-up sheet, both in the DOM at the same time whenever the
 * sheet is open. The heading id therefore cannot be hardcoded, and every caller
 * passes its own.
 *
 * Win rate math matches plan section 8: rounds_won / rounds_played, with
 * solved-too-late rounds counted in the denominator only (they are already
 * included in roundsPlayed, so no separate handling is needed here).
 */
export function MyStatsPanel({
  stats,
  headingId = "signal-scout-my-stats-heading",
}: {
  stats: MyScoutStats;
  /** Unique per rendered copy. See the RENDERED TWICE note above. */
  headingId?: string;
}) {
  const winRate =
    stats.roundsPlayed === 0
      ? null
      : Math.round((stats.roundsWon / stats.roundsPlayed) * 1000) / 10;

  return (
    <section
      aria-labelledby={headingId}
      className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-4"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
        >
          <Target className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Your record
          </p>
          <h3 id={headingId} className="text-sm font-semibold tracking-tight text-ink">
            My Scout Record
          </h3>
        </div>
      </div>

      <dl aria-label="Your Signal Scout stats" className="mt-3 grid grid-cols-2 gap-2">
        <StatReadout
          label="Total points"
          value={stats.totalPoints.toLocaleString("en-US")}
          accent="cyan"
        />
        <StatReadout label="Rounds played" value={String(stats.roundsPlayed)} accent="ink" />
        <StatReadout label="Wins" value={String(stats.roundsWon)} accent="purple" />
        <WinRateTile winRate={winRate} />
        <StatReadout
          label="Best Signal Streak"
          value={String(stats.bestSignalStreak)}
          accent="purple"
        />
        <StatReadout
          label="Best Daily Scout Streak"
          value={String(stats.bestDailyStreak)}
          accent="cyan"
        />
      </dl>

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-subtle">
        {stats.roundsSolvedLate} solved late, {stats.roundsFailed} failed, {stats.roundsSkipped} skipped
      </p>
    </section>
  );
}

function WinRateTile({ winRate }: { winRate: number | null }) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Win rate</dt>
      {winRate === null ? (
        <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ink-muted">
          <span aria-hidden="true">-</span>
          <span className="sr-only">no data</span>
        </dd>
      ) : (
        <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ink">{winRate}%</dd>
      )}
    </div>
  );
}
