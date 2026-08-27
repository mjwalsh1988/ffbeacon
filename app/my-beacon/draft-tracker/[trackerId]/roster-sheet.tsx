"use client";

/**
 * The rosters, on anything narrower than a desktop.
 *
 * From xl up there is a second column: your team sits in the page rail beside
 * the board, and the rest of the room sits under it. Below xl neither of those
 * places exists without pushing the board down the page, and a roster you have
 * to scroll past the entire board to reach is a roster you do not look at
 * during a draft.
 *
 * So below xl it becomes a bottom sheet behind one bar that leads the board and
 * re-attaches under the site header once you scroll past it. That bar is the
 * shared MobileNavDock, the same control League Pulse and the player profile
 * use for their sections, so a reader who has met it once has met it here.
 *
 * TWO TABS, NOT TWO SHEETS. Your team and everybody else are the same kind of
 * thing looked at from two sides, and a drafter flips between them constantly:
 * what do I still need, and who is gone. One sheet with a real tablist keeps
 * that flip to a single key press, where two separate sheets would mean closing
 * one and opening the other.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { MobileNavDock } from "@/components/mobile-nav-dock";
import { TeamRosters, type RosterEntry, type RosterGroup } from "./team-rosters";

type TabId = "mine" | "others";

export function RosterSheet({
  myGroup,
  otherGroups,
  sourceLabel,
  canReassign,
  onUndo,
  onReassign,
  busyPlayerIds,
}: {
  myGroup: RosterGroup;
  otherGroups: RosterGroup[];
  sourceLabel: string;
  canReassign: boolean;
  onUndo: (playerId: string, name: string) => void;
  onReassign: (entry: RosterEntry, currentSlot: number | null) => void;
  busyPlayerIds: Set<string>;
}) {
  const baseId = useId();
  const [tab, setTab] = useState<TabId>("mine");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const myCount = myGroup.entries.length;
  const otherCount = otherGroups.reduce((sum, group) => sum + group.entries.length, 0);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "mine", label: "Your team", count: myCount },
    { id: "others", label: "Off the board", count: otherCount },
  ];

  // Memoized so the memo on TeamRosters can actually hold: a fresh array every
  // render would re-reconcile every roster row on every pick.
  const mineOnly = useMemo(() => [myGroup], [myGroup]);
  const shownGroups = tab === "mine" ? mineOnly : otherGroups;

  /**
   * Arrow keys move between tabs and take focus with them, which is what the
   * tab pattern promises. Home and End jump to the ends. Tab itself leaves the
   * tablist and lands in the panel, because only the selected tab is in the tab
   * order.
   */
  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = tabs.length - 1;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
      else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      if (next === null) return;
      event.preventDefault();
      const id = tabs[next].id;
      setTab(id);
      tabRefs.current[id]?.focus();
    },
    [tabs],
  );

  const summary =
    otherCount === 0
      ? `${myCount} on your team so far.`
      : `${myCount} on your team, ${otherCount} gone to the rest of the room.`;

  return (
    <MobileNavDock
      hideAboveClass="xl:hidden"
      className="mb-4"
      menus={[
        {
          key: "rosters",
          eyebrow: "Rosters",
          currentLabel: `Your team (${myCount})`,
          heading: "Rosters",
          summary,
          icon: "listChecks",
          content: (
            // No padding of its own: MobileNavDock already pads the sheet body.
            <div>
              <div
                role="tablist"
                aria-label="Which roster to show"
                className="flex gap-1.5 rounded-card border border-line bg-base/60 p-1"
              >
                {tabs.map((entry, index) => {
                  const selected = tab === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      id={`${baseId}-tab-${entry.id}`}
                      aria-selected={selected}
                      aria-controls={`${baseId}-panel-${entry.id}`}
                      tabIndex={selected ? 0 : -1}
                      ref={(node) => {
                        tabRefs.current[entry.id] = node;
                      }}
                      onClick={() => setTab(entry.id)}
                      onKeyDown={(event) => onTabKeyDown(event, index)}
                      className={`min-h-11 flex-1 rounded-card px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                        selected
                          ? "bg-brand-cyan/15 text-brand-cyan"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      <span aria-hidden="true">
                        {entry.label} ({entry.count})
                      </span>
                      <span className="sr-only">
                        {entry.label}, {entry.count}{" "}
                        {entry.count === 1 ? "player" : "players"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div
                role="tabpanel"
                id={`${baseId}-panel-${tab}`}
                aria-labelledby={`${baseId}-tab-${tab}`}
                tabIndex={0}
                className="mt-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {shownGroups.length === 0 ? (
                  <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-sm text-ink-muted">
                    Nobody is off the board yet.
                  </p>
                ) : (
                  <TeamRosters
                    groups={shownGroups}
                    sourceLabel={sourceLabel}
                    canReassign={canReassign}
                    onUndo={onUndo}
                    onReassign={onReassign}
                    busyPlayerIds={busyPlayerIds}
                  />
                )}
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}
