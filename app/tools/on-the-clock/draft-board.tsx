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

import { ArrowLeftRight, User } from "lucide-react";
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
    <div className="mx-auto w-fit max-w-full overflow-x-auto rounded-card border border-line">
      {/* border-separate + page-colored (base) background and spacing puts a thin gap
          in the page's own color between every cell, so the solid drafted tiles read
          as distinct blocks rather than one merged slab. */}
      <table className="border-separate border-spacing-[5px] bg-base text-xs">
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
            <tr key={round}>
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

                // Made cells put the player name on its own line; position, team, and
                // the overall pick number drop to the subtle second line below. Empty
                // (not-on-clock) cells read "Open slot". The on-the-clock cell renders
                // its own big label.
                const stateText = pick ? shortName(pick) : "Open slot";
                const subInfo = pick
                  ? [pick.position, pick.team, `#${pickNo}`].filter(Boolean).join(" · ")
                  : "";

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
                    // A made pick gets a strong solid fill so taken seats read as
                    // obviously filled at a glance: scanning the board, the run of
                    // solid cells stops right at the on-the-clock pick. Your own made
                    // picks deepen the purple highlight; everyone else's made picks use
                    // a clearly lighter neutral block. Open slots stay transparent. The
                    // on-the-clock cell carries the animated gold shine border (CSS).
                    className={`relative px-2.5 ${
                      isOnClock ? "py-2 align-middle" : "pb-2 pt-[31px] align-bottom rounded-[4px]"
                    } ${
                      isOnClock
                        ? "otc-onclock-cell bg-brand-cyan/10"
                        : isYours
                          ? pick
                            ? "bg-brand-purple/30 ring-1 ring-inset ring-brand-purple/60"
                            : "bg-brand-purple/10 ring-1 ring-inset ring-brand-purple/45"
                          : pick
                            ? "bg-line-accent/85"
                            : ""
                    }`}
                  >
                    {isOnClock ? (
                      // One big, centered gold label (no duplicate "On the clock"
                      // line); the shine border around the cell is the CSS class above.
                      <div className="flex min-h-[3.25rem] flex-col items-center justify-center gap-1 text-center">
                        <span className="text-sm font-extrabold uppercase leading-tight tracking-wide text-amber-300">
                          On the clock
                        </span>
                        <span className="text-[10px] font-medium text-ink-subtle">Pick #{pickNo}</span>
                        {newOwner && (
                          <span
                            aria-hidden="true"
                            title={`Traded pick, now owned by ${newOwner}`}
                            className="flex min-w-0 items-center gap-1 rounded-[4px] border border-brand-cyan/40 bg-brand-cyan/15 px-1 py-px text-[9px] font-semibold text-brand-cyan"
                          >
                            <ArrowLeftRight aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{newOwner}</span>
                          </span>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Pinned top corners, out of flow so they never shift the
                            content: pick number (plus a small user icon when it's your
                            pick, replacing the old "Your pick" text since the cell is
                            already highlighted) top-left, traded-owner flag top-right.
                            The cell is align-bottom, so the player content sits in the
                            bottom-left and the eye follows straight down a column. */}
                        <span className="absolute left-1.5 top-1 flex items-center gap-1 text-[10px] font-medium text-ink-subtle">
                          #{pickNo}
                          {isYours && (
                            <User aria-hidden="true" className="h-3 w-3 text-brand-purple" />
                          )}
                        </span>
                        {newOwner && (
                          <span
                            aria-hidden="true"
                            title={`Traded pick, now owned by ${newOwner}`}
                            className="absolute right-1 top-1 flex min-w-0 max-w-[60%] items-center gap-1 rounded-[4px] border border-brand-cyan/40 bg-brand-cyan/15 px-1 py-px text-[9px] font-semibold text-brand-cyan"
                          >
                            <ArrowLeftRight aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{newOwner}</span>
                          </span>
                        )}
                        {pick ? (
                          <div className="flex items-center gap-2">
                            {/* Player photo (board view only). Decorative here: the
                                cell aria-label already names the player, so the headshot
                                is hidden from the accessibility tree. */}
                            <span
                              aria-hidden="true"
                              className="shrink-0 [&_img]:!rounded-[4px] [&_span]:!rounded-[4px]"
                            >
                              <PlayerHeadshot
                                sleeperId={pick.sleeperPlayerId}
                                name=""
                                position={pick.position ?? undefined}
                                size={26}
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-ink">{stateText}</span>
                              <span className="block truncate text-[10px] text-ink-subtle">
                                {subInfo}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <span className="block font-medium text-ink">{stateText}</span>
                        )}
                        {isLast && (
                          <span className="mt-1 block text-[10px] font-semibold text-brand-cyan">
                            Last pick
                          </span>
                        )}
                      </>
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
