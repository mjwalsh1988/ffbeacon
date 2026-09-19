"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import {
  DEADLINE_CALL_LABEL,
  ODDS_BANDS,
  ROSTER_WINDOWS,
  deadlineCall,
  expectedWins,
  oddsBand,
  oddsPercent,
  playoffOdds,
  type RosterWindow,
} from "@/lib/guides/playoff-odds";

/**
 * The interactive pieces of the fantasy football playoffs guide.
 *
 * OddsWorksheet runs the reader's record through lib/guides/playoff-odds.ts,
 * the guide's teaching model, and then through deadlineCall(), the same rule of
 * thumb the grid in Lesson 4 draws. It says in words, above the result, that
 * it is a teaching model and not Power Pulse, because a number that looks like
 * a forecast for a real league will be read as one.
 *
 * FloorOrCeiling is four lineup calls; the reader says whether each one wants
 * the steady option or the streaky one.
 *
 * PlayoffChecklist is the pre-deadline list as real checkboxes. Nothing is
 * stored: a persisted checklist would carry last season's ticks into this one.
 *
 * All of them are native form controls inside fieldsets, so keyboard movement,
 * checked state and each group's name come from the platform. Results sit in
 * short polite live regions so a screen reader hears the change without the
 * focus moving, and no region repeats a paragraph on every change.
 */

/* ---------- Shared ---------- */

