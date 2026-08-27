"use client";

/**
 * The board: every player still available, in one list, in the order the reader
 * chose when they set the draft up.
 *
 * ONE LIST, NOT SECTIONS. The question this answers is "who is the best player
 * left", and that is a cross-position question. Narrowing to a position is what
 * the filter chips are for, and finding a name is what the search box is for.
 * (Rosters are the opposite case and are grouped by position, because "how many
 * running backs do I have" is the question there.)
 *
 * A real table, because this is tabular data and a reader moving by column
 * deserves the column semantics. The three orderings double as the three column
 * headers, so `aria-sort` says which one is live and pressing a header is the
 * same act as pressing the control above it.
 *
 * WHERE FOCUS GOES, which is the whole ballgame on this screen. Pressing Mine or
 * Gone removes that row, so the button holding focus unmounts and focus falls to
 * the top of the document. A reader drafting fifteen rounds does that 180 times.
 * So every press records which player it was and where he sat, and once he is
 * actually gone from the list, focus moves to the same seat in the new list: the
 * player who just moved up into it. Reaching the end of the list moves to the
 * last row, and emptying it moves to the search box.
 *
 * The intent waits for the player to leave rather than firing on the next render,
 * which is what makes the same mechanism work for the "which team took him"
 * dialog. There the row survives the press, the dialog opens, and the row only
 * goes when the dialog resolves. SlideUpDialog's own focus restore aims at the
 * button that by then no longer exists, so this has to be the thing that lands.
 *
 * BUSY BUTTONS ARE aria-disabled, NEVER disabled. Setting `disabled` on the
 * element that currently holds focus blurs it to the body in every browser,
 * which would be a second way to lose focus on exactly the press we are trying
 * to protect.
 *
 * MOBILE. Tier, ADP, and value collapse out of their own columns below the sm
 * breakpoint and reappear as one line under the player's name, so a phone shows
 * two columns (who, and what you can do about him) with nothing scrolled off to
 * the right and no number missing. Both layouts are display:none on the other
 * side of the breakpoint, so a screen reader is read one of them and never both.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, UserMinus } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { POSITION_BADGE } from "@/lib/on-the-clock/position-colors";
import {
  describeBoard,
  filterBoard,
  orderPhrase,
  sortBoard,
} from "@/lib/draft-tracker/order";
import {
  BOARD_POSITIONS,
  type BoardPosition,
  type DraftOrder,
  type TrackerPlayer,
} from "@/lib/draft-tracker/types";

const PAGE_SIZE = 25;

/** How long the spoken summary waits for typing to settle. */
const ANNOUNCE_DELAY_MS = 500;

type PositionFilter = BoardPosition | "ALL";

const POSITIONS: PositionFilter[] = ["ALL", ...BOARD_POSITIONS];

function ariaSortFor(active: boolean, direction: "ascending" | "descending") {
  return active ? direction : "none";
}

/** The compact numbers line a phone gets in place of three columns. */
function MobileMeta({ player, hasAdp }: { player: TrackerPlayer; hasAdp: boolean }) {
  const parts = [
    player.tier ? `Tier ${player.tier}` : "No tier",
    typeof player.adp === "number"
      ? `ADP ${player.adp.toFixed(1)}`
      : hasAdp
        ? "No ADP"
        : "ADP unavailable",
    typeof player.value === "number" ? `Value ${player.value.toLocaleString()}` : "No value",
  ];
  return (
    <span className="mt-0.5 block text-xs leading-tight text-ink-muted sm:hidden">
      {parts.join(", ")}
    </span>
  );
}

