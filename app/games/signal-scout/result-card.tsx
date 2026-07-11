/**
 * Result reveal card: the four completed-round outcomes (won, solved_late,
 * failed, skipped), modeled on ResultHero in
 * app/tools/signal-check/trade-result.tsx (eyebrow + headline + gradient
 * numeral layout, tone-by-outcome border/glow, Chip-style readouts). Pure
 * presentational; the caller (signal-scout-client.tsx) owns focus management
 * for the id below.
 */

import { BadgeCheck } from "lucide-react";
import type { CompletedRoundDto } from "@/lib/signal-scout/round-engine";
import { PlayerHeadshot } from "@/components/player-headshot";
import { ClueGrid } from "./clue-grid";
import { BadReads } from "./bad-reads";

const BEACON_GRADIENT = "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)";

interface Tone {
  border: string;
  glow: string;
  eyebrowClass: string;
  headline: string;
  headlineClass: string;
  subline: string;
}

function buildTones(maxWrongGuesses: number): Record<CompletedRoundDto["status"], Tone> {
  const failedSubline =
    maxWrongGuesses === 3
      ? "Three Bad Reads. The signal is gone."
      : `${maxWrongGuesses} Bad Reads. The signal is gone.`;

  return {
    won: {
      border: "border-brand-cyan/50",
      glow: "rgba(34, 211, 238, 0.18)",
      eyebrowClass: "text-brand-cyan",
      headline: "Signal Found",
      headlineClass: "",
      subline: "Clean decode. The signal is yours.",
    },
    solved_late: {
      border: "border-signal-warning/40",
      glow: "rgba(245, 158, 11, 0.16)",
      eyebrowClass: "text-signal-warning",
      headline: "Signal Found Too Late",
      headlineClass: "text-signal-warning",
      subline: "The signal burned out before you decoded it. No points, and your Signal Streak resets.",
    },
    failed: {
      border: "border-signal-danger/40",
      glow: "rgba(239, 68, 68, 0.16)",
      eyebrowClass: "text-signal-danger",
      headline: "Signal Lost",
      headlineClass: "text-signal-danger",
      subline: failedSubline,
    },
    skipped: {
      border: "border-line",
      glow: "rgba(148, 163, 184, 0.10)",
      eyebrowClass: "text-ink-subtle",
      headline: "Signal Skipped",
      headlineClass: "text-ink",
      subline: "Round closed, no score. Your Signal Streak resets.",
    },
  };
}

export interface ResultCardProps {
  round: CompletedRoundDto;
  showPlayerImages: boolean;
  streaks: { signalStreak: number; dailyStreak: number };
}

export function ResultCard({ round, showPlayerImages, streaks }: ResultCardProps) {
  const tones = buildTones(round.maxWrongGuesses);
  const tone = tones[round.status];
  const isWon = round.status === "won";
  const cleanRead = isWon && round.wrongGuesses === 0;

  const revealedKeys = new Set(round.revealedClues.map((c) => c.clueKey));
  const unseenKeys = round.allClues
    .filter((c) => !revealedKeys.has(c.clueKey))
    .map((c) => c.clueKey);

  // Result states announce assertively (plan section 26: role="alert").
  // This node mounts exactly once with the card; the client root deliberately
  // does NOT also announce completion on its polite region.
  const alertText = `${tone.headline}. The player was ${round.target.name}.${
    isWon ? ` ${round.scoreAwarded} points banked.` : ""
  }`;

  return (
    <div
      className={`relative overflow-hidden rounded-modal border ${tone.border} bg-surface p-5 sm:p-6 ${
        isWon ? "shadow-[0_0_80px_-40px_rgba(34,211,238,0.6)]" : ""
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
        style={{
          background: `radial-gradient(circle, ${tone.glow} 0%, transparent 70%)`,
        }}
      />

      <p role="alert" className="sr-only">
        {alertText}
      </p>

      <div className="relative">
        <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${tone.eyebrowClass}`}>
          Round complete
        </p>

        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h3
            id="signal-scout-result-heading"
            tabIndex={-1}
            aria-label={tone.headline}
            className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
          >
            {isWon ? (
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: BEACON_GRADIENT }}>
                {tone.headline}
              </span>
            ) : (
              <span className={tone.headlineClass}>{tone.headline}</span>
            )}
          </h3>

          <div className="shrink-0 sm:text-right">
            {isWon ? (
              <p
                className="bg-clip-text text-4xl font-bold tabular-nums text-transparent sm:text-5xl"
                style={{ backgroundImage: BEACON_GRADIENT }}
              >
                {round.scoreAwarded.toLocaleString("en-US")}
              </p>
            ) : (
              <p className="text-4xl font-bold tabular-nums text-ink-subtle sm:text-5xl">0</p>
            )}
            <p className="text-xs text-ink-subtle">{isWon ? "points banked" : "no score"}</p>
          </div>
        </div>

        <p className="mt-2 text-sm text-ink-muted">{tone.subline}</p>

        {cleanRead && (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-3 py-1 text-xs font-semibold text-brand-cyan">
            <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
            Clean Read
          </span>
        )}

        <div className="mt-5 flex items-center gap-3">
          {/* Decorative: the player's name renders as adjacent visible text below. */}
          <PlayerHeadshot
            sleeperId={showPlayerImages ? round.target.sleeperId : null}
            name=""
            size={64}
          />
          <div className="min-w-0">
            <p className="text-lg font-semibold text-ink">{round.target.name}</p>
            <p className="text-sm text-ink-muted">
              {round.target.position}
              {round.target.team ? `, ${round.target.team}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <StreakChip
            label="Signal Streak"
            value={streaks.signalStreak}
            marker={isWon ? "+1" : "reset"}
          />
          <StreakChip label="Daily Scout Streak" value={streaks.dailyStreak} />
        </div>

        <BadReads badReads={round.badReads} />

        <div className="mt-6 border-t border-line pt-5">
          <ClueGrid
            clues={round.allClues}
            heading="Full clue sheet"
            headingId="signal-scout-full-clue-sheet-heading"
            unseenKeys={unseenKeys}
          />
        </div>
      </div>
    </div>
  );
}

function StreakChip({
  label,
  value,
  marker,
}: {
  label: string;
  value: number;
  marker?: "+1" | "reset";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-3 py-1 text-xs">
      <span className="text-ink-subtle">{label}:</span>
      <span className="font-mono font-medium text-ink">{value}</span>
      {marker === "+1" && <span className="text-brand-cyan">+1</span>}
      {marker === "reset" && <span className="text-ink-subtle">reset</span>}
    </span>
  );
}
