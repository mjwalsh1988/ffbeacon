"use client";

/**
 * The completion sheet (plan 5.4 and 18A.9). The h2 "Your day" is the focus
 * target. The total (in the beacon gradient when any answer reached Long
 * Shot), the settled bonus once there is one, the full field strip with every
 * marker labeled and the record list with faces, the letter tiles the share
 * text encodes, a stats strip in Hurry-Up, the two copy buttons and the next
 * step.
 */

import { RadioTower } from "lucide-react";
import { forwardRef } from "react";
import { FieldStrip } from "@/components/long-shot/field-strip";
import { CopyLinkButton } from "@/components/copy-link-button";
import { CopyTextButton } from "@/components/copy-text-button";
import { trackEvent } from "@/lib/analytics";
import { buildShareText } from "@/lib/long-shot/share";
import { MISS_STYLE, TIER_STYLE } from "@/lib/long-shot/tier-style";
import { MISS_LETTER, TIER_LETTERS, type CompletedDto, type Tier } from "@/lib/long-shot/types";
import { stripRecords } from "./strip-records";

function Tile({ tier }: { tier: Tier | null }) {
  const style = tier ? TIER_STYLE[tier] : null;
  return (
    <li
      className={`flex h-14 w-14 items-center justify-center rounded-xl border-2 text-2xl font-black ${
        style ? `${style.border} ${style.tint}` : MISS_STYLE.border
      }`}
    >
      <span className={style ? style.text : MISS_STYLE.text}>
        {tier ? TIER_LETTERS[tier] : MISS_LETTER}
        <span className="sr-only">, {style ? style.word : "miss"}</span>
      </span>
    </li>
  );
}

function Figure({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-4xl font-black leading-none tracking-tight tabular-nums text-ink">
        {value}
        <span className="sr-only"> {unit}</span>
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
    </div>
  );
}

export const CompletionPanel = forwardRef<
  HTMLHeadingElement,
  {
    completed: CompletedDto;
    filmRoomEnabled: boolean;
    busy: boolean;
    onFilmRoom: () => void;
    onBack: () => void;
  }
>(function CompletionPanel({ completed, filmRoomEnabled, busy, onFilmRoom, onBack }, headingRef) {
  const a = completed.attempt;
  const hurry = a.mode === "hurry_up";
  const tiers: Array<Tier | null> = [];
  for (let pos = 1; pos <= a.promptCount; pos++) tiers.push(a.answers.find((x) => x.position === pos)?.tier ?? null);
  const anyLongShot = tiers.includes("long_shot");
  const share = buildShareText(tiers, a.basePoints, a.settled ? a.bonusPoints : 0, a.gameDate);

  return (
    <section aria-labelledby="ls-your-day">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle">Day complete</p>
      <h2
        id="ls-your-day"
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 text-2xl font-bold text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
      >
        Your day
      </h2>
      <p
        className={`mt-4 text-7xl font-black leading-none tracking-tight tabular-nums sm:text-8xl ${
          anyLongShot ? "bg-beacon bg-clip-text text-transparent" : "text-ink"
        }`}
      >
        {a.basePoints}
        <span className="sr-only"> points</span>
      </p>
      {a.settled && a.bonusPoints > 0 && (
        <p className="mt-3 inline-flex items-center gap-2 text-base font-semibold text-brand-cyan">
          <RadioTower aria-hidden="true" className="h-5 w-5" />+{a.bonusPoints} Lone Signal
        </p>
      )}

      <div className="mt-6">
        <FieldStrip records={stripRecords(a.answers, a.promptCount)} total={a.basePoints} labelMarkers showHeadshots />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">Your letters</h3>
        <ol className="mt-3 flex flex-wrap gap-2" aria-label="Tier letters in prompt order">
          {tiers.map((t, i) => (
            <Tile key={i} tier={t} />
          ))}
        </ol>
      </div>

      {hurry ? (
        <div className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
          <Figure value={completed.rank ? `#${completed.rank}` : "-"} unit="today's rank" label="Today's rank" />
          <Figure value={String(completed.currentStreak ?? 0)} unit="day streak" label="Streak" />
          <Figure value={String(completed.bestDayPoints ?? a.basePoints)} unit="points, best day" label="Best day" />
        </div>
      ) : (
        <p className="mt-6 border-t border-line pt-5 text-sm text-ink-muted">Practice round. Nothing was recorded.</p>
      )}
      {hurry && (
        <p className="mt-4 text-sm text-ink-muted">
          Lone Signal bonuses are settled overnight; check back tomorrow.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-start gap-3 border-t border-line pt-5">
        <CopyTextButton
          text={share}
          label="Copy result"
          ariaLabel="Copy your Long Shot result as text"
          noun="Result"
          onCopied={() => trackEvent("long_shot_share", { method: "copy_text" })}
        />
        <CopyLinkButton
          href="/games/long-shot"
          ariaLabel="Copy the Long Shot page link"
          label="Copy page link"
          onCopied={() => trackEvent("long_shot_share", { method: "copy_link" })}
        />
      </div>
      <pre className="mt-3 whitespace-pre-wrap rounded-card border border-line bg-base/60 p-3 font-mono text-xs text-ink-muted">
        {share}
      </pre>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {hurry && filmRoomEnabled && (
          <button
            type="button"
            disabled={busy}
            onClick={onFilmRoom}
            className="inline-flex h-12 items-center justify-center rounded-card border-2 border-brand-purple px-5 text-sm font-bold text-ink hover:bg-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple disabled:opacity-60"
          >
            Replay today in Film Room
          </button>
        )}
        {!hurry && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onBack}
              className="inline-flex h-12 items-center justify-center rounded-card border border-line px-5 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Back
            </button>
            {filmRoomEnabled && (
              <button
                type="button"
                disabled={busy}
                onClick={onFilmRoom}
                className="inline-flex h-12 items-center justify-center rounded-card border-2 border-brand-purple px-5 text-sm font-bold text-ink hover:bg-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple disabled:opacity-60"
              >
                Play again in Film Room
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
});
