"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import {
  classifyTeamStatus,
  type TeamStatusKey,
} from "@/lib/league-team-status";

/**
 * The interactive pieces of the dynasty strategy guide.
 *
 * WhichLane runs the reader's own numbers through classifyTeamStatus(), the
 * pure classifier League Pulse uses for the tag beside a team's name. Nothing
 * here re-implements the cut lines, so the box and the tag cannot disagree.
 * The advice under each band is the guide's.
 *
 * AgeClock asks for the ages of a starting core and counts how many are still
 * inside their position's reliable years this season, next season and the one
 * after. The cut-off ages are rules of thumb drawn from the studies the page
 * cites, and the box says so.
 *
 * LaneQuiz is five moves; the reader says which lane each one belongs to.
 *
 * DeadlineChecklist is the pre-deadline list as real checkboxes. Nothing is
 * stored: a persisted checklist would carry last season's ticks into this one.
 *
 * All of them are native form controls inside fieldsets, so keyboard movement,
 * checked state and each group's name come from the platform. Results sit in
 * polite live regions so a screen reader hears the change without the focus
 * moving.
 */

/* ---------- Shared: radio chips ---------- */

function RadioChips<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
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
                <Circle aria-hidden="true" className="h-4 w-4 text-ink-subtle" />
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

function ordinalWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/* ---------- Lesson 1: which lane are you in ---------- */

const LANE_ADVICE: Record<TeamStatusKey, { move: string; body: string }> = {
  competitor: {
    move: "Buy",
    body: "Your window is open. Trade future picks and young bench players for veterans who start for you this year, and pay in picks two years out before you touch next year's first. Keep one first in hand so a bad injury does not leave you with nothing to rebuild with.",
  },
  loaded: {
    move: "Hold, then add",
    body: "That gap is usually a young team a year early. Do not sell the youth to chase this season. Add one cheap veteran starter if the price is right, and expect to be a contender next year.",
  },
  middle: {
    move: "Choose, this month",
    body: "This is the band where dynasty teams stall. Count how many of your starters would start for the best team in your league. Five or more, push in. Two or fewer, sell the veterans now, while contenders are paying. In between, lean toward whichever way your core's ages point.",
  },
  rebuilder: {
    move: "Sell",
    body: "The season is not the thing to play for. Every veteran on your roster is worth more to a contender before the deadline than he will be to you after it. Sell for firsts and for players 25 or younger, and set a date for the rebuild to end.",
  },
};

