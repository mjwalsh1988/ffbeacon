"use client";

/**
 * Signal Scout's guess combobox: a thin wrapper over the shared
 * components/player-guess-combobox.tsx (extracted for Long Shot, plan 18.3).
 *
 * ANTI-CHEAT NOTE: /api/games/signal-scout/search is round-independent
 * public player data, safe to call before or during any round.
 *
 * The search route enforces a roughly 1-second minimum interval per
 * identity, so the debounce is 1000ms. A 429 (rate_limited) holds the last
 * good results on screen instead of clearing them or surfacing an error.
 */

import { useCallback } from "react";
import { PlayerGuessCombobox, type SearchOutcome } from "@/components/player-guess-combobox";
import { searchPlayers, type SearchPlayerResult } from "@/lib/signal-scout/client";

export interface GuessComboboxProps {
  disabled: boolean;
  ruledOutIds: string[];
  /**
   * The LIVE scoring.wrong_guess_penalty setting, display copy only (the
   * round's frozen snapshot governs the real deduction server-side).
   */
  wrongGuessPenalty: number;
  onSelect: (player: SearchPlayerResult) => void;
}

export function GuessCombobox({ disabled, ruledOutIds, wrongGuessPenalty, onSelect }: GuessComboboxProps) {
  const search = useCallback(async (q: string, signal: AbortSignal): Promise<SearchOutcome> => {
    const result = await searchPlayers(q, { signal });
    return result.ok ? { ok: true, results: result.data.results } : { ok: false, code: result.code };
  }, []);
  return (
    <PlayerGuessCombobox
      disabled={disabled}
      ruledOutIds={ruledOutIds}
      label="Name the player"
      helpText={`Type at least 2 characters to search. Guessing wrong costs ${wrongGuessPenalty} points.`}
      debounceMs={1000}
      minLength={2}
      showTeamLogos={false}
      search={search}
      onSelect={onSelect}
    />
  );
}
