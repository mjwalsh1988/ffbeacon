"use client";

/**
 * Draft board: a native <table>. Columns = draft seats (STABLE across rounds,
 * <th scope="col">), rows = rounds (<th scope="row">). Snake reversal is encoded
 * purely in the serpentine pick number carried in each cell's text + aria-label;
 * the seat columns never reorder, which is what makes the board readable by ear.
 *
 * No color-only state: "On the clock", "Your pick", "Last pick", and "Open slot"
 * are all text. MOCKED for Phase 4 from the fixture picks. Horizontal scroll keeps
 * every seat visible on mobile (no data hidden at any breakpoint).
 */

import { ArrowLeftRight } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { ShapedDraftCache, ShapedPick } from "@/lib/on-the-clock/types";
import type { CurrentDraftPick } from "@/lib/on-the-clock/pick-ownership";
import { draftShapeFromMeta, pickNoForSeat } from "@/lib/on-the-clock/draft-derive";

function shortName(pick: ShapedPick): string {
  const first = pick.firstName ? `${pick.firstName[0]}.` : "";
  return `${first} ${pick.lastName ?? ""}`.trim() || "Pick";
}

export function DraftBoard({
  draft,
  picks,
  currentPicks,
  teamNameByRosterId,
  connectedUserSlot,
  onTheClockPickNo,
  lastPickNo,
}: {
  draft: ShapedDraftCache["draft"];
  picks: ShapedPick[];
  /** Transaction-aware ownership per pick (original vs current owner roster). */
  currentPicks: CurrentDraftPick[];
  /** roster_id -> owner username (Sleeper display_name). */
  teamNameByRosterId: Record<number, string>;
  connectedUserSlot: number;
  onTheClockPickNo: number;
  lastPickNo: number;
}) {
  const teams = draft.settings.teams ?? 0;
  const rounds = draft.settings.rounds ?? 0;
  const shape = draftShapeFromMeta(draft);
  const byPickNo = new Map<number, ShapedPick>(picks.map((p) => [p.pickNo, p]));
  // Ownership lookup keyed by overall pick number (carries original vs current owner).
  const ownerByPickNo = new Map<number, CurrentDraftPick>(currentPicks.map((c) => [c.overall, c]));
  // Roster id behind the searched user's seat, used to highlight their picks.
  const userRosterId = draft.slotToRosterId[String(connectedUserSlot)] ?? null;

  // Column header = the ORIGINAL owner of that seat (its username), not a team name.
  const teamName = (seat: number) => {
    const rosterId = draft.slotToRosterId[String(seat)];
    if (rosterId != null && teamNameByRosterId[rosterId]) return teamNameByRosterId[rosterId];
    return `Team ${seat}`;
  };

  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="border-collapse text-xs">
        <caption className="sr-only">
          Draft board. Columns are draft seats, rows are rounds. Each cell names the
          overall pick number, and the drafted player when the pick has been made.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left text-ink-subtle">
              Round
            </th>
            {Array.from({ length: teams }, (_, i) => i + 1).map((seat) => (
              <th
                key={seat}
                scope="col"
                className="min-w-[7.5rem] px-2 py-2 text-left font-semibold text-ink-muted"
              >
                {teamName(seat)}
                {seat === connectedUserSlot && (
                  <span className="ml-1 text-[10px] font-semibold text-brand-cyan">(You)</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
            <tr key={round} className="border-t border-line/60">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-2 text-left text-ink-subtle">
                R{round}
              </th>
              {Array.from({ length: teams }, (_, i) => i + 1).map((seat) => {
                const pickNo = pickNoForSeat(round, seat, teams, shape);
                const pick = byPickNo.get(pickNo);
                const isOnClock = pickNo === onTheClockPickNo;
                const isLast = pickNo === lastPickNo;

                // Traded-pick flag: when the current owner differs from the seat's
                // original owner, name the NEW owner so the cell is not misread as the
                // column's team.
                const owner = ownerByPickNo.get(pickNo);
                const traded =
                  !!owner &&
                  owner.ownershipKnown &&
                  owner.originalRosterId != null &&
                  owner.currentOwnerRosterId != null &&
                  owner.currentOwnerRosterId !== owner.originalRosterId;
                const newOwner =
                  traded && owner.currentOwnerRosterId != null
                    ? teamNameByRosterId[owner.currentOwnerRosterId] ??
                      `Team ${owner.currentOwnerRosterId}`
                    : null;

                // The searched user's picks, by CURRENT ownership (picks traded to
                // them count; picks they traded away do not). Falls back to the seat's
                // original owner when ownership can't be resolved.
                const isYours =
                  userRosterId != null &&
                  owner?.ownershipKnown &&
                  owner.currentOwnerRosterId != null
                    ? owner.currentOwnerRosterId === userRosterId
                    : seat === connectedUserSlot;

                const stateText = pick
                  ? `${shortName(pick)}, ${pick.position ?? ""}`
                  : isOnClock
                    ? "On the clock"
                    : "Open slot";

                const label = [
                  `Round ${round}`,
                  `pick ${pickNo} overall`,
                  newOwner ? `traded pick, now owned by ${newOwner}` : null,
                  pick ? `${pick.firstName ?? ""} ${pick.lastName ?? ""}`.trim() : null,
                  pick?.position ?? null,
                  pick?.team ?? null,
                  isYours ? "your pick" : null,
                  isOnClock ? "on the clock" : null,
                  isLast ? "last pick" : null,
                ]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <td
                    key={seat}
                    aria-label={label}
                    className={`px-2 py-2 align-top ${
                      isOnClock
                        ? "bg-brand-cyan/10 ring-1 ring-inset ring-brand-cyan/50"
                        : isYours
                          ? "bg-brand-purple/10 ring-1 ring-inset ring-brand-purple/45"
                          : ""
                    }`}
                  >
                    {/* Meta row: pick number plus the traded-owner flag, kept to a
                        fixed height so the flag never bumps the player name/photo row
                        down. Cells without a flag reserve the same height, so every
                        name in the round lines up. */}
                    <div className="flex min-h-[1.125rem] items-center gap-1">
                      <span className="text-[10px] text-ink-subtle">#{pickNo}</span>
                      {newOwner && (
                        <span
                          aria-hidden="true"
                          title={`Traded pick, now owned by ${newOwner}`}
                          className="ml-auto flex min-w-0 items-center gap-1 rounded-sm border border-brand-cyan/40 bg-brand-cyan/15 px-1 py-px text-[9px] font-semibold text-brand-cyan"
                        >
                          <ArrowLeftRight aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{newOwner}</span>
                        </span>
                      )}
                    </div>
                    {pick ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {/* Player photo (board view only). Decorative here: the cell
                            aria-label already names the player, so the headshot is
                            hidden from the accessibility tree to avoid double reads. */}
                        <span aria-hidden="true" className="shrink-0">
                          <PlayerHeadshot
                            sleeperId={pick.sleeperPlayerId}
                            name=""
                            position={pick.position ?? undefined}
                            size={26}
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{stateText}</span>
                          <span className="block text-[10px] text-ink-subtle">{pick.team ?? ""}</span>
                        </span>
                      </div>
                    ) : (
                      <span className="block font-medium text-ink">{stateText}</span>
                    )}
                    {(isYours || isOnClock || isLast) && (
                      <span className="mt-0.5 block text-[10px] font-semibold text-brand-cyan">
                        {isOnClock ? "On the clock" : isYours ? "Your pick" : "Last pick"}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
