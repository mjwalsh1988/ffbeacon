"use client";

/**
 * Long Shot's player picker: the shared combobox wired to the Long Shot
 * search route (signed-in only, the Long Shot pool), with headshots and team
 * crests in every option. The chosen player is shown under it as text with
 * his face and crest, so a reader under the clock can confirm the pick.
 *
 * It is a typeahead, never a list: nothing appears until SEARCH_MIN_LENGTH
 * letters are typed (the route enforces the same floor), and at most eight
 * matches show. A reader has to think of the player; the picker only spares
 * them the spelling.
 */

import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerGuessCombobox, type SearchPlayerResult } from "@/components/player-guess-combobox";
import { PlayerHeadshot } from "@/components/player-headshot";
import { searchPlayers } from "@/lib/long-shot/client";
import { SEARCH_MIN_LENGTH } from "@/lib/long-shot/types";

export const PICKER_HELP_TEXT = `Type at least the first ${SEARCH_MIN_LENGTH} letters of a name. Choose one player, then press Answer.`;

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
        helpText={PICKER_HELP_TEXT}
        debounceMs={350}
        minLength={SEARCH_MIN_LENGTH}
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
