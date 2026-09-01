"use client";

import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { PlayerPicker, type PlayerOption } from "@/components/player-picker";

/**
 * Name a PACKAGE rather than a player.
 *
 * The single-player pickers answered one question each: what would this player
 * cost, and what would he bring back. Managers do not think that way. They think
 * "I have two backs I do not need and I want a receiver", and the deal they are
 * actually looking for is the one where both backs leave together. Asking about
 * each one alone gets two answers, neither of which is the trade.
 *
 * So both sides take a list. Every player named on a side has to appear on that
 * side of the suggestion, which is what makes it a package and not a shortlist
 * of alternatives: three names is one question, not three.
 *
 * WHY THIS WRAPS PlayerPicker RATHER THAN REPLACING IT
 *   Everything hard about choosing one player out of six hundred, and everything
 *   that makes it work with a screen reader and on a phone, already lives in
 *   PlayerPicker: a filter box narrowing a real <select>, no custom listbox,
 *   platform typeahead, a live count. None of that changes because the answer is
 *   now a list. The picker becomes the ADD control, and the list it feeds is
 *   rendered here as removable chips.
 *
 *   The alternative, a `<select multiple>`, is the control this looks like and
 *   the one to avoid, for exactly the reasons PositionFilter states: on touch it
 *   is a scrolling box with no obvious way to pick two things, and by keyboard
 *   it needs modifier-click or ctrl-space, which nobody discovers.
 *
 * WHAT A CHOSEN PLAYER LEAVES BEHIND
 *   He drops out of the list on offer, so he cannot be added twice, and his chip
 *   carries a Remove button whose accessible name says which player it drops.
 *   Two Remove buttons in a row with the same name would be useless to a reader
 *   who cannot see which chip they sit on.
 *
 *   The exclusion is passed to PlayerPicker as a SET rather than by handing it a
 *   shorter array, because `options` keys an expensive normalization memo in
 *   there and a new array identity on every chip press throws it away. See
 *   `excludeIds` in that file.
 *
 * ANNOUNCEMENTS AND FOCUS
 *   Adding and removing are the only things that happen here, so both are
 *   spoken. The count rides along in the same sentence, because "how many have
 *   I picked" is the question the list answers and it is the one a reader
 *   cannot glance at.
 *
 *   Both transitions can destroy the element that has focus, and both are
 *   handled. Removing a chip destroys the button that was just pressed. Adding
 *   the LAST allowed player destroys the picker itself, because at the cap there
 *   is nothing left to add; that one is easy to miss, and it drops a reader who
 *   was working entirely by keyboard back to the top of the page. Focus is
 *   placed deliberately in every case: on the chip that took a removed one's
 *   place, on the last chip when the end of the list went, on the newly added
 *   chip when the add filled the package, and on the group's own summary line
 *   when nothing is left.
 */
