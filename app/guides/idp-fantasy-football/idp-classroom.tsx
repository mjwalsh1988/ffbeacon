"use client";

/**
 * The IDP guide's interactive panels (plan IDP-219).
 *
 * Native radios and checkboxes in labelled fieldsets, one polite live region
 * per panel that speaks one sentence on a change, nothing stored anywhere.
 * Every panel says in words what it is before it shows a number. The pattern
 * follows app/guides/chopped-league-strategy/chopped-classroom.tsx.
 *
 * ASCII only.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { scoreIdpLine } from "@/lib/idp/stat-line";
import { IDP_PRESETS, IDP_PRESET_LABEL, type IdpPresetKey } from "@/lib/idp/scoring-presets";
import { positionNoun } from "@/lib/site";
import type { GuidePlayerLine } from "@/lib/guides/idp-seasons";
import { MIN_GAMES, type StabilityFigure } from "@/lib/guides/idp-stability";
import { REPEATS_AT, chaseOrIgnore } from "@/lib/guides/idp-scarcity";

const PANEL = "mt-6 rounded-card border border-line bg-surface/50 p-4 sm:p-5";
const RADIO = (checked: boolean) =>
  `flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
    checked
      ? "border-brand-cyan bg-brand-cyan/10 text-ink"
      : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
  }`;

/* ---------- Scoring switcher ---------- */

const PRESETS: IdpPresetKey[] = ["idp123", "big3", "fantasypros", "espn"];
type SwitcherChoice = IdpPresetKey | "custom";

/** How many players per position the switcher ranks. */
const SWITCHER_DEPTH = 12;

/**
 * The stats a reader can price in Custom. Safety and blocked kick stay at
 * Sleeper's default: they are rare enough that no slider on them moves the
 * order, and the panel says so.
 */
const CUSTOM_STATS: Array<{ key: string; label: string }> = [
  { key: "idp_tkl_solo", label: "Solo tackle" },
  { key: "idp_tkl_ast", label: "Assisted tackle" },
  { key: "idp_tkl_loss", label: "Tackle for loss" },
  { key: "idp_sack", label: "Sack" },
  { key: "idp_qb_hit", label: "Quarterback hit" },
  { key: "idp_pass_def", label: "Pass defended" },
  { key: "idp_int", label: "Interception" },
  { key: "idp_ff", label: "Forced fumble" },
  { key: "idp_fum_rec", label: "Fumble recovery" },
  { key: "idp_def_td", label: "Defensive touchdown" },
];

function defaultCustom(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of CUSTOM_STATS) out[s.key] = IDP_PRESETS.idp123[s.key] ?? 0;
  return out;
}

function choiceLabel(choice: SwitcherChoice): string {
  return choice === "custom" ? "Your custom scoring" : IDP_PRESET_LABEL[choice];
}

/** Slider and typing updates wait this long before the ranking is spoken. */
const ANNOUNCE_DELAY_MS = 700;
/**
 * A spoken sentence is cleared this long after it is spoken. The same words
 * are on screen, and a region still holding them is read a second time by
 * anyone moving through the page line by line.
 */
const CLEAR_AFTER_MS = 1500;

/**
 * The text for a polite live region: the sentence, once it has settled, and
 * only after the reader has changed something. Nothing is spoken on page
 * load, because a region that speaks unprompted interrupts whatever the
 * reader was reading. Compared against the first sentence rather than skipping
 * the first effect run, so React's development double-run cannot defeat it.
 */
function useSettledAnnouncement(sentence: string, delay: number): string {
  const [text, setText] = useState("");
  const initial = useRef(sentence);
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current && sentence === initial.current) return;
    changed.current = true;
    const speak = setTimeout(() => setText(sentence), delay);
    const clear = setTimeout(() => setText(""), delay + CLEAR_AFTER_MS);
    return () => {
      clearTimeout(speak);
      clearTimeout(clear);
    };
  }, [sentence, delay]);
  return text;
}