export function WhichLane() {
  const groupId = useId();
  const [teams, setTeams] = useState<number>(12);
  const [playoffs, setPlayoffs] = useState<number>(6);
  const [pulseRank, setPulseRank] = useState<number>(6);
  const [valueRank, setValueRank] = useState<number>(3);

  const clampRank = (r: number) => Math.min(Math.max(r, 1), teams);
  const pulse = clampRank(pulseRank);
  const value = clampRank(valueRank);
  const field = Math.min(playoffs, teams);

  const status = classifyTeamStatus({
    pulseRank: pulse,
    valueRank: value,
    teamCount: teams,
    playoffTeams: field,
    variant: "dynasty",
  });
  const advice = status ? LANE_ADVICE[status.key] : null;
  const rankOptions = Array.from({ length: teams }, (_, i) => i + 1);

  return (
    <div
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: which lane is your team in?
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          Put in your own league. This box runs the same code League Pulse uses
          to tag every team. Nothing is saved.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <RadioChips<number>
            legend="Teams in your league"
            name={`${groupId}-teams`}
            value={teams}
            options={[
              { value: 10, label: "10" },
              { value: 12, label: "12" },
              { value: 14, label: "14" },
            ]}
            onChange={(v) => {
              setTeams(v);
              setPulseRank((r) => Math.min(r, v));
              setValueRank((r) => Math.min(r, v));
            }}
          />
          <RadioChips<number>
            legend="Teams that make the playoffs"
            name={`${groupId}-playoffs`}
            value={playoffs}
            options={[
              { value: 4, label: "4" },
              { value: 6, label: "6" },
              { value: 7, label: "7" },
              { value: 8, label: "8" },
            ]}
            onChange={setPlayoffs}
          />
          <div>
            <label
              htmlFor={`${groupId}-pulse`}
              className="text-sm font-semibold text-ink"
            >
              Your rank by projected wins
            </label>
            <p
              id={`${groupId}-pulse-hint`}
              className="mt-0.5 text-xs text-ink-subtle"
            >
              Power Pulse on your League Pulse page, or your honest guess.
            </p>
            <select
              id={`${groupId}-pulse`}
              aria-describedby={`${groupId}-pulse-hint`}
              value={pulse}
              onChange={(e) => setPulseRank(Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {rankOptions.map((r) => (
                <option key={r} value={r}>
                  {ordinalWord(r)} of {teams}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`${groupId}-value`}
              className="text-sm font-semibold text-ink"
            >
              Your rank by roster value
            </label>
            <p
              id={`${groupId}-value-hint`}
              className="mt-0.5 text-xs text-ink-subtle"
            >
              The Value column on the same page, picks included.
            </p>
            <select
              id={`${groupId}-value`}
              aria-describedby={`${groupId}-value-hint`}
              value={value}
              onChange={(e) => setValueRank(Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {rankOptions.map((r) => (
                <option key={r} value={r}>
                  {ordinalWord(r)} of {teams}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Only the one-line verdict is live. Arrowing through a closed select
            on Windows fires a change per option, and a live region holding the
            whole paragraph would re-read a hundred words for every rank passed.
            The reason and advice sit right after it for a reader who wants them. */}
        <div className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
          {status && advice ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                Your lane
              </p>
              <p
                aria-live="polite"
                aria-atomic="true"
                className="mt-1 text-base font-semibold text-ink"
              >
                {status.label}. {advice.move}.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                {status.reason}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">
                {advice.body}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              Pick a rank to see your lane.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Lesson 3: the age clock ---------- */

type CorePos = "QB" | "RB" | "WR" | "TE";

/**
 * The last age each position is treated as reliably in its prime. Rules of
 * thumb from the studies the page cites: running backs decline from 29
 * (4for4, ESPN), receivers fall 30 to 40 percent from 31 (Fantasy Life), tight
 * ends show no regression until 31 (4for4), and franchise quarterbacks hold
 * solid numbers to 36 (PFF, 2012), with two years taken off for margin.
 */
const RELIABLE_THROUGH: Record<CorePos, number> = {
  QB: 34,
  RB: 28,
  WR: 30,
  TE: 30,
};

const CORE: { id: string; pos: CorePos; label: string; start: number }[] = [
  { id: "qb", pos: "QB", label: "Quarterback", start: 29 },
  { id: "rb1", pos: "RB", label: "Running back 1", start: 27 },
  { id: "rb2", pos: "RB", label: "Running back 2", start: 24 },
  { id: "wr1", pos: "WR", label: "Receiver 1", start: 29 },
  { id: "wr2", pos: "WR", label: "Receiver 2", start: 25 },
  { id: "te", pos: "TE", label: "Tight end", start: 28 },
];

const AGE_OPTIONS = Array.from({ length: 15 }, (_, i) => 21 + i);

export function AgeClock() {
  const groupId = useId();
  const [ages, setAges] = useState<Record<string, number>>(() =>
    Object.fromEntries(CORE.map((c) => [c.id, c.start])),
  );

  const inPrime = (offset: number) =>
    CORE.filter((c) => ages[c.id] + offset <= RELIABLE_THROUGH[c.pos]).length;
  const now = inPrime(0);
  const next = inPrime(1);
  const after = inPrime(2);
  const leaving = CORE.filter(
    (c) =>
      ages[c.id] <= RELIABLE_THROUGH[c.pos] &&
      ages[c.id] + 2 > RELIABLE_THROUGH[c.pos],
  );

  const verdict =
    after >= 5
      ? "Your window is wide. Most of your core is still in its prime two seasons from now, so you can buy without mortgaging the future."
      : after >= 3
        ? "Your window is this season and next. Buy for those two, and start replacing the players on the list below before the market marks them down."
        : "Your window is now or never. Most of your core leaves its prime within two seasons. Either push every chip in this year or sell the ones on the list below while they still carry a price.";

  const cols = [
    { label: "This season", n: now },
    { label: "Next season", n: next },
    { label: "Two seasons out", n: after },
  ];

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Try it: the age clock
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        Set the ages of your six most important starters. The box counts how
        many are still inside their position&apos;s prime years, using rules of
        thumb from the studies cited on this page: running backs through 28,
        receivers and tight ends through 30, quarterbacks through 34. A guide
        to your window, not a projection for any player.
      </p>

      <fieldset className="mt-4">
        <legend className="sr-only">Ages of your six core starters</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CORE.map((c) => (
            <div key={c.id}>
              <label
                htmlFor={`${groupId}-${c.id}`}
                className="text-xs font-semibold text-ink"
              >
                {c.label}
              </label>
              <select
                id={`${groupId}-${c.id}`}
                value={ages[c.id]}
                onChange={(e) =>
                  setAges((prev) => ({
                    ...prev,
                    [c.id]: Number(e.target.value),
                  }))
                }
                className={SELECT_CLASS}
              >
                {AGE_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    Age {a}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      {/* One short live sentence rather than the whole panel, so each change
          of age is heard as three numbers and not re-read in full. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {now} of {CORE.length} in their prime this season, {next} next season,{" "}
        {after} two seasons out.
      </p>
      <div className="mt-4">
        <dl className="grid grid-cols-3 gap-2">
          {cols.map((col) => (
            <div
              key={col.label}
              className="rounded-card border border-line bg-base/60 px-3 py-2"
            >
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                {col.label}
              </dt>
              <dd className="mt-0.5 text-sm text-ink-muted">
                <span className="font-mono text-lg font-semibold tabular-nums text-brand-cyan">
                  {col.n}
                </span>{" "}
                of {CORE.length} in their prime
              </dd>
              <div
                aria-hidden="true"
                className="mt-1.5 flex gap-0.5"
              >
                {CORE.map((c, i) => (
                  <span
                    key={c.id}
                    className={`h-1.5 flex-1 rounded-full ${
                      i < col.n ? "bg-brand-cyan" : "bg-ink/[0.08]"
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </dl>
        <p className="mt-3 rounded-card border-l-4 border-brand-purple/60 bg-base/60 px-3 py-2 text-sm leading-relaxed text-ink">
          {verdict}
        </p>
        {leaving.length > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Leaving their prime within two seasons:{" "}
            {leaving
              .map((c) => `your ${c.label.toLowerCase()}, age ${ages[c.id]}`)
              .join(", ")}
            .
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- Lessons 6 and 7: which lane is this move for ---------- */

type Lane = "contend" | "rebuild";

const QUIZ: { move: string; answer: Lane; why: string }[] = [
  {
    move: "Trade your 2028 first and a bench receiver for a 29-year-old running back who has 20 touches a week.",
    answer: "contend",
    why: "Wins now, paid for with the asset furthest from helping you. A running back at 29 is at the age the studies say production starts falling, which is why he is cheap, and a contender only needs his next few months.",
  },
  {
    move: "Sell your 27-year-old WR1 in October for a mid first and a 23-year-old receiver.",
    answer: "rebuild",
    why: "Receivers hold their production into their late twenties, but by the time yours is 30 the price will be gone. A rebuilder sells while a contender is paying for this season.",
  },
  {
    move: "Trade the 1.07 in May for a second-year receiver coming off a quiet rookie season.",
    answer: "rebuild",
    why: "Picks five through twelve hit a little under half the time in the Dynasty Nerds data, and ESPN found receivers gain about 43 percent in year two. You swapped a coin flip at its highest price for the jump.",
  },
  {
    move: "Turn two startable running backs into one elite receiver at the deadline.",
    answer: "contend",
    why: "Consolidation. You can only start so many players, and a contender wins titles with the players the waiver wire can never replace.",
  },
  {
    move: "Pick up a rookie tight end off waivers and put him on your taxi squad.",
    answer: "rebuild",
    why: "A stash costs a taxi spot, not a roster spot, and tight ends take the longest to arrive. That is patience, and patience is the rebuilder's edge. A contender can do it too, but it will not help them this year.",
  },
];

const LANE_LABEL: Record<Lane, string> = {
  contend: "Contender move",
  rebuild: "Rebuilder move",
};

export function LaneQuiz() {
  const [picked, setPicked] = useState<(Lane | null)[]>(() =>
    QUIZ.map(() => null),
  );
  const [lastAnswered, setLastAnswered] = useState<number | null>(null);
  const groupId = useId();
  const answered = picked.filter((p) => p !== null).length;
  const correct = picked.filter((p, i) => p === QUIZ[i].answer).length;
  const complete = answered === QUIZ.length;
  const completion = complete
    ? `Quiz complete, ${correct} of ${QUIZ.length} right.`
    : "";

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Try it: whose move is this?
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        Five moves. Say which lane each one belongs to. Nothing here is saved.
      </p>

      <ol role="list" className="mt-4 space-y-4">
        {QUIZ.map((item, i) => {
          const choice = picked[i];
          const isRight = choice === item.answer;
          return (
            <li key={item.move}>
              <fieldset>
                <legend className="text-sm font-medium leading-relaxed text-ink">
                  <span className="sr-only">Move {i + 1}: </span>
                  {item.move}
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["contend", "rebuild"] as const).map((value) => {
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
                        {LANE_LABEL[value]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div
                aria-live="polite"
                aria-atomic="true"
                className="mt-2 min-h-[1.5rem] text-sm leading-relaxed"
              >
                {choice !== null && (
                  <p
                    className={`rounded-card border-l-4 bg-base/60 px-3 py-2 ${
                      isRight
                        ? "border-brand-cyan/60"
                        : "border-brand-purple/60"
                    }`}
                  >
                    <span className="font-semibold text-ink">
                      {isRight
                        ? "Right. "
                        : `Not quite, this is a ${LANE_LABEL[item.answer].toLowerCase()}. `}
                    </span>
                    <span className="text-ink-muted">{item.why}</span>
                    {/* The completion line rides in the region that is already
                        speaking for this click, rather than in a second region
                        that would race it. */}
                    {complete && lastAnswered === i && (
                      <span className="sr-only"> {completion}</span>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Never live. Each answer speaks its own feedback, and the completion
          line is announced inside the last answer's feedback above. */}
      <p className="mt-3 text-xs font-semibold text-brand-cyan">
        {answered} of {QUIZ.length} answered
        {complete
          ? `, ${correct} right. ${
              correct === QUIZ.length
                ? "You know which lane every move belongs to."
                : "Reread the ones marked not quite, then try again."
            }`
          : ""}
      </p>
    </div>
  );
}

/* ---------- The pre-deadline checklist ---------- */

const CHECKLIST = [
  "I know my lane: Contender, Loaded, Bubble or Rebuilder, and I did not round it up.",
  "I counted how many of my starters would start for the best team in my league.",
  "I know how many of my core starters are still in their prime two seasons from now.",
  "I know which of my players the market will mark down for age this offseason.",
  "If I am buying, I am paying with picks two years out before next year's first.",
  "If I am selling, I am selling before the deadline, not after an injury does it for me.",
  "I have a rebuild end date, or I know why I do not need one.",
  "I checked my league's trade deadline and taxi squad rules in the settings.",
];

export function DeadlineChecklist() {
  const [checked, setChecked] = useState<boolean[]>(() =>
    CHECKLIST.map(() => false),
  );
  const groupId = useId();
  const done = checked.filter(Boolean).length;

  return (
    <fieldset className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-ink">
        The eight questions
      </legend>
      <p className="mt-1 text-xs text-ink-subtle">
        Nothing here is saved. Tick through it once before your trade deadline,
        and again before your rookie draft.
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
        {done === CHECKLIST.length ? ". Make the move." : ""}
      </p>
    </fieldset>
  );
}
