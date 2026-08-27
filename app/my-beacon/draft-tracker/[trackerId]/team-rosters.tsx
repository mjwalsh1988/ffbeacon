"use client";

/**
 * Who has what, so far.
 *
 * One component covers both tracking modes, because they are the same shape
 * with a different number of groups. Tracking one team gives you two: yours,
 * and everybody else's. Tracking the room gives you one per manager, plus a
 * group for the picks whose owner nobody caught at the time.
 *
 * EVERY ROSTER IS GROUPED BY POSITION. A roster read as one list in pick order
 * answers "what did I take" and not "how many running backs do I have", which is
 * the question somebody actually has on the clock. Each position gets a small
 * heading carrying its count, so the shape of a roster is readable without
 * scrolling it, and the names under each heading stay in the order they were
 * taken.
 *
 * EVERY PICK CARRIES ITS DRAFT SLOT. 1.01, 2.04, 11.12: derived from where the
 * pick sits in the recorded order and how many teams are in the room, so undoing
 * a pick in the middle renumbers everything after it, which is what happened.
 *
 * A PICK CAN OUTLIVE ITS PLAYER on this screen. The board is the ranked list for
 * one source, and the reader can change source mid draft from the site header, so
 * a player drafted under one source may not be ranked by the next. Those picks
 * render as a row that says so and keeps its undo button, rather than vanishing
 * while still counting as off the board, which would leave a drafted player
 * unreachable until the whole board was cleared. They have no position, so they
 * gather under their own heading at the end.
 *
 * Memoized, and it earns it: this is uncapped, so a 12 team, 20 round draft is
 * 240 rows with a photo each, and the room re-renders three times per pick for
 * reasons that have nothing to do with any roster.
 */

import { memo } from "react";
import { RotateCcw, Shuffle, UserRoundX } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { POSITION_BADGE, POSITION_BADGE_FALLBACK } from "@/lib/on-the-clock/position-colors";
import { BOARD_POSITIONS, type BoardPosition, type TrackerPlayer } from "@/lib/draft-tracker/types";

export type RosterEntry = {
  playerId: string;
  /** Null when this pick's player is not on the current board. */
  player: TrackerPlayer | null;
  /** 1-based pick order across the whole draft. */
  pickNumber: number;
  /** The draft spot, already formatted: "1.01". */
  draftSlot: string;
  /** The same spot said out loud: "Round 1, pick 1". */
  draftSlotSpoken: string;
};

export type RosterGroup = {
  key: string;
  label: string;
  /** The reader's own team, drawn with the accent border. */
  isMine: boolean;
  /** True for the "owner not recorded" bucket, which reads differently. */
  isUnassigned: boolean;
  /** The slot these picks sit on, or null for the unassigned bucket. */
  slot: number | null;
  entries: RosterEntry[];
};

/** The name a row shows when the pick's player is not on this board. */
const UNKNOWN_PLAYER_LABEL = "A player who is not on this board";

/** The long name of a position, for anything read rather than scanned. */
const POSITION_NAME: Record<BoardPosition, string> = {
  QB: "Quarterbacks",
  RB: "Running backs",
  WR: "Wide receivers",
  TE: "Tight ends",
  K: "Kickers",
  DEF: "Defenses",
};

type PositionSection = {
  key: string;
  position: BoardPosition | null;
  entries: RosterEntry[];
};

/**
 * Split a roster into its positions, in board order, keeping pick order inside
 * each. Picks whose player is off the board have no position to sort into and
 * gather at the end rather than being dropped.
 */
function positionSections(entries: RosterEntry[]): PositionSection[] {
  const byPosition = new Map<BoardPosition, RosterEntry[]>();
  const unknown: RosterEntry[] = [];
  for (const entry of entries) {
    const position = entry.player?.position;
    if (!position) {
      unknown.push(entry);
      continue;
    }
    const bucket = byPosition.get(position);
    if (bucket) bucket.push(entry);
    else byPosition.set(position, [entry]);
  }
  const sections: PositionSection[] = BOARD_POSITIONS.flatMap((position) => {
    const found = byPosition.get(position);
    return found && found.length > 0
      ? [{ key: position, position, entries: found }]
      : [];
  });
  if (unknown.length > 0) {
    sections.push({ key: "unknown", position: null, entries: unknown });
  }
  return sections;
}