/** "1 point", "2.5 points". */
function points(n: number): string {
  return `${n} ${n === 1 ? "point" : "points"}`;
}

/**
 * The same real players under four scoring systems, or the reader's own. The
 * lines are last season's actual totals; only the scoring moves. A reader
 * watches linebackers and edge rushers trade places as the price of a tackle
 * against a sack moves.
 */
export function ScoringSwitcher({
  season,
  players,
}: {
  season: number;
  players: Record<"DL" | "LB" | "DB", GuidePlayerLine[]>;
}) {
  const [choice, setChoice] = useState<SwitcherChoice>("idp123");
  const [custom, setCustom] = useState<Record<string, number>>(defaultCustom);
  const groupId = useId();

  const scoring = useMemo(
    () => (choice === "custom" ? { ...IDP_PRESETS.idp123, ...custom } : IDP_PRESETS[choice]),
    [choice, custom],
  );

  // The top twelve at each position, pooled and ranked together under the
  // chosen scoring, so the positions compete for places the way they do in a
  // flex.
  const pooled = useMemo(() => {
    const all = (["DL", "LB", "DB"] as const).flatMap((pos) => players[pos].slice(0, SWITCHER_DEPTH));
    return all
      .map((p) => ({ ...p, points: Math.round(scoreIdpLine(p.line, scoring) * 10) / 10 }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }, [players, scoring]);

  // One sentence per settled change. A slider fires on every step, so the
  // sentence waits until the reader stops moving it.
  const top = pooled.slice(0, SWITCHER_DEPTH);
  const counts = (["DL", "LB", "DB"] as const)
    .map((pos) => {
      const n = top.filter((p) => p.position === pos).length;
      return `${n} ${n === 1 ? positionNoun(pos) : positionNoun(pos, "plural")}`;
    })
    .join(", ");
  const announce = useSettledAnnouncement(
    `${choiceLabel(choice)}: the top ${SWITCHER_DEPTH} are ${counts}. First is ${pooled[0]?.name ?? "nobody"}.`,
    ANNOUNCE_DELAY_MS,
  );

  return (
    <div className={PANEL}>
      <h3 className="text-base font-semibold text-ink">Try it: the same {season} seasons, any scoring</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        These are real {season} regular-season stat lines for the top {SWITCHER_DEPTH} defensive
        linemen, linebackers and defensive backs in Sleeper default scoring, ranked together. Switch
        the scoring, or price each stat yourself, and watch the order change. Only the scoring
        moves; the stats do not.
      </p>
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-ink">Scoring system</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[...PRESETS, "custom" as const].map((key) => (
            <label key={key} className={RADIO(choice === key)}>
              <input
                type="radio"
                name={`${groupId}-preset`}
                value={key}
                checked={choice === key}
                onChange={() => setChoice(key)}
                className="h-4 w-4 accent-brand-cyan"
              />
              <span className="font-medium">{key === "custom" ? "Custom" : IDP_PRESET_LABEL[key]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {choice === "custom" ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">Points per stat</legend>
          <p className="mt-1 text-xs text-ink-subtle">
            Starts at Sleeper&apos;s default. Safety and blocked kick stay at Sleeper&apos;s default.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {CUSTOM_STATS.map((stat) => {
              const inputId = `${groupId}-${stat.key}`;
              return (
                <div key={stat.key}>
                  <div className="flex items-center justify-between text-sm text-ink">
                    <label htmlFor={inputId}>{stat.label}</label>
                    <span className="font-mono tabular-nums text-ink-muted">{custom[stat.key]}</span>
                  </div>
                  <input
                    id={inputId}
                    type="range"
                    min={0}
                    max={10}
                    step={0.25}
                    value={custom[stat.key]}
                    aria-valuetext={points(custom[stat.key])}
                    onChange={(e) =>
                      setCustom((prev) => ({ ...prev, [stat.key]: Number(e.target.value) }))
                    }
                    className="mt-1 h-11 w-full accent-brand-cyan"
                  />
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setCustom(defaultCustom())}
            className="mt-3 min-h-11 rounded-card border border-line px-3 text-sm text-ink-muted hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Reset to Sleeper default
          </button>
        </fieldset>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="mt-4 overflow-x-auto" role="region" aria-label="Ranked players under the chosen scoring" tabIndex={0}>
        <table className="w-full min-w-[22rem] text-sm">
          <caption className="sr-only">
            Top defenders of {season}, ranked under {choiceLabel(choice)}.
          </caption>
          <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-semibold">Rank</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Player</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Position</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {pooled.map((p, i) => (
              <tr key={p.id}>
                <td className="py-1.5 pr-3 font-mono tabular-nums text-ink-muted">{i + 1}</td>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink">
                  {p.slug ? (
                    <Link href={`/players/${p.slug}`} className="hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan">
                      {p.name}
                    </Link>
                  ) : (
                    p.name
                  )}
                </th>
                <td className="py-1.5 pr-3 text-ink-muted">{positionNoun(p.position)}</td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink">{p.points.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Replacement level ---------- */

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/**
 * Lesson 4: set how many of one position start across a whole league and see
 * what the best player left over scored, against the best one. The numbers
 * are real per-game points by season rank; nothing is modelled.
 */
export function ReplacementLevel({
  season,
  byRank,
}: {
  season: number;
  byRank: Record<"DL" | "LB" | "DB", number[]>;
}) {
  const [position, setPosition] = useState<"DL" | "LB" | "DB">("LB");
  const [starters, setStarters] = useState(24);
  const groupId = useId();

  const curve = byRank[position];
  // The slider stops one short of the list, so the player left over exists.
  const maxStarters = Math.max(1, Math.min(36, curve.length - 1));
  const taken = Math.min(starters, maxStarters);
  const best = curve[0] ?? null;
  const left = curve[taken] ?? null;
  const usable = best !== null && left !== null;

  const noun = positionNoun(position, "plural");
  const result = usable
    ? `With ${taken} ${noun} starting across your league, the best one left is the ${ordinal(taken + 1)}, who averaged ${left.toFixed(1)} points a game in ${season}. The best averaged ${best.toFixed(1)}, a gap of ${(best - left).toFixed(1)} a game.`
    : `We do not hold enough ${season} ${noun} to answer this.`;

  const announce = useSettledAnnouncement(result, ANNOUNCE_DELAY_MS);

  const sliderId = `${groupId}-starters`;
  return (
    <div className={PANEL}>
      <h3 className="text-base font-semibold text-ink">Try it: what is left after your league fills its lineups</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Multiply your team count by the starters at one position: 12 teams starting two
        linebackers is 24. Points are Sleeper default IDP scoring, per game, {season}, for
        players with {MIN_GAMES} or more games, ranked by points a game.
      </p>
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-ink">Position</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["DL", "LB", "DB"] as const).map((pos) => (
            <label key={pos} className={RADIO(position === pos)}>
              <input
                type="radio"
                name={`${groupId}-position`}
                value={pos}
                checked={position === pos}
                onChange={() => setPosition(pos)}
                className="h-4 w-4 accent-brand-cyan"
              />
              <span className="font-medium">{positionNoun(pos, "plural")}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4">
        <div className="flex items-center justify-between text-sm text-ink">
          <label htmlFor={sliderId}>Starters at this position across your league</label>
          <span className="font-mono tabular-nums text-ink-muted">{taken}</span>
        </div>
        <input
          id={sliderId}
          type="range"
          min={1}
          max={maxStarters}
          step={1}
          value={taken}
          aria-valuetext={`${taken} ${taken === 1 ? positionNoun(position) : noun}`}
          onChange={(e) => setStarters(Number(e.target.value))}
          className="mt-1 h-11 w-full accent-brand-cyan"
          disabled={!usable}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink">{result}</p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}

/* ---------- Chase or ignore ---------- */

type QuizMetric = "points" | "tackles" | "sacks";
const METRIC_WORD: Record<QuizMetric, string> = {
  points: "points a game",
  tackles: "tackles a game",
  sacks: "sacks a game",
};

const QUIZ: Array<{ id: string; position: "DL" | "LB" | "DB"; metric: QuizMetric; prompt: string }> = [
  {
    id: "lb-sacks",
    position: "LB",
    metric: "sacks",
    prompt: "A linebacker who blitzes a lot had the best sack season of his career last year. Do you pay for those sacks again?",
  },
  {
    id: "lb-tackles",
    position: "LB",
    metric: "tackles",
    prompt: "A linebacker made more tackles a game last season than anyone on his team. Do you pay for those tackles again?",
  },
  {
    id: "db-points",
    position: "DB",
    metric: "points",
    prompt: "A defensive back had his best points-per-game season last year. Do you pay for that again?",
  },
  {
    id: "dl-points",
    position: "DL",
    metric: "points",
    prompt: "A defensive lineman finished near the top of his position in points a game last season. Do you pay for that again?",
  },
];

/**
 * Lesson 5: four players, chase or ignore. Every answer is DECIDED by the
 * measured year-to-year correlation for that position and figure, not typed
 * in, so the quiz cannot disagree with the stability figure above it. A
 * question whose figure we cannot measure is left out.
 */
export function ChaseOrIgnoreQuiz({ figures }: { figures: StabilityFigure[] }) {
  const [answers, setAnswers] = useState<Record<string, "chase" | "ignore">>({});
  const [lastPick, setLastPick] = useState("");
  const announce = useSettledAnnouncement(lastPick, 0);
  const groupId = useId();

  const questions = QUIZ.map((q) => {
    const fig = figures.find((f) => f.position === q.position);
    const r = fig ? fig[q.metric] : null;
    return { ...q, r, verdict: chaseOrIgnore(r) };
  }).filter((q) => q.verdict !== null);

  if (questions.length === 0) return null;

  function explain(q: (typeof questions)[number]): string {
    const r = (q.r as number).toFixed(2);
    const side = q.verdict === "chase" ? "at or above" : "below";
    const call =
      q.verdict === "chase"
        ? "it carries over, so it is worth paying for."
        : "last season told you little, so do not pay for it again.";
    return `For ${positionNoun(q.position, "plural")}, ${METRIC_WORD[q.metric]} correlate at ${r} from one season to the next, ${side} the ${REPEATS_AT.toFixed(1)} line this quiz uses: ${call}`;
  }

  function pick(q: (typeof questions)[number], choice: "chase" | "ignore") {
    setAnswers((prev) => ({ ...prev, [q.id]: choice }));
    setLastPick(`${choice === q.verdict ? "Right." : "Not quite."} ${explain(q)}`);
  }

  const right = questions.filter((q) => answers[q.id] === q.verdict).length;
  const answered = questions.filter((q) => answers[q.id]).length;

  return (
    <div className={PANEL}>
      <h3 className="text-base font-semibold text-ink">Chase or ignore?</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Each answer comes from the year-to-year figure above. Chase means the number tends to
        come back next season; ignore means it tends not to.
      </p>
      <ol role="list" className="mt-3 space-y-4">
        {questions.map((q, i) => {
          const picked = answers[q.id];
          return (
            <li key={q.id}>
              <fieldset>
                <legend className="text-sm font-medium text-ink">
                  {i + 1}. {q.prompt}
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["chase", "ignore"] as const).map((c) => (
                    <label key={c} className={RADIO(picked === c)}>
                      <input
                        type="radio"
                        name={`${groupId}-${q.id}`}
                        value={c}
                        checked={picked === c}
                        onChange={() => pick(q, c)}
                        className="h-4 w-4 accent-brand-cyan"
                      />
                      <span className="font-medium">{c === "chase" ? "Chase" : "Ignore"}</span>
                    </label>
                  ))}
                </div>
                {picked ? (
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    <span className="font-semibold text-ink">{picked === q.verdict ? "Right." : "Not quite."}</span>{" "}
                    {explain(q)}
                  </p>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-ink-subtle">
        {right} of {answered} answered correctly, {questions.length - answered} left.
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}

/* ---------- Stacking check ---------- */

/**
 * The stacking trap (plan section 3): on Sleeper a "Tackle" rule adds on top
 * of the solo and assisted tackle rules rather than replacing them. Three
 * yes-or-no questions tell a reader whether their league pays a tackle twice.
 */
export function StackingCheck() {
  const [plain, setPlain] = useState(false);
  const [solo, setSolo] = useState(false);
  const [sack, setSack] = useState(false);
  const id = useId();

  const verdict = plain && solo
    ? "Your league pays a solo tackle twice: once for Tackle and once for Solo tackle. Every-down linebackers are worth more here than any ranking built on default scoring says."
    : plain
      ? "Your league scores Tackle but not Solo tackle. Assisted tackles then score only if Assisted tackle is also set, and nothing is paid twice."
      : solo
        ? "Your league scores solo and assisted tackles separately and not Tackle, which is Sleeper's default. Nothing is paid twice."
        : "Tick the tackle rules your league scores to see whether any of them stack.";
  const sackNote = sack
    ? " A sack in your league also earns whatever a tackle, a tackle for loss and a quarterback hit earn, because Sleeper records all four on the same play."
    : "";

  return (
    <div className={PANEL}>
      <h3 className="text-base font-semibold text-ink">Check your league: does a tackle count twice?</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Open your league settings on Sleeper, find the defensive scoring, and tick what is there.
      </p>
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-ink">Rules your league scores</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            { label: "Tackle (above zero)", checked: plain, set: setPlain },
            { label: "Solo tackle (above zero)", checked: solo, set: setSolo },
            { label: "Sack (above zero)", checked: sack, set: setSack },
          ].map((opt) => (
            <label key={opt.label} className={RADIO(opt.checked)}>
              <input
                type="checkbox"
                checked={opt.checked}
                onChange={(e) => opt.set(e.target.checked)}
                className="h-4 w-4 accent-brand-cyan"
                aria-describedby={`${id}-verdict`}
              />
              <span className="font-medium">{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p id={`${id}-verdict`} aria-live="polite" className="mt-3 text-sm leading-relaxed text-ink">
        {verdict}
        {sackNote}
      </p>
    </div>
  );
}

/* ---------- In-season checklist ---------- */

const CHECKLIST = [
  "Check each defender's snap share from last week on his profile. A linebacker who left the field on passing downs is sharing the job, whatever his name.",
  "Look at who your defenders face. An offense that runs a lot of plays gives the other side a lot of chances to make tackles.",
  "Check the injury report for your own defenders, and for the starters ahead of your bench options on the depth chart.",
  "Wait for Thursday before you judge last week's tackle totals. Sleeper corrects stats through Thursday, and tackles are charted by the home team's stat crew.",
  "Before you add a defender from waivers, confirm he starts: find him on his team's depth chart.",
];

export function InSeasonChecklist() {
  const [done, setDone] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const count = done.filter(Boolean).length;
  return (
    <div className={PANEL}>
      <h3 className="text-base font-semibold text-ink">The weekly IDP checklist</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Five things to run through before lineups lock. Ticking them stores nothing.
      </p>
      <fieldset className="mt-3">
        <legend className="sr-only">Weekly IDP checklist</legend>
        <ul role="list" className="space-y-2">
          {CHECKLIST.map((item, i) => (
            <li key={item}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-line bg-base/60 px-3 py-2 text-sm text-ink-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan">
                <input
                  type="checkbox"
                  checked={done[i]}
                  onChange={(e) =>
                    setDone((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-cyan"
                />
                <span>{item}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <p aria-live="polite" className="mt-3 text-xs text-ink-subtle">
        {count} of {CHECKLIST.length} done.
      </p>
    </div>
  );
}
