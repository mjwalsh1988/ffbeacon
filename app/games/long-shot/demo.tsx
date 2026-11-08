"use client";

/**
 * The signed-out demo (plan 11 and 18A.12). Three fixed prompts from the 2024
 * season, run entirely in the browser against data shipped in code: no
 * network call, no database, nothing from today's puzzle. A signed-in reader
 * never sees it.
 *
 * It opens with a choice shaped like the real mode picker, "With the clock"
 * or "No clock", made before any prompt is shown (signed-out visitors have no
 * Film Room). The player control is a native select, fully keyboard and
 * screen reader operable with no custom code. It is fenced as a sample in
 * words, not only styling: the ribbon, the badge, the heading and the lead.
 */

import Link from "next/link";
import { Clock, Hourglass } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FieldStrip, type StripRecord } from "@/components/long-shot/field-strip";
import { Stage } from "@/components/long-shot/stage";
import { TierChip } from "@/components/long-shot/tier-chip";
import { PlayerHeadshot } from "@/components/player-headshot";
import { DEMO_PROMPTS, scoreDemo } from "@/lib/long-shot/demo";
import { DEFAULT_LONG_SHOT_SETTINGS } from "@/lib/long-shot/default-settings";
import { MISS_STYLE, TIER_STYLE } from "@/lib/long-shot/tier-style";
import { TIER_WORDS, type Tier } from "@/lib/long-shot/types";
import { Countdown } from "./countdown";

const POINTS = DEFAULT_LONG_SHOT_SETTINGS.tiers.points;
const LIMIT = DEFAULT_LONG_SHOT_SETTINGS.timer.seconds;

interface DemoResult {
  position: number;
  sleeperId: string | null;
  name: string | null;
  tier: Tier | null;
  points: number;
  timedOut: boolean;
}

function sentence(r: DemoResult): string {
  if (r.timedOut) return "Time ran out. 0 points.";
  if (!r.tier) return `${r.name} is not an answer to this prompt. 0 points.`;
  return `${r.name}: ${TIER_WORDS[r.tier]}, ${r.points} points.`;
}

