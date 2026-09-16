"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

/**
 * The two interactive pieces of the Positional WAR guide.
 *
 * MoveTheLine lets the reader change the invented league's shape (team count,
 * one quarterback or superflex, two or three running backs) and watch the
 * replacement player move. The players do not change; the rules do. That the
 * same players get a different answer under different rules is the whole
 * lesson, so it is the one thing on the page a reader can flip themselves.
 *
 * WhichQuestion is a four-item quiz on the distinction the guide is most
 * careful about: whether a question is about the POSITION (Positional WAR,
 * which never reads a roster) or about ONE TEAM (projected wins, which does).
 *
 * Both are native form controls inside fieldsets, so keyboard movement,
 * checked state and the group's name come from the platform. The result
 * regions are polite live text, so a screen reader hears the change without
 * the focus moving.
 *
 * EVERY NUMBER IS INVENTED and the caption says so. The real curve on a
 * League Pulse page reads the league's own scoring settings and roster slots.
 *
 * NAMING RULE. The token WAR always sits beside "Positional" in every string
 * here, and the team-specific quantity is called "projected wins".
 */

/* ---------- Move the line ---------- */

type Teams = 10 | 12;
type QbSlots = 1 | 2;
type RbSlots = 2 | 3;

/**
 * Invented weekly points by rank, straight lines through the guide's own
 * table: QB1 22.0 and QB13 16.5; RB1 18.5 and RB28 8.5.
 */
function qbPoints(rank: number): number {
  return Math.max(4, 22.46 - 0.458 * rank);
}
function rbPoints(rank: number): number {
  return Math.max(2, 18.87 - 0.37 * rank);
}

/**
 * Where the replacement player sits. Quarterbacks: every quarterback slot is
 * filled by a quarterback, so the replacement is one past the last slot. Running
 * backs: the dedicated slots plus roughly a third of the flex spots, which is
 * how the guide arrives at "about RB28" for a twelve-team two-back league.
 */
function replacementRanks(teams: Teams, qb: QbSlots, rb: RbSlots) {
  const qbRank = teams * qb + 1;
  const rbRank = teams * rb + Math.round(teams / 3);
  return { qbRank, rbRank };
}

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

