"use client";

/**
 * Long Shot's player picker: the shared combobox wired to the Long Shot
 * search route (signed-in only, the Long Shot pool), with headshots and team
 * crests in every option. The chosen player is shown under it as text with
 * his face and crest, so a reader under the clock can confirm the pick.
 */

import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerGuessCombobox, type SearchPlayerResult } from "@/components/player-guess-combobox";
import { PlayerHeadshot } from "@/components/player-headshot";
import { searchPlayers } from "@/lib/long-shot/client";

export function LongShotPlayerCombobox({
  disabled,
  chosen,
  onChoose,
}: {
  disabled: boolean;
  chosen: SearchPlayerResult | null;
  onChoose: (player: SearchPlayerResult | null) => void;
}) {
  return (
    <div>
      <PlayerGuessCombobox
        disabled={disabled}
        ruledOutIds={[]}
        label="Choose a player"
        helpText="Type a name. Choose one player, then press Answer."
        debounceMs={350}
        minLength={2}
        showTeamLogos
        search={searchPlayers}
        onSelect={(p) => onChoose(p)}
      />
      <p className="mt-3 flex min-h-11 items-center gap-3 text-sm text-ink-muted" aria-live="off">
        {chosen ? (
          <>
            <PlayerHeadshot sleeperId={chosen.sleeperId} name="" size={36} />
            {chosen.team && <NflTeamLogo team={chosen.team} size={18} />}
            <span>
              Your pick: <span className="font-semibold text-ink">{chosen.name}</span>
              {chosen.position ? `, ${chosen.position}` : ""}
              {chosen.team ? `, ${chosen.team}` : ""}
            </span>
          </>
        ) : (
          <span>No player chosen yet.</span>
        )}
      </p>
    </div>
  );
}
