"use client";

import { useId, useMemo, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { simulateSurvival, type SurvivalTeam } from "@/lib/chopped/survival";
import {
  NFL_LAST_WEEK,
  knownCountFor,
  seasonLengthFor,
} from "@/lib/guides/chopped-season-length";

/**
 * The interactive pieces of the chopped league guide.
 *
 * SurvivalWorksheet runs simulateSurvival from lib/chopped/survival.ts, the
 * same function the FAAB calculator runs on a real chopped league, in the
 * reader's own browser. That is the point of it: the lesson argues that spread
 * matters more than scoring in this format, and a reader can only really
 * believe that by moving the spread and watching the title odds move further
 * than the scoring does. The league around them is invented and equal, and the
 * panel says so above the result.
 *
 * WHY THE SIMULATION IS SAFE TO RUN CLIENT-SIDE. lib/chopped/survival.ts
 * imports lib/power-pulse/math.ts and nothing else, and that file imports
 * nothing at all. Together they are about 360 lines of pure arithmetic with no
 * server dependency. The whole grid of inputs below tops out around 30
 * milliseconds (eighteen rosters, seventeen weeks, RUNS runs), and useMemo
 * keys it on the three inputs so a re-render that changes nothing recomputes
 * nothing.
 *
 * Note the deliberate contrast with lib/chopped/price.ts, which exists
 * precisely so the manual calculator does NOT pull this module into the
 * browser. That objection was about dragging the simulator in to read four
 * numbers off a settings object. Here the simulator IS the feature.
 *
 * SpendOrHold is four waiver calls; the reader says whether each one is a week
 * to spend or a week to wait. The situations are invented and the reasons are
 * the guide's own rules.
 *
 * SeasonLengthPicker is the only one of the four that runs no simulation at
 * all, because its answer is a subtraction: one roster leaves a week, so a
 * league of N has N minus 1 chops in it. It is interactive anyway because the
 * question a reader actually has ("my league has twelve teams, when does this
 * end?") has a different answer for every one of them, and because the point
 * only lands when they see their own number and then see which real platform
 * picked it.
 *
 * WeeklyChecklist is the format's weekly questions as real checkboxes.
 * Nothing is stored: it is a scratchpad for one Tuesday, and a persisted
 * checklist would carry last week's ticks into this week's.
 *
 * All four are native form controls inside fieldsets, so keyboard movement,
 * checked state and each group's name come from the platform. Results sit in
 * short polite live regions so a screen reader hears the change without the
 * focus moving, and no region repeats a whole paragraph on every change.
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
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
              ) : (
                <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />
              )}
              {opt.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ---------- Lesson 2: the survival worksheet ---------- */

/**
 * Small enough to stay instant on a phone, large enough that the third
 * significant figure is the only thing still moving. The figures on the page
 * itself run six thousand, because a server has the time.
 */
const RUNS = 1200;
const SEED = 20260921;
/** An average weekly score for a starting lineup. Invented. */
const BASE_MEAN = 105;
/** The spread of every other roster in the invented league. */
const FIELD_SIGMA = 26;

const ALIVE_OPTIONS = [18, 12, 8, 6, 4];

const SPREADS = [
  { value: 16, label: "Steady" },
  { value: 26, label: "Average" },
  { value: 38, label: "Boom or bust" },
];

const SCORING = [
  { value: -8, label: "About 8 below" },
  { value: 0, label: "Level with them" },
  { value: 8, label: "About 8 above" },
];

type WorksheetResult = {
  pChopped: number;
  weeksAlive: number;
  weeksLeft: number;
  pWin: number;
};

/**
 * Play out a league of `alive` rosters where roster 1 is the reader's and
 * every other one is an ordinary team.
 *
 * The number of weeks left is not asked for, because the format settles it:
 * one roster is chopped a week, so a league with N teams alive has exactly
 * N minus 1 weeks to run. Asking would invite an answer that contradicts the
 * field size.
 */
function runWorksheet(alive: number, sigma: number, meanOffset: number): WorksheetResult {
  const weeks = Array.from({ length: alive - 1 }, (_, i) => i + 1);
  const teams: SurvivalTeam[] = Array.from({ length: alive }, (_, i) => ({
    rosterId: i + 1,
    seasonPoints: 0,
    weeks: new Map(
      weeks.map((w) => [
        w,
        {
          mean: i === 0 ? BASE_MEAN + meanOffset : BASE_MEAN,
          sigma: i === 0 ? sigma : FIELD_SIGMA,
        },
      ]),
    ),
  }));

  const me = simulateSurvival(teams, weeks, {
    runs: RUNS,
    seed: SEED,
    choppedPerWeek: 1,
  }).get(1);

  return {
    pChopped: me?.pChoppedThisWeek ?? 0,
    weeksAlive: me?.expectedWeeksAlive ?? 0,
    weeksLeft: weeks.length,
    pWin: me?.pWin ?? 0,
  };
}

function pct(value: number): string {
  return (Math.round(value * 1000) / 10).toFixed(1);
}

export function SurvivalWorksheet() {
  const groupId = useId();
  const [alive, setAlive] = useState(18);
  const [sigma, setSigma] = useState(26);
  const [offset, setOffset] = useState(0);

  // The simulation is cheap but not free, and a parent re-render must not pay
  // for it twice.
  const result = useMemo(() => runWorksheet(alive, sigma, offset), [alive, sigma, offset]);

  const spreadLabel = SPREADS.find((s) => s.value === sigma)!.label.toLowerCase();
  const baseline = 1 / alive;
  const saferThanAverage = result.pChopped < baseline;

  return (
    <div
      className="rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: how safe is this roster?
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          This runs the product&apos;s real survival simulator in your browser, but on an invented
          league: every other roster in it is an ordinary team scoring {BASE_MEAN} points a week.
          Move the spread and watch it change more than the scoring does. The FAAB calculator is
          the real version, and it reads your actual league. Nothing is saved.
        </p>

        <div className="mt-4 grid gap-4">
          <RadioChips<number>
            legend="Teams still alive in your league"
            hint="One roster is chopped a week, so this also sets how many weeks are left."
            name={`${groupId}-alive`}
            value={alive}
            options={ALIVE_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
            onChange={setAlive}
          />
          <RadioChips<number>
            legend="How steady is your roster, week to week?"
            hint="Not how good it is. Whether a bad Sunday is dull or a disaster."
            name={`${groupId}-spread`}
            value={sigma}
            options={SPREADS}
            onChange={setSigma}
          />
          <RadioChips<number>
            legend="Your points per week against the rest of the league"
            name={`${groupId}-offset`}
            value={offset}
            options={SCORING}
            onChange={setOffset}
          />
        </div>

        <div className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            In this invented league
          </p>
          {/* Only the one-line verdict is live. A region holding the whole
              panel would re-read every tile each time a radio moved. */}
          <p aria-live="polite" aria-atomic="true" className="mt-1 text-base font-semibold text-ink">
            {pct(result.pChopped)} percent chance of being chopped this week, and{" "}
            {pct(result.pWin)} percent of winning the league.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                Chopped this week
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-brand-cyan">
                {pct(result.pChopped)}%
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                Weeks you last
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-ink">
                {result.weeksAlive.toFixed(1)}
                <span className="ml-1 font-sans text-xs font-normal text-ink-muted">
                  of {result.weeksLeft}
                </span>
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                Win the league
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-brand-purple">
                {pct(result.pWin)}%
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            An ordinary roster in a field of {alive} carries a {pct(baseline)} percent chance of
            posting the lowest score. A {spreadLabel} roster{" "}
            {saferThanAverage
              ? `sits under that, which is the whole argument for a high floor`
              : `sits above it, and the gap is the price of the spread`}
            . {result.weeksLeft} {result.weeksLeft === 1 ? "week" : "weeks"} left to survive, and
            the bar rises every one of them as the league removes its worst team.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Lesson 5: spend or hold ---------- */

type Call = "spend" | "hold";

const CALL_LABEL: Record<Call, string> = {
  spend: "Spend on him",
  hold: "Hold the money",
};

const CALLS: { situation: string; answer: Call; why: string }[] = [
  {
    situation:
      "Week 2. You are comfortably mid-pack, and the roster chopped on Sunday released a receiver who would be your third-best starter. Four teams still have their whole budget.",
    answer: "hold",
    why: "Full wallets and one game of evidence make this the worst market of the season, and a week 2 chopped roster is by definition the worst roster in the league. There are fifteen more rosters coming, each one better than this one, and you will be bidding against fewer people every time.",
  },
  {
    situation:
      "Week 7, twelve teams left. You are third from bottom on points scored, and a top running back just hit the wire who walks straight into your flex over a back averaging seven a week.",
    answer: "spend",
    why: "Both of the guide's conditions are true at once: he starts for you every week from here, and your survival this week is genuinely at risk. When the thing you are buying is not finishing last on Sunday, the price of the player stops being the point.",
  },
  {
    situation:
      "Week 4. You are the highest scorer in the league. A genuinely good tight end is available, and two teams near the cut have more budget left than you do.",
    answer: "hold",
    why: "You have no emergency, so let the desperate teams pay. Your money is worth more next week when one of them is gone and their roster is on the wire, and a safe team outbidding a team fighting for its life is paying a danger premium it does not need.",
  },
  {
    situation:
      "Week 13, six teams left, and you are still holding $700. Your league locks chopped players from week 15, and a good receiver was just released.",
    answer: "spend",
    why: "The release cutoff is a deadline on the money. After week 14 nothing new reaches the wire, so every dollar you are still holding in week 15 has already turned into nothing. Holding was correct in September and is the mistake now.",
  },
];

export function SpendOrHold() {
  const groupId = useId();
  const [picked, setPicked] = useState<(Call | null)[]>(() => CALLS.map(() => null));
  const [lastAnswered, setLastAnswered] = useState<number | null>(null);
  const answered = picked.filter((p) => p !== null).length;
  const correct = picked.filter((p, i) => p === CALLS[i].answer).length;
  const complete = answered === CALLS.length;

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Try it: spend or hold?
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        Four Tuesdays in an invented chopped league. Say which way each one goes. Nothing here is
        saved.
      </p>
      <ol role="list" className="mt-4 space-y-4">
        {CALLS.map((item, i) => {
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
                  {(["spend", "hold"] as const).map((value) => {
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
                            setPicked((prev) => prev.map((p, j) => (j === i ? value : p)));
                            setLastAnswered(i);
                          }}
                          className="sr-only"
                        />
                        {checked ? (
                          <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                        ) : (
                          <Circle aria-hidden="true" className="h-4 w-4 text-ink-subtle" />
                        )}
                        {CALL_LABEL[value]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {/* Only the verdict is live, so arrowing between the two radios
                  speaks a few words rather than the whole reason. The reason
                  follows in reading order for anyone who wants it. */}
              <div
                className={`mt-2 min-h-[1.5rem] rounded-card text-sm leading-relaxed ${
                  choice === null
                    ? ""
                    : `border-l-4 bg-base/60 px-3 py-2 ${
                        isRight ? "border-brand-cyan/60" : "border-brand-purple/60"
                      }`
                }`}
              >
                <p aria-live="polite" aria-atomic="true" className="font-semibold text-ink">
                  {choice === null
                    ? ""
                    : isRight
                      ? "Right."
                      : `Not quite: ${CALL_LABEL[item.answer].toLowerCase()}.`}
                  {choice !== null && complete && lastAnswered === i && (
                    <span className="sr-only">
                      {" "}
                      All four answered, {correct} of {CALLS.length} right.
                    </span>
                  )}
                </p>
                {choice !== null && <p className="text-ink-muted">{item.why}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs font-semibold text-brand-cyan">
        {answered} of {CALLS.length} answered
        {complete ? `, ${correct} right.` : ""}
      </p>
    </div>
  );
}

/* ---------- The weekly checklist ---------- */

const CHECKLIST = [
  "I know how many teams are still alive, and therefore how many weeks are left.",
  "I know where my projected score sits against the bottom of the league, not against my opponent.",
  "I checked my starting lineup for a bye or an inactive before I looked at the wire.",
  "I know which players on the chopped roster actually start for me, and which are somebody else's problem.",
  "I know how many Sundays between now and the end of the league the player I am bidding on starts for me.",
  "I checked what the teams near the cut have left to spend, because they will outbid a safe team.",
  "I know my league's release cutoff, and how many waiver runs are left before my money expires.",
  "I have a walk-away number, and I wrote it down before I wrote the bid.",
];

export function WeeklyChecklist() {
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const groupId = useId();
  const done = checked.filter(Boolean).length;

  return (
    <fieldset className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-ink">The eight questions</legend>
      <p className="mt-1 text-xs text-ink-subtle">
        Nothing here is saved. Tick through it on the Tuesday a roster gets released, then close
        the tab.
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
                <span className={checked[i] ? "text-ink-muted line-through" : ""}>{item}</span>
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
        {done === CHECKLIST.length ? ". Put the bid in." : ""}
      </p>
    </fieldset>
  );
}

/* ---------- Lesson 2: how long will this league last ---------- */

/**
 * Sizes a reader might actually be in, spanning the three shapes: finishing
 * early, finishing exactly, and too big to chop its way to one winner.
 */
const TEAM_COUNTS = [10, 12, 14, 17, 18, 19, 20, 24];

/**
 * "an 18-team league", not "a 18-team league".
 *
 * The article follows how a number is SPOKEN rather than how it is spelled,
 * and eighteen is the only count in the list that needs it. Eight and eleven
 * are handled too, so adding a size later cannot quietly reintroduce this.
 */
function article(n: number): string {
  const spoken = String(n);
  const needsAn = spoken === "8" || spoken === "11" || spoken === "18" || spoken.startsWith("8");
  return needsAn ? "An" : "A";
}

export function SeasonLengthPicker() {
  const groupId = useId();
  const [teams, setTeams] = useState(18);

  const out = seasonLengthFor(teams);
  const known = knownCountFor(teams);

  // One sentence, and it is the whole answer. The tiles under it are the same
  // fact broken into parts, which is why only this is live: a region holding
  // the tiles as well would re-read three numbers every time a radio moved.
  const verdict =
    out.shape === "needs-a-decider"
      ? `${article(teams)} ${teams}-team league still has ${out.survivorsAtSeasonEnd} teams alive when the NFL season ends, so it cannot chop its way to one winner.`
      : `${article(teams)} ${teams}-team league takes its last chop in week ${out.lastChopWeek}, and the team left is the champion.`;

  return (
    <div
      className="rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: when does my league end?
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          No simulation here, just the subtraction the format runs on: one
          roster is chopped a week, so a league of N teams has N minus 1 chops
          in it. Pick your size and see the week it finishes. Nothing is saved.
        </p>

        <div className="mt-4">
          <RadioChips<number>
            legend="Teams your league started with"
            hint="The number that drafted, before anyone was chopped."
            name={`${groupId}-teams`}
            value={teams}
            options={TEAM_COUNTS.map((n) => ({ value: n, label: String(n) }))}
            onChange={setTeams}
          />
        </div>

        <div className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            What that size means
          </p>
          <p aria-live="polite" aria-atomic="true" className="mt-1 text-base font-semibold text-ink">
            {verdict}
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                Weeks of chopping
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-brand-cyan">
                {out.chopsToOneLeft}
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                {out.shape === "needs-a-decider" ? "Alive at the end" : "Last chop"}
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-ink">
                {out.shape === "needs-a-decider"
                  ? out.survivorsAtSeasonEnd
                  : `Week ${out.lastChopWeek}`}
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                NFL weeks unused
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-brand-purple">
                {out.unusedWeeks}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {out.shape === "needs-a-decider" ? (
              <>
                There are only {NFL_LAST_WEEK} weeks to remove {out.chopsToOneLeft}{" "}
                teams in, so a league this size has to end some other way. The
                two published answers are deciding it on the final week&apos;s
                higher score, and stopping the chopping early to play a
                total-points final. Ask your commissioner which yours does
                before you plan a budget around week 17.
              </>
            ) : out.unusedWeeks === 0 ? (
              <>
                The only size that uses the whole regular season and still
                produces one winner. Every team count above this one needs a
                decider, and every one below finishes early.
              </>
            ) : out.unusedWeeks <= 2 ? (
              <>
                That uses almost the whole season, which is why this size is the
                one most formats settle on. Your budget still has to be gone by
                week {out.lastChopWeek}: money held past the last chop is money
                you never spent.
              </>
            ) : (
              <>
                Your league is over with {out.unusedWeeks} NFL weeks still to
                play, and that is the real cost of a small field here. The
                budget you were saving for a late run has fewer weeks to be
                spent in, and holding money past week {out.lastChopWeek} means
                holding it forever.
              </>
            )}
            {known && <> At this size you are in the same shape as {known.who}.</>}
          </p>
        </div>
      </div>
    </div>
  );
}
