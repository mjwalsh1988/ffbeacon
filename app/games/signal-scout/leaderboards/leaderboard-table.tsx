import { ImageWithFallback } from "@/components/image-with-fallback";
import type {
  Board,
  LeaderboardRow,
  DailyBoardRow,
  AllTimeBoardRow,
  StreakBoardRow,
} from "@/lib/signal-scout/leaderboards";

const BOARD_CAPTION: Record<Board, string> = {
  daily: "Today's Top Scouts",
  all_time: "All-Time Signal",
  streak: "Longest Signal Streak",
};

const th = "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-3 text-sm";

function RankCell({ rank }: { rank: number }) {
  // Top 3 get a styled treatment but the plain number stays visible either way.
  const isTop3 = rank <= 3;
  return (
    <span
      className={
        isTop3
          ? "inline-flex min-w-6 items-center justify-center rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-1.5 py-0.5 text-xs font-bold text-brand-cyan"
          : "text-ink-muted"
      }
    >
      {rank}
    </span>
  );
}

function ScoutCell({
  scout,
  avatarUrl,
  isYou,
}: {
  scout: string;
  avatarUrl: string | null;
  isYou: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {/* alt="" is intentional: the display name renders as adjacent visible
          text right after the avatar, so the image is decorative. */}
      <ImageWithFallback src={avatarUrl} alt="" size={32} />
      <span className={isYou ? "font-semibold text-ink" : "text-ink"}>{scout}</span>
      {isYou && (
        <span className="inline-flex items-center rounded-full border border-brand-cyan/60 bg-brand-cyan/15 px-2 py-0.5 text-xs font-semibold text-brand-cyan">
          You
        </span>
      )}
    </div>
  );
}

function PercentCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span>
        <span aria-hidden="true">-</span>
        <span className="sr-only">no data</span>
      </span>
    );
  }
  return <span>{value}%</span>;
}

function rowClass(isYou: boolean): string {
  // The isYou row is marked by both the "You" pill (text) and this
  // background tint, never by color alone.
  return isYou ? "bg-brand-cyan/5" : "";
}

/**
 * Board table for /games/signal-scout/leaderboards. One semantic <table>
 * per board with a sr-only caption, th scope="col" headers, and columns per
 * plan section 8.
 *
 * MOBILE: no columns are ever hidden at any breakpoint. The table is wrapped
 * in a focusable overflow-x-auto region (tabIndex 0, role="region",
 * aria-label naming the board) so every column stays reachable by scroll on
 * narrow viewports, with tight cell padding so the 5-column daily board
 * usually fits without scrolling even at 375px.
 */
