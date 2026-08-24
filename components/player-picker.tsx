"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Pick one player out of several hundred.
 *
 * A twelve-team dynasty roster set is six hundred names, and a select holding
 * six hundred options is a scroll, not a control. So there is a filter above it.
 *
 * WHY A FILTER PLUS A NATIVE SELECT, NOT A COMBOBOX
 *   The obvious build is an ARIA combobox: one text field, a popup listbox,
 *   aria-activedescendant, the lot. It is also the build with the worst record
 *   in practice. A custom listbox has to reimplement everything a select gets
 *   for free, and it has to get it right in every screen reader and on touch,
 *   where the native control opens the platform's own picker with its own
 *   scrolling, typeahead, and rotor support.
 *
 *   A search box that narrows a real <select> keeps all of that and adds the one
 *   thing that was missing. Nothing about the select changes: it is still a
 *   labelled form control, still keyboard-navigable, still announces "N of M",
 *   still opens the wheel on a phone. The filter is an ordinary text input
 *   beside it. There is no custom widget to get wrong.
 *
 * THE SELECTED PLAYER IS NEVER FILTERED OUT
 *   A filter that can hide the current selection is a control that silently
 *   changes its own value, so the chosen option is always present whatever the
 *   query says, and is marked as the current pick when it would not otherwise
 *   match.
 *
 * Matching ignores case, accents, and punctuation, and every word has to appear
 * somewhere, so "dandre swift" finds D'Andre Swift and "buf wr" finds the
 * receivers on Buffalo. The team name is searchable because the options are
 * grouped by team and a manager thinking about one roster should be able to say
 * so.
 */

export type PlayerOption = {
  playerId: string;
  label: string;
  /** The team that holds him. Groups the options and is itself searchable. */
  group: string;
};

/** Lowercase, unaccented, punctuation-free. "D'Andre" and "dandre" both land here. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    // The combining marks NFD just split off. Escaped rather than written
    // literally so this file stays plain ASCII, and stripped BEFORE the general
    // cleanup below, which would otherwise turn each mark into a space and cut
    // an accented name in half.
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Longest filter this will act on.
 *
 * Matching is O(options x words), so a pasted essay costs a few hundred
 * `includes` calls per word on every keystroke and freezes the tab. Nobody types
 * a hundred characters to find a running back.
 */
const MAX_QUERY = 100;

/**
 * Memoized. The parent sets state constantly (searching, paging, saving,
 * passing) and none of it changes this component's props, so without it every
 * one of those rebuilds several hundred option elements twice over.
 */