export function PlayerPackagePicker({
  label,
  hint,
  filterLabel,
  addLabel,
  chipsLabel,
  emptyNote,
  options,
  selected,
  onChange,
  onAnnounce,
  max,
}: {
  /** The select's own label, describing what the list means. */
  label: string;
  /** One line under the label. What naming these players does to the search. */
  hint: string;
  /** Visible label for the filter box above the select. */
  filterLabel: string;
  /** The placeholder option, which is the invitation to add another. */
  addLabel: string;
  /**
   * Accessible name for the region holding the chosen players.
   *
   * Load-bearing, and not decoration: two of these sit side by side, and their
   * summary lines are word for word identical once each side holds a player
   * ("2 of 4 players picked."). Without a distinct name in front of it, a reader
   * moving between regions cannot tell the package they are receiving from the
   * one they are sending.
   */
  chipsLabel: string;
  /** Shown in place of the chips when nothing is chosen yet. */
  emptyNote: string;
  options: PlayerOption[];
  /** Player ids, in the order they were added. */
  selected: string[];
  onChange: (playerIds: string[]) => void;
  /**
   * Say something out loud. Routed to the parent's one live region rather than
   * given a second one here: two polite regions on a page queue against each
   * other, and this control sits beside a Search button that already speaks.
   */
  onAnnounce: (message: string) => void;
  /** How many players may be named on this side. */
  max: number;
}) {
  const baseId = useId();
  const chipsId = `${baseId}-chips`;
  const groupNameId = `${baseId}-group`;

  /** The Remove buttons, so focus can be placed after one of them disappears. */
  const removeRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const summaryRef = useRef<HTMLParagraphElement>(null);
  /**
   * Where focus should land on the render AFTER a change.
   *
   * A player id names a chip's Remove button. The empty string means the summary
   * line. Null means leave focus alone, which is the ordinary add.
   */
  const focusAfterChange = useRef<string | null>(null);

  useEffect(() => {
    const wanted = focusAfterChange.current;
    if (wanted === null) return;
    focusAfterChange.current = null;
    if (wanted === "") {
      summaryRef.current?.focus();
      return;
    }
    removeRefs.current.get(wanted)?.focus();
  }, [selected]);

  const byId = useMemo(() => {
    const map = new Map<string, PlayerOption>();
    for (const option of options) map.set(option.playerId, option);
    return map;
  }, [options]);

  /**
   * Chosen players in the order they were added, skipping any we cannot name.
   *
   * EVERYTHING below counts against this rather than against `selected`. An id
   * the options no longer carry renders no chip, so counting it would say "3 of
   * 4 players picked" above two chips, and could reach the cap with the picker
   * gone and nothing on screen to remove.
   */
  const chosen = useMemo(
    () =>
      selected
        .map((playerId) => byId.get(playerId))
        .filter((option): option is PlayerOption => Boolean(option)),
    [byId, selected],
  );

  const chosenIds = useMemo(
    () => new Set(chosen.map((option) => option.playerId)),
    [chosen],
  );

  const full = chosen.length >= max;

  /**
   * Rebuilt from `chosen`, so an id the options cannot name is dropped on the
   * next interaction rather than sitting in the state forever.
   */
  const add = useCallback(
    (playerId: string) => {
      if (!playerId || chosenIds.has(playerId) || full) return;
      const next = [...chosenIds, playerId];
      const option = byId.get(playerId);
      // At the cap the picker unmounts, so the control the reader just used is
      // about to vanish. The new chip is where they are, and removing one is the
      // only thing left to do.
      if (next.length >= max) focusAfterChange.current = playerId;
      onChange(next);
      onAnnounce(
        next.length >= max
          ? `${option?.label ?? "Player"} added. ${describeCount(next.length, max)} That is the most one side can name, so the add control has gone. Remove one to pick somebody else.`
          : `${option?.label ?? "Player"} added. ${describeCount(next.length, max)} Press Search to apply.`,
      );
    },
    [byId, chosenIds, full, max, onAnnounce, onChange],
  );

  const remove = useCallback(
    (playerId: string) => {
      const current = [...chosenIds];
      const next = current.filter((id) => id !== playerId);
      // Whichever chip takes this one's place, or the one before it at the end
      // of the list, or the summary line when nothing is left. Decided before
      // the state changes, because afterwards there is no removed index to read.
      const index = current.indexOf(playerId);
      focusAfterChange.current =
        next.length === 0 ? "" : (next[index] ?? next[next.length - 1]);
      removeRefs.current.delete(playerId);
      onChange(next);
      const option = byId.get(playerId);
      onAnnounce(
        `${option?.label ?? "Player"} removed. ${describeCount(next.length, max)} Press Search to apply.`,
      );
    },
    [byId, chosenIds, max, onAnnounce, onChange],
  );

  return (
    <div>
      {full ? (
        // The picker is replaced rather than disabled. A disabled select is
        // skipped by keyboard navigation and read as unavailable with no reason
        // attached, which leaves a reader who has added four players unable to
        // find out why the control vanished from their tab order. The sentence
        // that replaces it is also spoken by `add`, so a reader who never sees
        // this paragraph still hears what happened.
        <p className="rounded-card border border-dashed border-line bg-base/40 px-3 py-2.5 text-sm text-ink-muted">
          {`That is ${max} players, which is as many as one side can name. Remove one to swap it for somebody else.`}
        </p>
      ) : (
        <PlayerPicker
          filterLabel={filterLabel}
          label={label}
          hint={hint}
          options={options}
          excludeIds={chosenIds}
          // Always empty: this select is a button that happens to look like a
          // list, and the answer it produces lands in the chips below rather
          // than staying inside the control.
          value=""
          onChange={add}
          anyLabel={addLabel}
          showCount={false}
          clearFilterOnChange
        />
      )}

      {/* Named by the side it belongs to AND by what it currently holds, in that
          order. The summary alone is identical on both instances once each has a
          player in it, so on its own it cannot tell them apart. */}
      <div className="mt-2" role="group" aria-labelledby={`${groupNameId} ${chipsId}`}>
        <span id={groupNameId} className="sr-only">
          {chipsLabel}
        </span>
        {/* Focusable only by script, never in the tab order. It is where focus
            goes when the last chip is removed, so the reader hears what the
            list now says instead of being dropped at the top of the page. */}
        <p
          id={chipsId}
          ref={summaryRef}
          tabIndex={-1}
          className="text-xs font-semibold text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {chosen.length === 0
            ? emptyNote
            : chosen.length === 1
              ? `${describeCount(1, max)} Add another and both have to be in the deal.`
              : `${describeCount(chosen.length, max)} They all have to be in the deal.`}
        </p>
        {chosen.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {chosen.map((option) => (
              <li key={option.playerId}>
                <span className="inline-flex items-center gap-1 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 py-1 pl-2.5 pr-1 text-xs font-semibold text-ink">
                  {option.label}
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) removeRefs.current.set(option.playerId, node);
                      else removeRefs.current.delete(option.playerId);
                    }}
                    onClick={() => remove(option.playerId)}
                    // 44px so it is a real tap target on a phone, and named for
                    // the player it drops rather than "Remove", which would give
                    // a screen reader four identical buttons in a row.
                    aria-label={`Remove ${option.label} from this package`}
                    className="flex h-11 w-11 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** "2 of 4 players picked." Spoken and written from the same sentence. */
function describeCount(count: number, max: number): string {
  if (count === 0) return "No players picked.";
  return `${count} of ${max} ${count === 1 ? "player" : "players"} picked.`;
}