function RadioChips<T extends string | number>({
  legend,
  hint,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  hint?: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const hintId = `${name}-hint`;
  return (
    <fieldset aria-describedby={hint ? hintId : undefined}>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs text-ink-subtle">
          {hint}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => {
          const checked = value === opt.value;
          return (
            <label
              key={String(opt.value)}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
                checked
                  ? "border-brand-cyan bg-brand-cyan/10 text-ink"
                  : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={String(opt.value)}
                checked={checked}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              {checked ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 text-brand-cyan"
                />
              ) : (
                <Circle
                  aria-hidden="true"
                  className="h-4 w-4 text-ink-subtle"
                />
              )}
              {opt.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const SELECT_CLASS =
  "mt-1.5 block min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/* ---------- Lesson 2: the odds worksheet ---------- */

const STRENGTH_OPTIONS = [
  { value: 0.35, label: "One of the weakest" },
  { value: 0.45, label: "A bit below average" },
  { value: 0.5, label: "Average" },
  { value: 0.55, label: "A bit above average" },
  { value: 0.65, label: "One of the best" },
];

export function OddsWorksheet() {
  const groupId = useId();
  const [teams, setTeams] = useState(12);
  const [spots, setSpots] = useState(6);
  const [season, setSeason] = useState(14);
  const [played, setPlayed] = useState(6);
  const [wins, setWins] = useState(3);
  const [strength, setStrength] = useState(0.5);
  const [windowKey, setWindowKey] = useState<RosterWindow>("redraft");

  const safePlayed = Math.min(played, season);
  const safeWins = Math.min(wins, safePlayed);
  const safeSpots = Math.min(spots, teams);
  const input = {
    teams,
    playoffSpots: safeSpots,
    seasonWeeks: season,
    weeksPlayed: safePlayed,
    wins: safeWins,
    winChance: strength,
  };
  const odds = playoffOdds(input);
  const pct = oddsPercent(odds);
  const band = oddsBand(odds);
  const bandInfo = ODDS_BANDS.find((b) => b.key === band)!;
  const call = deadlineCall(band, windowKey);
  const exp = expectedWins(input);
  const losses = safePlayed - safeWins;
  const left = season - safePlayed;

  const playedOptions = Array.from({ length: season + 1 }, (_, i) => i);
  const winOptions = Array.from({ length: safePlayed + 1 }, (_, i) => i);

  return (
    <div
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: the playoff odds worksheet
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          A teaching model, not a forecast for your league. It assumes every
          other team is an even bet each week, settles standings ties with a
          coin flip, and knows nothing about your roster beyond the strength you
          pick. Power Pulse is the real version. Nothing is saved.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <RadioChips<number>
            legend="Teams in your league"
            name={`${groupId}-teams`}
            value={teams}
            options={[10, 12, 14].map((n) => ({ value: n, label: String(n) }))}
            onChange={setTeams}
          />
          <RadioChips<number>
            legend="Teams that make the playoffs"
            name={`${groupId}-spots`}
            value={safeSpots}
            options={[4, 6, 7, 8].map((n) => ({ value: n, label: String(n) }))}
            onChange={setSpots}
          />
          <div>
            <label
              htmlFor={`${groupId}-season`}
              className="text-sm font-semibold text-ink"
            >
              Regular-season weeks
            </label>
            <select
              id={`${groupId}-season`}
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {[13, 14, 15].map((n) => (
                <option key={n} value={n}>
                  {n} weeks
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${groupId}-played`}
                className="text-sm font-semibold text-ink"
              >
                Games played
              </label>
              <select
                id={`${groupId}-played`}
                value={safePlayed}
                onChange={(e) => setPlayed(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {playedOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor={`${groupId}-wins`}
                className="text-sm font-semibold text-ink"
              >
                Your wins
              </label>
              <select
                id={`${groupId}-wins`}
                value={safeWins}
                onChange={(e) => setWins(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {winOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <RadioChips<number>
              legend="How good is your team, honestly?"
              hint="Where it ranks on points per week, not on record. Power Pulse's Pts / wk column is the honest answer."
              name={`${groupId}-strength`}
              value={strength}
              options={STRENGTH_OPTIONS}
              onChange={setStrength}
            />
          </div>
          <div className="sm:col-span-2">
            <RadioChips<RosterWindow>
              legend="What kind of roster is it?"
              name={`${groupId}-window`}
              value={windowKey}
              options={ROSTER_WINDOWS.map((w) => ({
                value: w.key,
                label: w.label,
              }))}
              onChange={setWindowKey}
            />
          </div>
        </div>

        {/* Only the one-line result is live. Arrowing through a closed select
            on Windows fires a change per option, and a region holding the
            whole panel would re-read it for every value passed. */}
        <div className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            In this model
          </p>
          <p
            aria-live="polite"
            aria-atomic="true"
            className="mt-1 text-base font-semibold text-ink"
          >
            {safeWins}-{losses}: {pct} percent playoff odds. {bandInfo.label}.{" "}
            <span className="sr-only">
              Deadline call: {DEADLINE_CALL_LABEL[call.call]}.
            </span>
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {left === 0
              ? `The regular season is over at ${safeWins} wins.`
              : `${left} ${left === 1 ? "game" : "games"} left, about ${exp.toFixed(1)} wins expected by the end.`}{" "}
            {safeSpots} of {teams} teams get in.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            <span className="font-semibold">
              Deadline call: {DEADLINE_CALL_LABEL[call.call]}.
            </span>{" "}
            {call.why}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Lesson 7: floor or ceiling ---------- */

type Pick = "floor" | "ceiling";

const QUIZ: { situation: string; answer: Pick; why: string }[] = [
  {
    situation:
      "Semifinal. You are projected for 118 and your opponent for 131. Your flex is a steady back or a receiver who scores big or not at all.",
    answer: "ceiling",
    why: "You are the underdog. A steady lineup lands close to 118 and loses to 131 most weeks. You need the week where things break your way, so take the spread.",
  },
  {
    situation:
      "First round. You are projected for 134 and your opponent for 112. The same flex choice.",
    answer: "floor",
    why: "You are the favorite. The only way you lose is a bad week, so take the player least likely to give you one.",
  },
  {
    situation:
      "Final. You are projected for 127 and your opponent for 119. Your two tight ends project the same: one catches six balls every week, the other scores once every few weeks.",
    answer: "floor",
    why: "You are ahead by eight, so you are the favorite, and the favorite wants fewer surprises. Take the tight end whose bad week is still a decent one.",
  },
  {
    situation:
      "Semifinal. Going into the last game of the week you trail by 20, and your flex has not played yet. You can start a player who averages 12 steady points or one who averages 10 with a few 25-point weeks.",
    answer: "ceiling",
    why: "You need 20 from one player. The steady 12 loses almost every time. Only the player with a 20-point week in him can win it, even though he averages less.",
  },
];

const PICK_LABEL: Record<Pick, string> = {
  floor: "Play for the floor",
  ceiling: "Play for the ceiling",
};

export function FloorOrCeiling() {
  const groupId = useId();
  const [picked, setPicked] = useState<(Pick | null)[]>(() =>
    QUIZ.map(() => null),
  );
  const [lastAnswered, setLastAnswered] = useState<number | null>(null);
  const answered = picked.filter((p) => p !== null).length;
  const correct = picked.filter((p, i) => p === QUIZ[i].answer).length;
  const complete = answered === QUIZ.length;

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Try it: floor or ceiling?
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        Four playoff lineup calls, with invented numbers. Say which way each one
        should lean. Nothing here is saved.
      </p>
      <ol role="list" className="mt-4 space-y-4">
        {QUIZ.map((item, i) => {
          const choice = picked[i];
          const isRight = choice === item.answer;
          return (
            <li key={item.situation}>
              <fieldset>
                <legend className="text-sm font-medium leading-relaxed text-ink">
                  <span className="sr-only">Call {i + 1}: </span>
                  {item.situation}
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["floor", "ceiling"] as const).map((value) => {
                    const checked = choice === value;
                    return (
                      <label
                        key={value}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
                          checked
                            ? "border-brand-cyan bg-brand-cyan/10 text-ink"
                            : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${groupId}-q${i}`}
                          value={value}
                          checked={checked}
                          onChange={() => {
                            setPicked((prev) =>
                              prev.map((p, j) => (j === i ? value : p)),
                            );
                            setLastAnswered(i);
                          }}
                          className="sr-only"
                        />
                        {checked ? (
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-4 w-4 text-brand-cyan"
                          />
                        ) : (
                          <Circle
                            aria-hidden="true"
                            className="h-4 w-4 text-ink-subtle"
                          />
                        )}
                        {PICK_LABEL[value]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {/* Only the verdict is live, so arrowing between the two radios
                  speaks a few words each time rather than the whole reason.
                  The reason follows in reading order for anyone who wants it. */}
              <div
                className={`mt-2 min-h-[1.5rem] rounded-card text-sm leading-relaxed ${
                  choice === null
                    ? ""
                    : `border-l-4 bg-base/60 px-3 py-2 ${
                        isRight
                          ? "border-brand-cyan/60"
                          : "border-brand-purple/60"
                      }`
                }`}
              >
                <p
                  aria-live="polite"
                  aria-atomic="true"
                  className="font-semibold text-ink"
                >
                  {choice === null
                    ? ""
                    : isRight
                      ? "Right."
                      : `Not quite: ${PICK_LABEL[item.answer].toLowerCase()}.`}
                  {choice !== null && complete && lastAnswered === i && (
                    <span className="sr-only">
                      {" "}
                      All four answered, {correct} of {QUIZ.length} right.
                    </span>
                  )}
                </p>
                {choice !== null && (
                  <p className="text-ink-muted">{item.why}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs font-semibold text-brand-cyan">
        {answered} of {QUIZ.length} answered
        {complete ? `, ${correct} right.` : ""}
      </p>
    </div>
  );
}

/* ---------- The pre-deadline checklist ---------- */

const CHECKLIST = [
  "I know my playoff odds from a simulation of my real league, not a guess from my record.",
  "I know how many teams make it, how many get a bye, and whether my league plays a median game.",
  "I know my league's standings tiebreaker, and where I sit on points for.",
  "I checked my all-play record, so I know how much of my record is luck.",
  "I know whether I am buying, holding or selling, and it came from my odds band.",
  "Every trade I am considering helps the weeks my playoffs are played in.",
  "I have a backup at my thinnest position for the playoff weeks.",
  "I checked my league's trade deadline in the settings, and the date is in my calendar.",
];

export function PlayoffChecklist() {
  const [checked, setChecked] = useState<boolean[]>(() =>
    CHECKLIST.map(() => false),
  );
  const groupId = useId();
  const done = checked.filter(Boolean).length;

  return (
    <fieldset className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-ink">
        The eight checks
      </legend>
      <p className="mt-1 text-xs text-ink-subtle">
        Nothing here is saved. Tick through it the week before your trade
        deadline.
      </p>
      <ul role="list" className="mt-3 space-y-1.5">
        {CHECKLIST.map((item, i) => {
          const id = `${groupId}-item-${i}`;
          return (
            <li key={item}>
              <label
                htmlFor={id}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card px-2 py-2 text-sm leading-relaxed text-ink transition-colors hover:bg-ink/[0.04]"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() =>
                    setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))
                  }
                  className="mt-1 h-4 w-4 shrink-0 accent-[#22D3EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                />
                <span
                  className={checked[i] ? "text-ink-muted line-through" : ""}
                >
                  {item}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p
        aria-live="polite"
        aria-atomic="true"
        className="mt-3 text-xs font-semibold text-brand-cyan"
      >
        {done} of {CHECKLIST.length} checked
        {done === CHECKLIST.length ? ". Make your move." : ""}
      </p>
    </fieldset>
  );
}