export function LeaderboardTable({
  board,
  page,
  rows,
}: {
  board: Board;
  page: number;
  rows: LeaderboardRow[];
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={`${BOARD_CAPTION[board]} leaderboard table, scrollable`}
      className="overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <table className="w-full min-w-[520px] border-collapse">
        <caption className="sr-only">
          {BOARD_CAPTION[board]} leaderboard, page {page}, listing rank, scout, and stats.
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>
              Rank
            </th>
            <th scope="col" className={th}>
              Scout
            </th>
            {board === "daily" && (
              <>
                <th scope="col" className={th}>
                  Points
                </th>
                <th scope="col" className={th}>
                  Rounds
                </th>
                <th scope="col" className={th}>
                  Accuracy
                </th>
              </>
            )}
            {board === "all_time" && (
              <>
                <th scope="col" className={th}>
                  Total points
                </th>
                <th scope="col" className={th}>
                  Wins
                </th>
                <th scope="col" className={th}>
                  Win rate
                </th>
                <th scope="col" className={th}>
                  Best streak
                </th>
              </>
            )}
            {board === "streak" && (
              <>
                <th scope="col" className={th}>
                  Best streak
                </th>
                <th scope="col" className={th}>
                  Current streak
                </th>
                <th scope="col" className={th}>
                  Total points
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {board === "daily" &&
            (rows as DailyBoardRow[]).map((row) => (
              <tr key={row.rank} className={`border-b border-line last:border-0 ${rowClass(row.isYou)}`}>
                <td className={td}>
                  <RankCell rank={row.rank} />
                </td>
                <td className={td}>
                  <ScoutCell scout={row.scout} avatarUrl={row.avatarUrl} isYou={row.isYou} />
                </td>
                <td className={`${td} text-ink`}>{row.points}</td>
                <td className={`${td} text-ink`}>{row.rounds}</td>
                <td className={`${td} text-ink`}>
                  <PercentCell value={row.accuracy} />
                </td>
              </tr>
            ))}
          {board === "all_time" &&
            (rows as AllTimeBoardRow[]).map((row) => (
              <tr key={row.rank} className={`border-b border-line last:border-0 ${rowClass(row.isYou)}`}>
                <td className={td}>
                  <RankCell rank={row.rank} />
                </td>
                <td className={td}>
                  <ScoutCell scout={row.scout} avatarUrl={row.avatarUrl} isYou={row.isYou} />
                </td>
                <td className={`${td} text-ink`}>{row.totalPoints}</td>
                <td className={`${td} text-ink`}>{row.wins}</td>
                <td className={`${td} text-ink`}>
                  <PercentCell value={row.winRate} />
                </td>
                <td className={`${td} text-ink`}>{row.bestStreak}</td>
              </tr>
            ))}
          {board === "streak" &&
            (rows as StreakBoardRow[]).map((row) => (
              <tr key={row.rank} className={`border-b border-line last:border-0 ${rowClass(row.isYou)}`}>
                <td className={td}>
                  <RankCell rank={row.rank} />
                </td>
                <td className={td}>
                  <ScoutCell scout={row.scout} avatarUrl={row.avatarUrl} isYou={row.isYou} />
                </td>
                <td className={`${td} text-ink`}>{row.bestStreak}</td>
                <td className={`${td} text-ink`}>{row.currentStreak}</td>
                <td className={`${td} text-ink`}>{row.totalPoints}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function statsFor(board: Board, row: LeaderboardRow): { label: string; value: string }[] {
  if (board === "daily") {
    const r = row as DailyBoardRow;
    return [
      { label: "Points", value: String(r.points) },
      { label: "Rounds", value: String(r.rounds) },
      { label: "Accuracy", value: r.accuracy === null ? "No data" : `${r.accuracy}%` },
    ];
  }
  if (board === "all_time") {
    const r = row as AllTimeBoardRow;
    return [
      { label: "Total points", value: String(r.totalPoints) },
      { label: "Wins", value: String(r.wins) },
      { label: "Win rate", value: r.winRate === null ? "No data" : `${r.winRate}%` },
      { label: "Best streak", value: String(r.bestStreak) },
    ];
  }
  const r = row as StreakBoardRow;
  return [
    { label: "Best streak", value: String(r.bestStreak) },
    { label: "Current streak", value: String(r.currentStreak) },
    { label: "Total points", value: String(r.totalPoints) },
  ];
}

/**
 * Pinned "your rank" card shown above the table when the caller has a row on
 * the current board. Reuses ScoutCell/RankCell so avatar, name, and the
 * "You" pill match the table rows exactly.
 */
export function YourRankStrip({ board, row }: { board: Board; row: LeaderboardRow }) {
  const stats = statsFor(board, row);
  return (
    <div
      role="group"
      aria-label="Your rank"
      className="mb-4 rounded-card border border-brand-cyan/50 bg-brand-cyan/5 p-4 shadow-[0_0_30px_-18px_rgba(34,211,238,0.9)]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-cyan">Your rank</p>
          <RankCell rank={row.rank} />
        </div>
        <ScoutCell scout={row.scout} avatarUrl={row.avatarUrl} isYou />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-ink-muted">{s.label}</dt>
            <dd className="text-sm font-semibold text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