export const PlayerPicker = memo(function PlayerPicker({
  label,
  hint,
  options,
  value,
  onChange,
  anyLabel = "Anyone",
  filterLabel,
  showCount = true,
}: {
  label: string;
  hint: string;
  options: PlayerOption[];
  value: string;
  onChange: (playerId: string) => void;
  /** The "no specific player" option. */
  anyLabel?: string;
  /** Visible label for the filter box. Says which list it narrows. */
  filterLabel: string;
  /**
   * Whether "349 players in the list" is drawn under the filter box.
   *
   * Off on Trade Ideas, where two of these sit side by side and a running count
   * pinned under each input is clutter rather than guidance: the select right
   * below it is the list, and its length is obvious from opening it.
   *
   * The count NEVER stops being available to a screen reader. Off, it keeps its
   * id and its text and only loses its visible box, because it is what the
   * select's aria-describedby resolves to. Deleting the element would take the
   * select's own explanation of its length with it, which is the one reader who
   * cannot see the list shrink.
   */
  showCount?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);

  const baseId = useId();
  const selectId = `${baseId}-select`;
  const hintId = `${baseId}-hint`;
  const filterId = `${baseId}-filter`;
  const filterHintId = `${baseId}-filter-hint`;
  const statusId = `${baseId}-status`;
  const groupId = `${baseId}-group`;

  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of options) {
      map.set(option.playerId, normalize(`${option.label} ${option.group}`));
    }
    return map;
  }, [options]);

  const terms = useMemo(
    () => normalize(query).split(" ").filter(Boolean),
    [query],
  );

  const matches = useMemo(() => {
    if (terms.length === 0) return options;
    return options.filter((option) => {
      const hay = haystacks.get(option.playerId) ?? "";
      return terms.every((term) => hay.includes(term));
    });
  }, [haystacks, options, terms]);

  const selected = useMemo(
    () => options.find((o) => o.playerId === value) ?? null,
    [options, value],
  );

  // The current pick rides along whether or not it matches, so narrowing the
  // list can never quietly discard the reader's choice.
  const shown = useMemo(() => {
    if (!selected || matches.some((o) => o.playerId === selected.playerId)) {
      return matches;
    }
    return [selected, ...matches];
  }, [matches, selected]);

  const filtering = terms.length > 0;
  /**
   * What the list actually looks like now.
   *
   * The first version said "No players match. The list is unchanged." on a zero
   * result, and the list was not unchanged: `shown` is `matches`, so the select
   * emptied down to Anyone. Telling a screen reader user the filter did nothing
   * while it had in fact emptied the control is worse than saying nothing, and
   * it is the one failure this component could not afford. It now describes what
   * is there, and counts the retained pick when one survived on its own.
   */
  const status = (() => {
    if (!filtering) {
      return `${options.length} ${options.length === 1 ? "player" : "players"} in the list.`;
    }
    if (matches.length === 0) {
      return selected
        ? "No players match. Only your current pick is left in the list."
        : "No players match. Only the Anyone option is left in the list.";
    }
    const kept = shown.length > matches.length ? ", plus your current pick" : "";
    return matches.length === 1
      ? `1 of ${options.length} players matches${kept}.`
      : `${matches.length} of ${options.length} players match${kept}.`;
  })();

  /**
   * The same sentence, held back until typing stops.
   *
   * `aria-live="polite"` defers to speech already in progress; it does not
   * collapse a queue. Typed into on every keystroke it enqueues one string per
   * character, so "jefferson" interleaves nine counts with the character echo
   * and the reader hears a stream of numbers instead of an answer. The visible
   * copy still updates instantly.
   */
  const [spokenStatus, setSpokenStatus] = useState(status);
  useEffect(() => {
    const timer = setTimeout(() => setSpokenStatus(status), 500);
    return () => clearTimeout(timer);
  }, [status]);

  /**
   * The rendered options, built only when the list actually changes.
   *
   * Several hundred option elements, and the parent sets state on every search,
   * arrow press, save and pass, none of which touch this list. Rebuilding them
   * each time is a few milliseconds of element creation and several hundred
   * fibers of reconciliation for an identical result.
   */
  const grouped = useMemo(
    () => groupOptions(shown, selected, matches),
    [shown, selected, matches],
  );

  return (
    // Grouped, so the filter and the list announce as one control rather than as
    // two strangers with near-identical names. Without it a reader tabbing the
    // form hears "Find a player to get, edit" then "Player you want, combo box"
    // and has no way to know the first narrows the second; a reader arriving at
    // the select from a form-controls list never learns the filter exists.
    <div role="group" aria-labelledby={groupId}>
      <span id={groupId} className="sr-only">
        {label}
      </span>

      <label htmlFor={filterId} className="block text-sm font-semibold text-ink">
        {filterLabel}
      </label>
      {/* Short, because it is read out before the field on every visit and two
          of these sit side by side on Trade Ideas. The placeholder inside the
          box already says what to type; what a reader cannot see is what Enter
          does, so that is the half that is kept. */}
      <p id={filterHintId} className="mt-0.5 text-xs text-ink-muted">
        Enter jumps to the list, taking a single match with it.
      </p>
      <div className="relative mt-1.5">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          id={filterId}
          // Deliberately not type="search": several browsers add their own clear
          // button whose accessible name we do not control and cannot label, so
          // a screen reader user would meet an unnamed button inside the field.
          // The clear button here is ours and it says what it does.
          type="text"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          aria-describedby={filterHintId}
          aria-controls={selectId}
          onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Enter inside a form submits it, and submitting here would run the
            // whole search on a half-typed filter before the reader had picked
            // anybody. It moves them on to the list instead, taking the single
            // match with it when there is exactly one.
            e.preventDefault();
            if (matches.length === 1) {
              onChange(matches[0].playerId);
              // Said out loud, because otherwise the picker changes the value
              // and moves the cursor in one keystroke and the reader hears only
              // the select being announced, with no way to tell "it just chose
              // for me" from "this was already selected". Set directly rather
              // than through the debounce, since this one is a response to a
              // deliberate keypress and should not wait.
              setSpokenStatus(`${matches[0].label} selected. Moving to the list.`);
            }
            selectRef.current?.focus();
          }}
          placeholder="Filter by name or team"
          className="min-h-11 w-full rounded-card border border-ink-subtle bg-base py-2 pl-9 pr-11 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              document.getElementById(filterId)?.focus();
            }}
            aria-label={`Clear filter: ${filterLabel}`}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* How many are left, said out loud. A sighted reader watches the list
          shrink; without this a screen reader user types into a box and gets no
          confirmation that anything happened at all. role="status" rather than a
          bare aria-live, for the implicit aria-atomic and the better support on
          a node whose text is replaced. */}
      <p role="status" className="sr-only">
        {spokenStatus}
      </p>
      {/* The same text, visible. aria-hidden so it is not announced twice as a
          live region, but it still carries an id: aria-describedby resolves text
          out of hidden subtrees, which is what lets the select explain its own
          length to somebody who arrives at it long after the filter was typed. */}
      <p
        id={statusId}
        aria-hidden="true"
        className={showCount ? "mt-1 text-xs text-ink-muted" : "sr-only"}
      >
        {status}
      </p>

      <label htmlFor={selectId} className="mt-3 block text-sm font-semibold text-ink">
        {label}
      </label>
      <p id={hintId} className="mt-0.5 text-xs text-ink-muted">
        {hint}
      </p>
      <select
        id={selectId}
        ref={selectRef}
        aria-describedby={`${hintId} ${statusId}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 min-h-11 w-full rounded-card border border-ink-subtle bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <option value="">{anyLabel}</option>
        {grouped}
      </select>
    </div>
  );
});

/**
 * Options grouped by the team that holds each player.
 *
 * A pick that survives only because it is the current one is labelled as such,
 * so a reader who filters to "Jefferson" and finds Josh Allen still sitting in
 * the list knows why he is there.
 */
function groupOptions(
  shown: PlayerOption[],
  selected: PlayerOption | null,
  matches: PlayerOption[],
) {
  const matched = new Set(matches.map((o) => o.playerId));
  const groups = new Map<string, PlayerOption[]>();
  for (const option of shown) {
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }
  // Groups in name order. They were coming out in whichever order a team's first
  // player happened to appear once the options had been sorted by player name,
  // which is arbitrary, so stepping the select team by team went nowhere
  // predictable.
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => (
      <optgroup key={group} label={group}>
        {list.map((option) => {
          const kept =
            selected?.playerId === option.playerId && !matched.has(option.playerId);
          return (
            <option key={option.playerId} value={option.playerId}>
              {kept ? `${option.label} (your current pick)` : option.label}
            </option>
          );
        })}
      </optgroup>
    ));
}