export const TeamRosters = memo(function TeamRosters({
  groups,
  sourceLabel,
  canReassign,
  onUndo,
  onReassign,
  busyPlayerIds,
  singleColumn = false,
}: {
  groups: RosterGroup[];
  sourceLabel: string;
  /** Only the room-tracking mode has other teams to move a player to. */
  canReassign: boolean;
  onUndo: (playerId: string, name: string) => void;
  onReassign: (entry: RosterEntry, currentSlot: number | null) => void;
  busyPlayerIds: Set<string>;
  /**
   * Stay one card wide whatever the viewport is doing.
   *
   * The two-column grid below keys off the VIEWPORT, not the container, so in
   * the 340px page rail on a desktop it split each card to about 160px: a
   * headshot, a truncated name and two 44px buttons fighting over the rest.
   * The rail passes this; the main column and the sheet do not.
   */
  singleColumn?: boolean;
}) {
  return (
    <ul className={`grid gap-3 ${singleColumn ? "" : "md:grid-cols-2"}`}>
      {groups.map((group) => {
        const total = group.entries.reduce(
          (sum, entry) => sum + (entry.player?.value ?? 0),
          0,
        );
        const sections = positionSections(group.entries);

        return (
          <li
            key={group.key}
            className={`rounded-card border p-3 ${
              group.isMine
                ? "border-brand-purple/50 bg-brand-purple/[0.06]"
                : "border-line bg-base/40"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold text-ink">
                {group.label}
                {group.isMine && (
                  <span className="ml-2 rounded bg-brand-purple/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
                    You
                  </span>
                )}
              </h3>
              <p className="text-xs text-ink-muted">
                {group.entries.length}{" "}
                {group.entries.length === 1 ? "player" : "players"}
                {total > 0 && (
                  <>
                    <span aria-hidden="true">, </span>
                    <span className="font-mono tabular-nums text-ink">
                      {total.toLocaleString()}
                    </span>{" "}
                    <span aria-hidden="true">value</span>
                    <span className="sr-only">total {sourceLabel} value</span>
                  </>
                )}
              </p>
            </div>

            {group.isUnassigned && group.entries.length > 0 && (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
                {canReassign
                  ? "Off the board, but nobody was written down. Use the move button to put one on a team."
                  : "Gone to the rest of the room. The undo button puts one back."}
              </p>
            )}

            {group.entries.length === 0 ? (
              <p className="mt-2 text-xs text-ink-subtle">
                {group.isMine ? "You have not taken anyone yet." : "Nothing yet."}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {sections.map((section) => (
                  <div key={section.key}>
                    {/* The separator: small, so it marks a change of position
                        without competing with the names under it. */}
                    <p className="flex items-center gap-1.5 border-b border-line/60 pb-1">
                      <span
                        aria-hidden="true"
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          section.position
                            ? POSITION_BADGE[section.position]
                            : POSITION_BADGE_FALLBACK
                        }`}
                      >
                        {section.position ?? "?"}
                      </span>
                      <span aria-hidden="true" className="text-[11px] text-ink-muted">
                        {section.entries.length}
                      </span>
                      <span className="sr-only">
                        {section.position
                          ? POSITION_NAME[section.position]
                          : "Players not on this board"}
                        , {section.entries.length}
                      </span>
                    </p>

                    <ul className="divide-y divide-line/60">
                      {section.entries.map((entry) => {
                        const { player, playerId, draftSlot, draftSlotSpoken } = entry;
                        const busy = busyPlayerIds.has(playerId);
                        const name = player?.name ?? UNKNOWN_PLAYER_LABEL;
                        return (
                          <li key={playerId} className="flex items-center gap-2 py-1.5">
                            <span className="shrink-0">
                              {player ? (
                                <PlayerHeadshot
                                  sleeperId={player.sleeperId}
                                  name=""
                                  size={28}
                                />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-base text-ink-subtle"
                                >
                                  <UserRoundX className="h-4 w-4" />
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold leading-tight text-ink">
                                {name}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs leading-tight text-ink-muted">
                                <span
                                  aria-hidden="true"
                                  className="rounded bg-surface px-1 font-mono text-[11px] font-semibold tabular-nums text-brand-cyan"
                                >
                                  {draftSlot}
                                </span>
                                <span className="sr-only">{draftSlotSpoken}.</span>
                                {player ? (
                                  <>
                                    <span aria-hidden="true">
                                      {player.position}
                                      {player.positionRank}
                                      {player.team ? `, ${player.team}` : ""}
                                    </span>
                                    <span className="sr-only">
                                      {player.position} rank {player.positionRank}
                                      {player.team ? `, ${player.team}` : ""}
                                    </span>
                                  </>
                                ) : (
                                  <span>Your source does not rank him</span>
                                )}
                              </span>
                            </span>
                            {canReassign && (
                              <button
                                type="button"
                                aria-disabled={busy}
                                onClick={() => {
                                  if (busy) return;
                                  onReassign(entry, group.slot);
                                }}
                                aria-label={`Move ${name} to a different team`}
                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
                              >
                                <Shuffle aria-hidden="true" className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              aria-disabled={busy}
                              onClick={() => {
                                if (busy) return;
                                onUndo(playerId, name);
                              }}
                              aria-label={`Put ${name} back on the board, taken at ${draftSlotSpoken}`}
                              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
                            >
                              <RotateCcw aria-hidden="true" className="h-4 w-4" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
});