export const AvailablePlayers = memo(function AvailablePlayers({
  players,
  orderBy,
  sourceLabel,
  hasAdp,
  trackingMode,
  onDraftToMe,
  onMarkTaken,
  onChangeOrder,
  busyPlayerIds,
}: {
  players: TrackerPlayer[];
  orderBy: DraftOrder;
  sourceLabel: string;
  /** False when this format has no Sleeper market at all, which changes the copy. */
  hasAdp: boolean;
  trackingMode: "mine" | "all";
  onDraftToMe: (player: TrackerPlayer) => void;
  onMarkTaken: (player: TrackerPlayer) => void;
  onChangeOrder: (order: DraftOrder) => void;
  /** Players with a write in flight, so their buttons can go quiet. */
  busyPlayerIds: Set<string>;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<PositionFilter>("ALL");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const ordered = useMemo(() => sortBoard(players, orderBy), [players, orderBy]);
  const filtered = useMemo(
    () => filterBoard(ordered, { search, position }),
    [ordered, search, position],
  );
  const shown = filtered.slice(0, visible);

  const summary = describeBoard(shown.length, filtered.length, players.length, position);

  // Announce the settled sentence, and only for something the reader did.
  // Typing a name queues one announcement per character otherwise, over the top
  // of the character echo, which makes the field unusable by ear.
  //
  // The sort headers deliberately do NOT count as an interaction here. They
  // change the ordering, the room announces that, and a second region saying
  // the count is unchanged would only talk over it.
  const [interactions, setInteractions] = useState(0);
  const noteInteraction = () => setInteractions((n) => n + 1);
  const [announced, setAnnounced] = useState("");
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  useEffect(() => {
    if (interactions === 0) return;
    const timer = setTimeout(() => setAnnounced(summaryRef.current), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [interactions, search, position, visible]);

  // A pick shortens the list under the reader's hand. Keep their place rather
  // than snapping back to the first page.
  useEffect(() => {
    setVisible((v) => Math.max(PAGE_SIZE, Math.min(v, filtered.length)));
  }, [filtered.length]);

  // --- focus handoff -------------------------------------------------------
  const searchRef = useRef<HTMLInputElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const [focusIntent, setFocusIntent] = useState<{ playerId: string; index: number } | null>(
    null,
  );
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useLayoutEffect(() => {
    if (!focusIntent) return;
    // Wait for the player to actually leave. A press that opens a dialog, or one
    // the reader then cancels, must not move focus early.
    if (players.some((p) => p.playerId === focusIntent.playerId)) return;

    const rows = shownRef.current;
    setFocusIntent(null);
    if (rows.length === 0) {
      searchRef.current?.focus();
      return;
    }
    const next = rows[Math.min(focusIntent.index, rows.length - 1)];
    const button = next ? rowButtons.current.get(next.playerId) : null;
    if (button) button.focus();
    else searchRef.current?.focus();
  }, [players, focusIntent]);

  const takePlayer = useCallback(
    (player: TrackerPlayer, index: number, action: (p: TrackerPlayer) => void) => {
      if (busyPlayerIds.has(player.playerId)) return;
      setFocusIntent({ playerId: player.playerId, index });
      action(player);
    },
    [busyPlayerIds],
  );

  const headerButton =
    "inline-flex min-h-11 w-full items-center gap-1 px-3 py-2 text-left font-semibold text-ink transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

  const inputClass =
    "h-11 w-full rounded-card border border-line bg-base px-3 text-base text-ink placeholder:text-ink-subtle focus:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search the players still available
          </label>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisible(PAGE_SIZE);
              noteInteraction();
            }}
            placeholder="Type a name or team"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <div role="group" aria-label="Filter by position" className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => {
            const active = position === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setPosition(p);
                  setVisible(PAGE_SIZE);
                  noteInteraction();
                }}
                className={`min-h-11 min-w-11 rounded-card border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                    : "border-line bg-base text-ink-muted hover:text-ink"
                }`}
              >
                {p === "ALL" ? "All" : p}
              </button>
            );
          })}
        </div>
      </div>

      <p aria-hidden="true" className="mt-3 text-xs text-ink-muted">
        {summary} Ordered by {orderPhrase(orderBy, sourceLabel)}.
      </p>
      <p role="status" className="sr-only">
        {announced}
      </p>

      <div className="mt-2 overflow-hidden rounded-card border border-line">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Players still available, ordered by {orderPhrase(orderBy, sourceLabel)}.{" "}
            {summary} Each row has a button to draft the player to your team and a
            button to mark him taken by somebody else.
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            {/* Each header carries a SHORT aria-label. Without one, the column
                header's name is computed from its whole subtree, so the sorting
                instruction on the button inside it gets read again before every
                cell in the column during table navigation. */}
            <tr>
              <th
                scope="col"
                aria-label="Player"
                aria-sort={ariaSortFor(orderBy === "alphabetical", "ascending")}
                className="px-0 py-0 text-left"
              >
                <button
                  type="button"
                  aria-label="Order the board by player name, A to Z"
                  className={headerButton}
                  onClick={() => onChangeOrder("alphabetical")}
                >
                  <span aria-hidden="true">Player</span>
                </button>
              </th>
              <th
                scope="col"
                className="hidden px-3 py-2 text-left font-semibold sm:table-cell"
              >
                Tier
              </th>
              <th
                scope="col"
                aria-label="Sleeper ADP"
                aria-sort={ariaSortFor(orderBy === "adp", "ascending")}
                className="hidden px-0 py-0 text-left sm:table-cell"
              >
                <button
                  type="button"
                  aria-label="Order the board by Sleeper ADP, earliest first"
                  className={headerButton}
                  onClick={() => onChangeOrder("adp")}
                >
                  <span aria-hidden="true">ADP</span>
                </button>
              </th>
              <th
                scope="col"
                aria-label="Value"
                aria-sort={ariaSortFor(orderBy === "value", "descending")}
                className="hidden px-0 py-0 text-right sm:table-cell"
              >
                <button
                  type="button"
                  aria-label={`Order the board by ${sourceLabel} value, highest first`}
                  className={`${headerButton} justify-end`}
                  onClick={() => onChangeOrder("value")}
                >
                  <span aria-hidden="true">Value</span>
                </button>
              </th>
              <th scope="col" aria-label="Take" className="px-3 py-2 text-right font-semibold">
                <span aria-hidden="true">Take</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-muted">
                  {players.length === 0
                    ? "Every player on this board has been drafted."
                    : "No available player matches that search."}
                </td>
              </tr>
            ) : (
              shown.map((player, index) => {
                const busy = busyPlayerIds.has(player.playerId);
                return (
                  <tr key={player.playerId} className="border-t border-line/60">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span className="shrink-0">
                          <PlayerHeadshot sleeperId={player.sleeperId} name="" size={32} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold leading-tight text-ink">
                            {player.name}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs leading-tight text-ink-muted">
                            <span
                              className={`rounded px-1.5 py-0.5 font-semibold ${POSITION_BADGE[player.position]}`}
                            >
                              <span aria-hidden="true">
                                {player.position}
                                {player.positionRank}
                              </span>
                              <span className="sr-only">
                                {player.position} rank {player.positionRank}
                              </span>
                            </span>
                            <span>{player.team ?? "No team"}</span>
                          </span>
                          <MobileMeta player={player} hasAdp={hasAdp} />
                        </span>
                      </span>
                    </th>
                    <td className="hidden px-3 py-2 text-ink-muted sm:table-cell">
                      {player.tier ? (
                        <>
                          <span aria-hidden="true">T{player.tier}</span>
                          <span className="sr-only">Tier {player.tier}</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">-</span>
                          <span className="sr-only">No tier</span>
                        </>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 font-mono tabular-nums text-ink sm:table-cell">
                      {typeof player.adp === "number" ? (
                        player.adp.toFixed(1)
                      ) : (
                        <span className="text-ink-subtle">
                          <span aria-hidden="true">-</span>
                          <span className="sr-only">
                            {hasAdp ? "No ADP for this player" : "No ADP list for this format"}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-right font-mono tabular-nums text-ink sm:table-cell">
                      {typeof player.value === "number" ? (
                        player.value.toLocaleString()
                      ) : (
                        <span className="text-ink-subtle">
                          <span aria-hidden="true">-</span>
                          <span className="sr-only">No value from {sourceLabel}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {/* Stacked on a phone, side by side from sm. Two 44px
                          targets in a row do not fit beside a name on a 360px
                          screen without one of them shrinking, and the buttons
                          are the point of the row. */}
                      <span className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:justify-end">
                        <button
                          type="button"
                          ref={(node) => {
                            rowButtons.current.set(player.playerId, node);
                          }}
                          aria-disabled={busy}
                          onClick={() => takePlayer(player, index, onDraftToMe)}
                          aria-label={`Draft ${player.name} to your team`}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card bg-beacon px-3 text-xs font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
                        >
                          <Check aria-hidden="true" className="h-4 w-4" />
                          <span aria-hidden="true">Mine</span>
                        </button>
                        <button
                          type="button"
                          aria-disabled={busy}
                          onClick={() => takePlayer(player, index, onMarkTaken)}
                          aria-label={
                            trackingMode === "all"
                              ? `Mark ${player.name} taken, then choose which team took him`
                              : `Mark ${player.name} taken by someone else`
                          }
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card border border-line bg-base px-3 text-xs font-semibold text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
                        >
                          <UserMinus aria-hidden="true" className="h-4 w-4" />
                          <span aria-hidden="true">Gone</span>
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {visible < filtered.length && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setVisible((v) => v + PAGE_SIZE);
              noteInteraction();
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Show more ({filtered.length - visible} still to come)
          </button>
        </div>
      )}
    </div>
  );
});
