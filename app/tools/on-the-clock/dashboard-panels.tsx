"use client";

/**
 * Supporting cockpit panels for the draft room: at-a-glance status, the sync
 * control with plain-English guidance, and a "best remaining by position" board
 * so the user sees the shape of the pool without clicking around. All read from
 * the shaped draft cache / ranked board; no Sleeper or Supabase calls.
 */

import { Clock } from "lucide-react";
import type { ShapedDraftCache } from "@/lib/on-the-clock/types";
import type { DraftPosition, RankedPlayer } from "./fixtures";
import { Panel, StatReadout } from "./panel";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Room status, styled as a broadcast "on the clock" card (matching the look that
 * used to sit above the Who-to-pick content): a beacon-glow surface, clock badge,
 * the big round.pick treatment, and the on-the-clock team, plus the supporting
 * status / last-pick lines and the Teams / Rounds / Picks readout. Shown in the
 * sidebar on every view, so the redundant Who-to-pick card was removed.
 */
export function DraftRoomStatus({
  draft,
  onTheClockTeam,
  onTheClockRound,
  onTheClockPickInRound,
  onTheClockOverallPickNo,
  isYourTurn,
  lastPickLabel,
  instanceId = "room-status",
}: {
  draft: ShapedDraftCache["draft"];
  onTheClockTeam: string;
  onTheClockRound: number;
  onTheClockPickInRound: number;
  onTheClockOverallPickNo: number;
  isYourTurn: boolean;
  lastPickLabel: string;
  /**
   * Unique per mounted copy. The room renders this panel TWICE (the sticky rail
   * and the full-width board view), and both copies are in the DOM at once
   * because inactive tab panels are hidden rather than unmounted. With one
   * hardcoded id, both sections pointed `aria-labelledby` at the same heading,
   * and the hidden copy owns it: content inside `hidden` is out of the
   * accessibility tree, so the VISIBLE panel could resolve to no name at all.
   */
  instanceId?: string;
}) {
  const statusWord = draft.draftStatus === "drafting" ? "Drafting" : draft.draftStatus ?? "Unknown";
  const onClock = onTheClockOverallPickNo > 0;
  const pickLabel = onClock ? `${pad(onTheClockRound)}.${pad(onTheClockPickInRound)}` : null;

  return (
    <section
      id={instanceId}
      aria-labelledby={`${instanceId}-heading`}
      className="relative scroll-mt-40 overflow-hidden rounded-modal border border-brand-cyan/40 bg-surface/60 p-4 sm:p-5"
      style={{
        boxShadow: "0 0 80px -48px rgba(34, 211, 238, 0.6)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(168, 85, 247, 0.12) 0%, transparent 55%)",
      }}
    >
      {/* Decorative top beacon hairline. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #22D3EE 30%, #A855F7 70%, transparent 100%)",
        }}
      />
      <h2 id={`${instanceId}-heading`} className="sr-only">
        Room status
      </h2>

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-base text-brand-cyan"
        >
          <Clock className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-cyan">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-brand-cyan animate-pulse motion-reduce:animate-none"
            />
            On the clock
          </p>
          {onClock ? (
            <>
              <p className="mt-0.5 flex items-baseline gap-2">
                <span
                  className="bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent sm:text-4xl"
                  style={{ backgroundImage: "linear-gradient(135deg, #22D3EE 0%, #A855F7 100%)" }}
                >
                  {pickLabel}
                </span>
                <span className="text-xs text-ink-muted">overall #{onTheClockOverallPickNo}</span>
              </p>
              <p className="mt-0.5 text-sm">
                {isYourTurn ? (
                  <span className="font-semibold text-brand-cyan">Your pick. You are up.</span>
                ) : (
                  <span className="text-ink-muted">{onTheClockTeam} is on the clock</span>
                )}
              </p>
            </>
          ) : (
            <p className="mt-1 text-lg font-bold text-ink">Draft complete</p>
          )}
        </div>
      </div>

      <dl className="mt-4 space-y-1 border-t border-line/60 pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold text-ink">Status</dt>
          <dd className="text-brand-cyan">{statusWord}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 font-semibold text-ink">Last pick</dt>
          <dd className="min-w-0 truncate text-ink-muted">{lastPickLabel}</dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <StatReadout label="Teams" value={String(draft.settings.teams ?? 0)} accent="ink" />
        <StatReadout label="Rounds" value={String(draft.settings.rounds ?? 0)} accent="ink" />
        <StatReadout label="Picks" value={String(draft.pickCount)} accent="cyan" />
      </dl>
    </section>
  );
}

const POSITION_ORDER: DraftPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export function BestRemainingByPosition({
  players,
  columns = 1,
}: {
  players: RankedPlayer[];
  /** 1 = single stacked list (sidebar). 2 = two columns (board-view top bar), which
   *  keeps the panel short enough to sit beside the room-status card. */
  columns?: 1 | 2;
}) {
  const best = POSITION_ORDER.map((pos) => {
    const top = players
      .filter((p) => p.position === pos)
      .sort((a, b) => b.value - a.value)[0];
    return { pos, top };
  }).filter((r) => r.top);

  const twoCol = columns === 2;

  return (
    <Panel
      id="otc-best-remaining"
      eyebrow="At a glance"
      title="Best remaining by position"
      helper="The top value still available at each spot."
      headingLevel={2}
    >
      <ul
        role="list"
        className={twoCol ? "grid grid-cols-1 gap-x-6 sm:grid-cols-2" : "divide-y divide-line/60"}
      >
        {best.map(({ pos, top }) => (
          <li
            key={pos}
            className={`flex items-center justify-between gap-3 py-2 ${
              twoCol ? "border-b border-line/60" : ""
            }`}
          >
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