export function MoveTheLine() {
  const [teams, setTeams] = useState<Teams>(12);
  const [qb, setQb] = useState<QbSlots>(1);
  const [rb, setRb] = useState<RbSlots>(2);
  const groupId = useId();

  const { qbRank, rbRank } = replacementRanks(teams, qb, rb);
  const qbBest = qbPoints(1);
  const qbRep = qbPoints(qbRank);
  const rbBest = rbPoints(1);
  const rbRep = rbPoints(rbRank);
  const qbGap = qbBest - qbRep;
  const rbGap = rbBest - rbRep;
  const steeper = rbGap >= qbGap ? "running back" : "quarterback";

  return (
    <div
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: move the line
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          Every number in this box is invented to make the point. The real curve
          on your League Pulse page reads your league&apos;s own scoring and
          roster slots.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <RadioChips<Teams>
            legend="Teams"
            name={`${groupId}-teams`}
            value={teams}
            options={[
              { value: 10, label: "10 teams" },
              { value: 12, label: "12 teams" },
            ]}
            onChange={setTeams}
          />
          <RadioChips<QbSlots>
            legend="Quarterbacks started"
            name={`${groupId}-qb`}
            value={qb}
            options={[
              { value: 1, label: "One" },
              { value: 2, label: "Two (superflex)" },
            ]}
            onChange={setQb}
          />
          <RadioChips<RbSlots>
            legend="Running backs started"
            name={`${groupId}-rb`}
            value={rb}
            options={[
              { value: 2, label: "Two plus a flex" },
              { value: 3, label: "Three plus a flex" },
            ]}
            onChange={setRb}
          />
        </div>

        <div
          aria-live="polite"
          aria-atomic="true"
          className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Where the line lands
          </p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-base/60 px-3 py-2">
              <dt className="text-sm font-semibold text-ink">Quarterback</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-muted">
                The league starts {teams * qb} quarterbacks, so the replacement
                is about QB{qbRank}, at{" "}
                <span className="font-mono tabular-nums text-ink">
                  {qbRep.toFixed(1)}
                </span>{" "}
                a week. The best quarterback scores{" "}
                <span className="font-mono tabular-nums text-ink">
                  {qbBest.toFixed(1)}
                </span>
                , a gap of{" "}
                <span className="font-mono font-semibold tabular-nums text-brand-purple">
                  {qbGap.toFixed(1)}
                </span>
                .
              </dd>
            </div>
            <div className="rounded-card border border-line bg-base/60 px-3 py-2">
              <dt className="text-sm font-semibold text-ink">Running back</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-muted">
                Counting a share of the flex, the replacement is about RB
                {rbRank}, at{" "}
                <span className="font-mono tabular-nums text-ink">
                  {rbRep.toFixed(1)}
                </span>{" "}
                a week. The best running back scores{" "}
                <span className="font-mono tabular-nums text-ink">
                  {rbBest.toFixed(1)}
                </span>
                , a gap of{" "}
                <span className="font-mono font-semibold tabular-nums text-brand-cyan">
                  {rbGap.toFixed(1)}
                </span>
                .
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-ink">
            {steeper === "running back"
              ? "Running back is the steeper line in this league. The top quarterback still scores the most, and it still does not matter, because the free quarterback is nearly as good."
              : "Quarterback is now the steeper line. Nothing about any quarterback changed; the league simply needs twice as many of them, so the free one is much worse."}{" "}
            Positional WAR follows the gap.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Which question am I asking ---------- */

type Answer = "positional" | "team";

const QUIZ: { statement: string; answer: Answer; why: string }[] = [
  {
    statement:
      "Is running back scarcer than wide receiver in my league this year?",
    answer: "positional",
    why: "That is about the position, not about you. Positional WAR reads no roster, so it is the same answer for every manager in the league.",
  },
  {
    statement:
      "If I trade for this quarterback, how many more games does my team win?",
    answer: "team",
    why: "That depends on who you already start. It is projected wins, the team-specific number, and it can be tiny for a quarterback with a huge Positional WAR if you already start the second-best one.",
  },
  {
    statement:
      "Is the fourth-best tight end still worth a big waiver bid in a league like mine?",
    answer: "positional",
    why: "A league-wide pricing question. Positional WAR says how far the fourth tight end sits above the free one under your rules, before anyone's roster comes into it.",
  },
  {
    statement:
      "I already own two top-five running backs. What does adding a third do for me?",
    answer: "team",
    why: "Only your lineup can answer that, because the third back would replace a great starter rather than the replacement player. That is projected wins, and it is the number the FAAB calculator and Trade Ideas report.",
  },
];

const ANSWER_LABEL: Record<Answer, string> = {
  positional: "Positional WAR (about the position)",
  team: "Projected wins (about my team)",
};

export function WhichQuestion() {
  const [picked, setPicked] = useState<(Answer | null)[]>(() =>
    QUIZ.map(() => null),
  );
  const groupId = useId();
  const answered = picked.filter((p) => p !== null).length;
  const correct = picked.filter((p, i) => p === QUIZ[i].answer).length;

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Try it: which question am I asking?
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        For each question, say whether it is about the position or about your
        team. Nothing here is saved.
      </p>

      <ol role="list" className="mt-4 space-y-4">
        {QUIZ.map((item, i) => {
          const choice = picked[i];
          const isRight = choice === item.answer;
          return (
            <li key={item.statement}>
              <fieldset>
                <legend className="text-sm font-medium leading-relaxed text-ink">
                  <span className="sr-only">Question {i + 1}: </span>
                  {item.statement}
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["positional", "team"] as const).map((value) => {
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
                          onChange={() =>
                            setPicked((prev) =>
                              prev.map((p, j) => (j === i ? value : p)),
                            )
                          }
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
                        {ANSWER_LABEL[value]}
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
                      {isRight ? "Right. " : "Not quite. "}
                    </span>
                    <span className="text-ink-muted">{item.why}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Live only once the quiz is complete. Before that, each answer already
          speaks its own feedback, and a second live region firing on the same
          click gets queued behind it or dropped. */}
      <p
        aria-live={answered === QUIZ.length ? "polite" : "off"}
        aria-atomic="true"
        className="mt-3 text-xs font-semibold text-brand-cyan"
      >
        {answered} of {QUIZ.length} answered
        {answered === QUIZ.length
          ? `, ${correct} right. ${
              correct === QUIZ.length
                ? "You will never mix the two up again."
                : "Reread the ones marked not quite and try again."
            }`
          : ""}
      </p>
    </div>
  );
}
