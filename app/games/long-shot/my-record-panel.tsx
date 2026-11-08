/**
 * My record (plan 12 and 18A.11): six big figures and the last seven days as
 * letter tiles. A day closed unfinished shows its letters, then a dash per
 * unanswered prompt, and says so in words.
 */

import { shortWeekday } from "@/lib/long-shot/dates";
import type { StatsDto } from "@/lib/long-shot/types";

function Figure({ value, unit, label }: { value: number; unit: string; label: string }) {
  return (
    <div>
      <p className="text-4xl font-black leading-none tracking-tight tabular-nums text-ink">
        {value}
        <span className="sr-only"> {unit}</span>
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
    </div>
  );
}

export function MyRecordPanel({ stats }: { stats: StatsDto | null }) {
  return (
    <section aria-labelledby="ls-my-record" className="rounded-[20px] border border-line bg-surface p-5 sm:p-6">
      <h2 id="ls-my-record" className="text-lg font-bold text-ink">
        My record
      </h2>
      {!stats ? (
        <p className="mt-3 text-sm text-ink-muted">Finish a Hurry-Up and your record starts here.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
            <Figure value={stats.daysPlayed} unit="days played" label="Days played" />
            <Figure value={stats.currentStreak} unit="day streak" label="Streak" />
            <Figure value={stats.bestStreak} unit="days, best streak" label="Best streak" />
            <Figure value={stats.totalPoints} unit="total points" label="Total points" />
            <Figure value={stats.bestDayPoints} unit="points, best day" label="Best day" />
            <Figure value={stats.longShots} unit="Long Shot answers" label="Long Shots" />
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            Lone Signals: <span className="font-mono font-bold tabular-nums text-ink">{stats.loneSignals}</span>
          </p>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">Last seven days</h3>
          <ol className="mt-3 grid grid-cols-7 gap-1.5">
            {stats.lastSeven.map((d) => (
              <li key={d.gameDate} className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-ink-subtle">{shortWeekday(d.gameDate)}</span>
                <span
                  className={`flex h-9 min-w-9 items-center justify-center rounded-lg border px-1 font-mono text-[11px] font-bold leading-tight tracking-tight ${
                    d.status === "completed"
                      ? "border-brand-cyan/50 text-ink"
                      : d.status === "abandoned"
                        ? "border-dashed border-line-accent text-ink-muted"
                        : "border-line text-ink-subtle"
                  }`}
                >
                  {d.status === "none" ? "-" : d.letters.join("")}
                  <span className="sr-only">
                    {d.status === "none"
                      ? ", not played"
                      : d.status === "abandoned"
                        ? ", closed unfinished"
                        : ", completed"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