export function LongShotDemo() {
  const [timed, setTimed] = useState<boolean | null>(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<DemoResult[]>([]);
  const [phase, setPhase] = useState<"prompt" | "result" | "done">("prompt");
  const [choice, setChoice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectId = useId();
  const headingId = useId();

  useEffect(() => {
    if (timed !== null) headingRef.current?.focus();
  }, [timed, index, phase]);

  const prompt = DEMO_PROMPTS[index];
  const total = results.reduce((s, r) => s + r.points, 0);

  function submit(timedOut: boolean) {
    const sleeperId = timedOut ? null : choice || null;
    const name = sleeperId ? (prompt.candidates.find((c) => c.sleeperId === sleeperId)?.name ?? null) : null;
    const tier = sleeperId ? scoreDemo(prompt, sleeperId) : null;
    const r: DemoResult = {
      position: index + 1,
      sleeperId,
      name,
      tier,
      points: tier ? POINTS[tier] : 0,
      timedOut,
    };
    setResults((prev) => [...prev, r]);
    setPhase("result");
    setAnnouncement(sentence(r));
  }

  function next() {
    setChoice("");
    if (index + 1 >= DEMO_PROMPTS.length) {
      setPhase("done");
      setAnnouncement(`Demo complete. ${total} points.`);
      return;
    }
    setIndex(index + 1);
    setPhase("prompt");
  }

  function restart() {
    setTimed(null);
    setIndex(0);
    setResults([]);
    setPhase("prompt");
    setChoice("");
  }

  const records: StripRecord[] = DEMO_PROMPTS.map((_, i) => {
    const r = results[i];
    return r
      ? {
          position: i + 1,
          tier: r.tier,
          points: r.points,
          playerName: r.name,
          sleeperId: r.sleeperId,
          state: r.timedOut ? "timed_out" : "answered",
        }
      : { position: i + 1, tier: null, points: 0, playerName: null, pending: true, state: "pending" };
  });
  const last = results[results.length - 1];

  return (
    <Stage ribbon="Sample" labelledBy={headingId}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <span className="inline-block rounded-full border border-[#F59E0B] px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#F59E0B]">
        Sample
      </span>
      <h2 id={headingId} className="mt-3 pr-16 text-2xl font-bold text-ink">
        Demo: three prompts from the 2024 season, not today&apos;s puzzle
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Try the game on three settled questions. Nothing here is saved, and none of it is from today&apos;s five.
      </p>

      {timed === null ? (
        <div role="group" aria-label="Choose how to play the demo" className="mt-6 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setTimed(true)}
            className="flex min-h-[120px] w-full flex-col items-start gap-2 rounded-[20px] border-2 border-brand-cyan bg-base/60 p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <Clock aria-hidden="true" className="h-7 w-7 text-brand-cyan" />
            <span className="text-2xl font-black text-ink">With the clock</span>
            <span className="text-sm text-ink-muted">{LIMIT} seconds a prompt, like Hurry-Up.</span>
          </button>
          <button
            type="button"
            onClick={() => setTimed(false)}
            className="flex min-h-[120px] w-full flex-col items-start gap-2 rounded-[20px] border-2 border-brand-purple bg-base/60 p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple"
          >
            <Hourglass aria-hidden="true" className="h-7 w-7 text-brand-purple" />
            <span className="text-2xl font-black text-ink">No clock</span>
            <span className="text-sm text-ink-muted">Take as long as you like.</span>
          </button>
        </div>
      ) : phase === "done" ? (
        <div className="mt-6">
          <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan">
            Your demo day
          </h3>
          <p className="mt-3 text-7xl font-black leading-none tracking-tight tabular-nums text-ink">
            {total}
            <span className="sr-only"> points</span>
          </p>
          <div className="mt-6">
            <FieldStrip records={records} total={total} labelMarkers showHeadshots />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login?next=/games/long-shot"
              className="inline-flex h-12 items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in to play today&apos;s five
            </Link>
            <button
              type="button"
              onClick={restart}
              className="inline-flex h-12 items-center justify-center rounded-card border border-line px-5 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Play the demo again
            </button>
          </div>
        </div>
      ) : phase === "result" && last ? (
        <section className="mt-6" aria-labelledby={`${headingId}-result`}>
          <h3
            id={`${headingId}-result`}
            ref={headingRef}
            tabIndex={-1}
            className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            Result for prompt {last.position}
          </h3>
          <div className="mt-4 flex items-center gap-4">
            {last.sleeperId ? (
              <span className="rounded-lg p-[3px]" style={{ background: last.tier ? TIER_STYLE[last.tier].hex : MISS_STYLE.hex }}>
                <PlayerHeadshot sleeperId={last.sleeperId} name="" size={72} className="block" />
              </span>
            ) : (
              <span className="h-[78px] w-[78px] rounded-lg border-2 border-dashed border-line-accent" />
            )}
            <div>
              <p className={`text-6xl font-black leading-none tracking-tight tabular-nums ${last.tier ? TIER_STYLE[last.tier].text : "text-ink-subtle"}`}>
                {last.points}
                <span className="sr-only"> points</span>
              </p>
              <div className="mt-2">
                <TierChip tier={last.tier} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-base text-ink">{sentence(last)}</p>
          <div className="mt-5">
            <FieldStrip records={records} total={total} flight={last.tier ? { position: last.position, tier: last.tier, team: null } : null} />
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            In the real game this line shows how many players gave the same answer today.
          </p>
          <div className="mt-5 flex sm:justify-end">
            <button
              type="button"
              onClick={next}
              className="inline-flex h-12 w-full items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
            >
              {index + 1 >= DEMO_PROMPTS.length ? "See your demo day" : "Next"}
            </button>
          </div>
        </section>
      ) : (
        <div className="mt-6">
          <div className="flex items-start justify-between gap-4">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle">
              Prompt {index + 1} of {DEMO_PROMPTS.length}, {timed ? "with the clock" : "no clock"}
            </p>
            {timed && (
              <Countdown
                key={`demo-${index}`}
                remainingMs={LIMIT * 1000}
                limitSeconds={LIMIT}
                position={index + 1}
                promptCount={DEMO_PROMPTS.length}
                onExpire={() => submit(true)}
              />
            )}
          </div>
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 text-2xl font-semibold leading-snug tracking-tight text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan sm:text-3xl"
          >
            {prompt.text}
          </h3>
          <div className="mt-6 border-t border-line pt-6">
            <label htmlFor={selectId} className="block text-sm font-medium text-ink">
              Choose a player
            </label>
            <select
              id={selectId}
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm"
            >
              <option value="">Select a player</option>
              {prompt.candidates.map((c) => (
                <option key={c.sleeperId} value={c.sleeperId}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!choice}
              onClick={() => submit(false)}
              className="mt-4 inline-flex h-12 items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
            >
              Answer
            </button>
          </div>
        </div>
      )}
    </Stage>
  );
}
