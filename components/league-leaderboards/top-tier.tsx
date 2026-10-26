/**
 * Who holds the most top players: for each position, the top X scorers where
 * X is the number of teams times that position's own starting slots (12 teams
 * starting 2 running backs makes the top 24). Flex slots are left out on
 * purpose, because a flex slot belongs to no single position.
 *
 * Counted on today's rosters, because the question is "who has them", and the
 * points that rank them are the points in scope.
 *
 * Each team is one row: the total in large type, a bar for its share of the
 * best total, and one chip per position that names the count in words.
 */

import { positionNoun } from "@/lib/site";
import type {
  LeaderboardTeam,
  TopTierCutoff,
  TopTierRow,
} from "@/lib/league-leaderboards/types";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { PosChip } from "./bits";
import { LIST_CLASS, RankMark } from "./leader-row";

export function TopTier({
  cutoffs,
  rows,
  teams,
  viewerRosterId,
}: {
  cutoffs: TopTierCutoff[];
  rows: TopTierRow[];
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
}) {
  if (cutoffs.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        This league has no starting slot that takes one position only, so there is no cut line to count against.
      </p>
    );
  }
  const best = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div>
      <ul role="list" aria-label="The cut line at each position" className="flex flex-wrap gap-1.5">
        {cutoffs.map((c) => (
          <li
            key={c.position}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base/50 py-0.5 pl-1 pr-2.5 text-[11px] text-ink-muted"
          >
            <PosChip position={c.position} />
            <span className="font-semibold text-ink">Top {c.cutoff}</span>
            <span className="sr-only">
              {`: ${c.slots} ${positionNoun(c.position)} ${c.slots === 1 ? "slot" : "slots"} times ${c.cutoff / c.slots} teams`}
            </span>
            {c.unowned > 0 && (
              <span className="text-ink-subtle">
                <span aria-hidden="true">(</span>
                <span className="sr-only">, </span>
                {c.unowned}
                <span aria-hidden="true"> FA)</span>
                <span className="sr-only"> of them on no roster</span>
              </span>
            )}
          </li>
        ))}
      </ul>

      <ol role="list" aria-label="Teams by top players held" className={`mt-3 ${LIST_CLASS}`}>
        {rows.map((row) => {
          const team = teams[row.rosterId];
          if (!team) return null;
          const mine = viewerRosterId !== null && row.rosterId === viewerRosterId;
          const width = `${Math.round((row.total / best) * 100)}%`;
          return (
            <li
              key={row.rosterId}
              className={`flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 ${
                mine ? "bg-brand-cyan/[0.06] shadow-[inset_3px_0_0_0_rgba(34,211,238,0.8)]" : ""
              }`}
            >
              <RankMark rank={row.rank} />
              <SleeperAvatar avatarId={team.avatarId} title="" size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  <span className="min-w-0 break-words">{team.teamName}</span>
                  {mine && (
                    <span className="shrink-0 rounded-full bg-brand-cyan/20 px-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-brand-cyan">
                      Your team
                    </span>
                  )}
                </p>
                <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
                  <span className="block h-full rounded-full bg-beacon" style={{ width }} />
                </span>
                <ul role="list" className="mt-1.5 flex flex-wrap gap-1">
                  {cutoffs.map((c) => {
                    const n = row.byPosition[c.position] ?? 0;
                    return (
                      <li
                        key={c.position}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                          n > 0 ? "bg-ink/[0.07] text-ink" : "text-ink-subtle"
                        }`}
                      >
                        {/* The count is the one real text node; the code is
                            swapped for the word, which follows it when spoken. */}
                        <span aria-hidden="true">{c.position} </span>
                        {n}
                        <span className="sr-only">{` ${positionNoun(c.position, n === 1 ? undefined : "plural")} in the top ${c.cutoff}`}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <p className="shrink-0 text-right font-mono text-2xl font-black tabular-nums text-ink">
                {row.total}
                <span className="sr-only"> top players in all</span>
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
