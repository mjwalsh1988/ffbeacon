"use client";

/**
 * Supporting cockpit panels for the draft room: at-a-glance status, the sync
 * control with plain-English guidance, and a "best remaining by position" board
 * so the user sees the shape of the pool without clicking around. All read from
 * the shaped draft cache / ranked board; no Sleeper or Supabase calls.
 */

import type { ShapedDraftCache } from "@/lib/on-the-clock/types";
import type { DraftPosition, RankedPlayer } from "./fixtures";
import { Panel, StatReadout } from "./panel";

export function DraftRoomStatus({
  draft,
  onTheClockTeam,
  onTheClockPickLabel,
  isYourTurn,
  lastPickLabel,
}: {
  draft: ShapedDraftCache["draft"];
  onTheClockTeam: string;
  onTheClockPickLabel: string;
  isYourTurn: boolean;
  lastPickLabel: string;
}) {
  const statusWord = draft.draftStatus === "drafting" ? "Drafting" : draft.draftStatus ?? "Unknown";
  return (
    <Panel id="room-status" eyebrow="Draft room" title="Room status" headingLevel={2} className="scroll-mt-40">
      <p className="text-sm text-ink">
        <span className="font-semibold">Status:</span>{" "}
        <span className="text-brand-cyan">{statusWord}</span>
      </p>
      <p className="mt-1 text-sm text-ink">
        <span className="font-semibold">On the clock:</span>{" "}
        {isYourTurn ? (
          <span className="font-semibold text-brand-cyan">You</span>
        ) : (
          <span className="text-ink-muted">
            {onTheClockTeam} ({onTheClockPickLabel})
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-ink">
        <span className="font-semibold">Last pick:</span>{" "}
        <span className="text-ink-muted">{lastPickLabel}</span>
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <StatReadout label="Teams" value={String(draft.settings.teams ?? 0)} accent="ink" />
        <StatReadout label="Rounds" value={String(draft.settings.rounds ?? 0)} accent="ink" />
        <StatReadout label="Picks" value={String(draft.pickCount)} accent="cyan" />
      </dl>
    </Panel>
  );
}

const POSITION_ORDER: DraftPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export function BestRemainingByPosition({ players }: { players: RankedPlayer[] }) {
  const best = POSITION_ORDER.map((pos) => {
    const top = players
      .filter((p) => p.position === pos)
      .sort((a, b) => b.value - a.value)[0];
    return { pos, top };
  }).filter((r) => r.top);

  return (
    <Panel
      id="otc-best-remaining"
      eyebrow="At a glance"
      title="Best remaining by position"
      helper="The top value still available at each spot."
      headingLevel={2}
    >
      <ul role="list" className="divide-y divide-line/60">
        {best.map(({ pos, top }) => (
          <li key={pos} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2">
              <span className="w-9 shrink-0 rounded-card border border-line bg-base px-1.5 py-0.5 text-center text-[11px] font-bold text-ink-muted">
                {pos}
              </span>
              <span className="truncate text-sm font-medium text-ink">{top!.name}</span>
            </span>
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-brand-purple">
              {top!.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
