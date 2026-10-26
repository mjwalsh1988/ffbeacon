"use client";

/**
 * The true points board: every player, rostered or not, overall and by
 * position.
 *
 * Follows the Season Pulse leaders board's contract (components/season-pulse/
 * leaders-board.tsx): real buttons with aria-pressed in a named group, a check
 * mark beside the color on the selected one, one polite live region saying
 * what the list now shows, and "Show more" moving focus to the first row it
 * revealed so focus never falls to the page body.
 *
 * Switching position is local state rather than a navigation: every board is
 * already in hand, and a round trip per tap would recompute the whole page.
 */

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { positionNoun } from "@/lib/site";
import type {
  LeaderboardPosition,
  LeaderboardTeam,
  PlayerLeader,
} from "@/lib/league-leaderboards/types";
import { LIST_CLASS, LeaderRow } from "./leader-row";
import { OwnershipLegend } from "./ownership-strip";

type Tab = LeaderboardPosition | "ALL";

const CONTROL =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const ON = "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan";
const OFF = "border-line bg-surface/70 text-ink-muted hover:border-line-accent hover:text-ink";

const FIRST_PAGE = 10;

export function PlayerBoard({
  boards,
  positions,
  teams,
  viewerRosterId,
  scopeLabel,
}: {
  boards: { all: PlayerLeader[] } & Partial<Record<LeaderboardPosition, PlayerLeader[]>>;
  positions: LeaderboardPosition[];
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
  /** "this season" or "in week 6". */
  scopeLabel: string;
}) {
  const [tab, setTab] = useState<Tab>("ALL");
  const [shown, setShown] = useState(FIRST_PAGE);
  const listRef = useRef<HTMLOListElement>(null);
  const focusIndex = useRef<number | null>(null);

  const rows = (tab === "ALL" ? boards.all : boards[tab]) ?? [];
  const page = rows.slice(0, shown);
  const noun = tab === "ALL" ? "players" : positionNoun(tab, "plural");
  const status =
    rows.length === 0
      ? `No ${noun} have played a settled week ${scopeLabel}.`
      : `Showing the top ${page.length} ${noun} ${scopeLabel}.`;

  useEffect(() => {
    if (focusIndex.current === null) return;
    // The row's name link, or the row itself for a player with no profile
    // page. Without the fallback focus would fall to the page body, because
    // the button that was pressed has just unmounted.
    const row = listRef.current?.querySelectorAll<HTMLElement>(":scope > li")[focusIndex.current];
    focusIndex.current = null;
    if (!row) return;
    const link = row.querySelector<HTMLElement>("a");
    if (link) {
      link.focus();
    } else {
      row.tabIndex = -1;
      row.focus();
    }
  }, [shown]);

  const tabs: { key: Tab; label: string; spoken: string }[] = [
    { key: "ALL", label: "All", spoken: "" },
    ...positions.map((p) => ({ key: p as Tab, label: p, spoken: positionNoun(p, "plural") })),
  ];

  return (
    <div>
      {/* One row that scrolls sideways on a phone rather than wrapping into a
          block of buttons three lines tall. */}
      <div
        role="group"
        aria-label="Position"
        className="beacon-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setShown(FIRST_PAGE);
            }}
            className={`${CONTROL} ${tab === t.key ? ON : OFF}`}
          >
            {tab === t.key && <Check aria-hidden="true" className="mr-1 h-3.5 w-3.5" />}
            {/* The visible abbreviation stays in the name (WCAG 2.5.3), so a
                speech user can say "QB"; the word follows it for the ear. */}
            {t.label}
            {t.spoken && <span className="sr-only">, {t.spoken}</span>}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" aria-live="polite" className="text-xs text-ink-muted">
          {status}
        </p>
        <OwnershipLegend />
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
          Nobody at this position has played a settled week yet.
        </p>
      ) : (
        <ol ref={listRef} role="list" aria-label={`Points leaders, ${noun}`} className={`mt-3 ${LIST_CLASS}`}>
          {page.map((leader) => (
            <LeaderRow
              key={leader.player.sleeperId}
              leader={leader}
              teams={teams}
              viewerRosterId={viewerRosterId}
              leaderPoints={rows[0]?.points ?? 0}
            />
          ))}
        </ol>
      )}

      {rows.length > shown && (
        <button
          type="button"
          onClick={() => {
            focusIndex.current = shown;
            setShown(rows.length);
          }}
          className={`mt-3 w-full ${CONTROL} ${OFF}`}
        >
          Show the top {rows.length}
        </button>
      )}
    </div>
  );
}
