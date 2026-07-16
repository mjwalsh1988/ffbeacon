/**
 * Score meter: a visual readout of remaining signal strength (plan sections
 * 4, 13, 21, 26). Pure presentational, mirrors the aria-hidden bar + sr-only
 * summary sentence pattern from app/tools/signal-check/trade-margin-graph.tsx.
 * No hooks needed; the caller (signal-scout-client.tsx) owns all state.
 */

import { Flame } from "lucide-react";

export interface ScoreMeterProps {
  score: number;
  startingScore: number;
  burned: boolean;
}

export function ScoreMeter({ score, startingScore, burned }: ScoreMeterProps) {
  const rawPct = startingScore > 0 ? (score / startingScore) * 100 : 0;
  const clampedPct = Math.min(Math.max(rawPct, 0), 100);
  // Zero must look empty (no floor); any score above zero gets a floor so a
  // sliver of fill stays visible, matching the house pattern in
  // trade-margin-graph.tsx.
  const fillPct = burned ? 0 : clampedPct === 0 ? 0 : Math.max(clampedPct, 4);

  // The travelling-current animation runs only while there is signal left to
  // carry it. A burned-out or zeroed meter has no fill to draw it in anyway,
  // and a dead signal should read as dead rather than still humming.
  // See the .scout-current block in app/globals.css.
  const live = !burned && fillPct > 0;

  const summary = burned
    ? "Score zero. The signal has burned out; this round can no longer score."
    : `Score ${score} of ${startingScore} points remaining. The signal burns out at zero.`;

  return (
    <div className="mt-6 rounded-card border border-line bg-base/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p
          className={`text-xs font-semibold uppercase tracking-[0.16em] ${
            burned ? "text-signal-danger" : "text-ink-subtle"
          }`}
        >
          {burned ? "Signal strength, burned out" : "Signal strength"}
        </p>
        <span className="font-mono text-xs font-semibold tabular-nums text-ink">
          {score.toLocaleString("en-US")} / {startingScore.toLocaleString("en-US")}
        </span>
      </div>

      <div
        aria-hidden="true"
        className={`relative mt-3 h-3.5 w-full overflow-hidden rounded-full bg-line/60 ${
          burned ? "border border-signal-danger/40" : ""
        }`}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-10 w-0.5 bg-signal-danger"
        />
        {/* overflow-hidden so the current layers clip to the fill's own pill
            shape instead of squaring off its leading edge. */}
        <span
          className={`absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-500 motion-reduce:transition-none ${
            live ? "scout-current" : ""
          }`}
          style={{
            width: `${fillPct}%`,
            backgroundImage: "linear-gradient(90deg, #7C3AED 0%, #A855F7 45%, #22D3EE 100%)",
          }}
        />
      </div>

      <div aria-hidden="true" className="mt-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] text-signal-danger">
          <Flame aria-hidden="true" className="h-3 w-3 shrink-0" />
          0, burn point
        </span>
        <span className="text-[10px] text-ink-subtle">{startingScore.toLocaleString("en-US")}</span>
      </div>

      <p className="sr-only">{summary}</p>
    </div>
  );
}
