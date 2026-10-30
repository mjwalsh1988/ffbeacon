"use client";

/**
 * The team picker: one native select of every roster, each option reading
 * "Team name (6-2)" so the record lives in the text rather than in a tint.
 *
 * Extracted from LineupControls (components/league-lineups/lineup-controls.tsx)
 * so the Team Blueprint controls bar uses the identical control. The label is
 * sr-only by default because each option already says what the control is
 * for; `visibleLabel` shows it for a bar where the select stands alone.
 */

import { recordLabel } from "@/components/league-schedule/format";
import type { LineupTeamOption } from "@/lib/league-lineups/types";

export const CONTROL =
  "min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function RosterSelect({
  id,
  rosterId,
  teams,
  onChange,
  visibleLabel = false,
  label = "Team",
}: {
  id: string;
  rosterId: number;
  teams: LineupTeamOption[];
  onChange: (rosterId: number) => void;
  visibleLabel?: boolean;
  label?: string;
}) {
  return (
    <>
      <label
        htmlFor={id}
        className={visibleLabel ? "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle" : "sr-only"}
      >
        {label}
      </label>
      <select
        id={id}
        value={rosterId}
        onChange={(event) => onChange(Number(event.target.value))}
        className={CONTROL}
      >
        {teams.map((team) => (
          <option key={team.sleeperRosterId} value={team.sleeperRosterId}>
            {team.teamName} ({recordLabel(team.record)})
          </option>
        ))}
      </select>
    </>
  );
}
