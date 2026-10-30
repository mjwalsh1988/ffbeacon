"use client";

/**
 * Which team's blueprint (plan 9.2). The roster select shared with the Lineups
 * bar (components/league-lineups/roster-select.tsx), in the same sticky bar
 * at the deep view's top offset. Changing it pushes ?roster=N, carrying the
 * reader's username the way every league link does. The source is the
 * header's existing toggle.
 *
 * The announcement starts empty and fills only inside the change handler, for
 * the reason components/league-lineups/lineup-controls.tsx gives.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HAIRLINE_STYLE, withUsername } from "@/components/league-schedule/format";
import { RosterSelect } from "@/components/league-lineups/roster-select";
import type { LineupTeamOption } from "@/lib/league-lineups/types";

export function BlueprintControls({
  sleeperLeagueId,
  linkUsername,
  rosterId,
  teams,
}: {
  sleeperLeagueId: string;
  linkUsername: string | null;
  rosterId: number;
  teams: LineupTeamOption[];
}) {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");

  const goTeam = (target: number) => {
    router.push(withUsername(`/leagues/${sleeperLeagueId}/blueprint?roster=${target}`, linkUsername));
    const team = teams.find((t) => t.sleeperRosterId === target);
    setAnnouncement(`Loading the blueprint for ${team ? team.teamName : "the selected team"}.`);
  };

  return (
    <div className="sticky top-[5.5rem] z-20 overflow-hidden rounded-modal border border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px" style={HAIRLINE_STYLE} />
      <div className="px-3 py-2 sm:px-4">
        <div className="sm:max-w-md">
          <RosterSelect
            id="blueprint-team-select"
            rosterId={rosterId}
            teams={teams}
            onChange={goTeam}
            label="Team"
          />
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
