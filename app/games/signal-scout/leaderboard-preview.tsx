import Link from "next/link";
import { Zap } from "lucide-react";
import { ImageWithFallback } from "@/components/image-with-fallback";
import type { DailyBoardRow } from "@/lib/signal-scout/leaderboards";

/**
 * "Today's Top Scouts" preview panel on the Signal Scout game page (plan
 * signal-scout-plan.md sections 3 and 21). Compact top-5 daily board plus a
 * link to the full leaderboards page. Server-safe presentational component:
 * it renders straight from the plain props the server page resolves via
 * loadLeaderboardPreview, so it carries no "use client" of its own.
 *
 * The rank/scout cell styling is a small local copy of RankCell/ScoutCell
 * from app/games/signal-scout/leaderboards/leaderboard-table.tsx rather than
 * an import, since that module stays page-local to the leaderboards route.
 *
 * `rows` is null when the daily board is disabled in admin settings (the
 * whole panel does not render in that case, handled by the caller); an
 * empty array means the board is enabled but has no scores yet today.
 */
export function LeaderboardPreview({
  rows,
  requireLogin,
  viewerSignedIn,
}: {
  rows: DailyBoardRow[];
  requireLogin: boolean;
  viewerSignedIn: boolean;
}) {
  const showTeaser = requireLogin && !viewerSignedIn;

  return (
    <section
      aria-labelledby="signal-scout-leaderboard-preview-heading"
      className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
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
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
        >
          <Zap className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Daily board
          </p>
          <h3 id="signal-scout-leaderboard-preview-heading" className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            Today's Top Scouts
          </h3>
        </div>
      </div>

      {showTeaser ? (
        <>
          <p className="mt-4 text-sm text-ink-muted">
            Scouts are competing on today's board right now. Create a free account to see the
            leaderboards and claim your rank.
          </p>
          <Link
            href="/login"
            className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Create a free account
          </Link>
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              No scouts on the board yet today. Be the first to decode a signal.
            </p>
          ) : (
            <ol className="mt-4 space-y-1">
              {rows.map((row) => (
                <PreviewRow key={row.rank} row={row} />
              ))}
            </ol>
          )}
          <Link
            href="/games/signal-scout/leaderboards"
            className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            View all leaderboards
          </Link>
        </>
      )}
    </section>
  );
}

function PreviewRow({ row }: { row: DailyBoardRow }) {
  const isTop3 = row.rank <= 3;
  return (
    <li
      className={`flex items-center gap-3 rounded-card px-2 py-1.5 ${row.isYou ? "bg-brand-cyan/5" : ""}`}
    >
      <span
        className={
          isTop3
            ? "inline-flex min-w-6 items-center justify-center rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-1.5 py-0.5 text-xs font-bold text-brand-cyan"
            : "inline-flex min-w-6 items-center justify-center text-xs text-ink-muted"
        }
      >
        {row.rank}
      </span>
      {/* alt="" is intentional: the display name renders as adjacent visible
          text right after the avatar, so the image is decorative. */}
      <ImageWithFallback src={row.avatarUrl} alt="" size={28} />
      <span className={`min-w-0 flex-1 truncate text-sm ${row.isYou ? "font-semibold text-ink" : "text-ink"}`}>
        {row.scout}
      </span>
      {row.isYou && (
        <span className="inline-flex items-center rounded-full border border-brand-cyan/60 bg-brand-cyan/15 px-2 py-0.5 text-xs font-semibold text-brand-cyan">
          You
        </span>
      )}
      <span className="shrink-0 text-sm font-semibold text-ink">
        {row.points} <span className="font-normal text-ink-muted">pts</span>
      </span>
    </li>
  );
}
