"use client";

import { useMemo } from "react";

export type TeamChipBarTeam = {
  rosterId: number;
  teamName: string;
  ownerSleeperUsername: string | null;
};

export type TeamChipBarProps = {
  teams: TeamChipBarTeam[];
  /** Sleeper roster_id -> overall power rank (1 = best). Unranked teams fall to the end. */
  overallRankByRoster: Record<number, number | null>;
  /** Roster IDs currently toggled on. */
  selectedRosterIds: ReadonlySet<number>;
  onToggleRoster: (rosterId: number) => void;
  onToggleAll: () => void;
};

/**
 * Visibility-filter chip bar. Clicking a chip toggles whether that team's
 * TeamCard is rendered in the list below (DPC behavior, not anchor-scroll).
 * Selected chips sort to the front so the active set stays in view without
 * scrolling. Each chip is a real button with aria-pressed reflecting state.
 */
export function TeamChipBar({
  teams,
  overallRankByRoster,
  selectedRosterIds,
  onToggleRoster,
  onToggleAll,
}: TeamChipBarProps) {
  const sorted = useMemo(() => {
    const fallback = Number.MAX_SAFE_INTEGER;
    return [...teams].sort((a, b) => {
      const aOn = selectedRosterIds.has(a.rosterId) ? 0 : 1;
      const bOn = selectedRosterIds.has(b.rosterId) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      const ra = overallRankByRoster[a.rosterId] ?? fallback;
      const rb = overallRankByRoster[b.rosterId] ?? fallback;
      if (ra !== rb) return ra - rb;
      return chipLabel(a).localeCompare(chipLabel(b));
    });
  }, [teams, overallRankByRoster, selectedRosterIds]);

  const totalCount = teams.length;
  const selectedCount = selectedRosterIds.size;
  const allOn = totalCount > 0 && selectedCount === totalCount;
  const noneOn = selectedCount === 0;

  return (
    <div className="relative -mx-1 px-1" role="group" aria-label="Toggle team visibility">
      <div className="flex flex-wrap items-center gap-2 pb-2 pt-1">
        <button
          type="button"
          onClick={onToggleAll}
          aria-pressed={allOn}
          aria-label={
            allOn
              ? `Hide all teams. Currently showing ${selectedCount} of ${totalCount}.`
              : `Show all teams. Currently showing ${selectedCount} of ${totalCount}.`
          }
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${chipClass(allOn)}`}
        >
          <span aria-hidden="true">{allOn ? "✓" : noneOn ? "○" : "◐"}</span>
          <span>Show all</span>
          <span className="font-mono text-[10px] tabular-nums opacity-80">
            {selectedCount}/{totalCount}
          </span>
        </button>

        {sorted.map((t) => {
          const rank = overallRankByRoster[t.rosterId];
          const isOn = selectedRosterIds.has(t.rosterId);
          const label = chipLabel(t);
          const ariaState = isOn ? "visible" : "hidden";
          const ariaRank = rank != null ? `, ranked #${rank}` : "";
          return (
            <button
              key={t.rosterId}
              type="button"
              onClick={() => onToggleRoster(t.rosterId)}
              aria-pressed={isOn}
              aria-label={`${t.teamName}${ariaRank}, ${ariaState}. Toggle to ${isOn ? "hide" : "show"} this team.`}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${chipClass(isOn)}`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full border px-1.5 font-mono text-[10px] font-bold tabular-nums ${
                  isOn
                    ? "border-brand-purple/40 bg-brand-purple/15 text-brand-purple"
                    : "border-line bg-base text-ink-subtle"
                }`}
              >
                {rank != null ? `#${rank}` : "—"}
              </span>
              <span className="max-w-[10rem] truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return active
    ? "border-brand-purple bg-brand-purple/15 text-ink hover:bg-brand-purple/25"
    : "border-line bg-surface text-ink-muted hover:border-brand-cyan hover:text-ink";
}

function chipLabel(t: TeamChipBarTeam): string {
  if (t.ownerSleeperUsername && t.ownerSleeperUsername.trim()) {
    return `@${t.ownerSleeperUsername}`;
  }
  return t.teamName;
}
