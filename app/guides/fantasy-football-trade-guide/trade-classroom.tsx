"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

/**
 * The two interactive pieces of the trade guide.
 *
 * SameTradeTwoWays puts one invented trade in front of the reader and lets them
 * say which team they are. The figures do not change, because the trade does
 * not change; the verdict does, because the reader did. That is the whole
 * lesson, so it is the one thing on the page a reader can flip themselves.
 *
 * SendChecklist is the pre-flight list from the end of the guide as real
 * checkboxes. Nothing is stored: it is a scratchpad for one trade, and a
 * persisted checklist would carry last week's ticks into this week's deal.
 *
 * Both are native form controls inside a fieldset, so keyboard movement,
 * checked state and the group's name come from the platform. The verdict
 * region is polite live text, so a screen reader hears the change without the
 * focus moving. The counter on the checklist is live for the same reason.
 *
 * EVERY NUMBER IS INVENTED and the caption says so.
 */

type Who = "contender" | "rebuilder";

const TRADE = {
  send: ["A 29-year-old WR1", "A 2027 second-round pick"],
  receive: ["A 23-year-old WR2", "A 2027 first-round pick"],
  valuePct: 9,
  winsDelta: -0.8,
  oddsBefore: 71,
  oddsAfter: 58,
};

const VERDICT: Record<Who, { label: string; body: string; tone: string }> = {
  contender: {
    label: "Decline, or ask for more",
    body: `You are 5 and 1 with the third-best roster. This deal takes ${Math.abs(TRADE.winsDelta).toFixed(1)} projected wins off your season and drops your playoff odds from ${TRADE.oddsBefore} to ${TRADE.oddsAfter} percent. The first-round pick cannot start for you in December. The ${TRADE.valuePct} percent of value you gain is real, and it is the wrong currency for the season you are in.`,
    tone: "border-brand-cyan/60",
  },
  rebuilder: {
    label: "Accept",
    body: `You are 1 and 5 and the season is already gone. The ${Math.abs(TRADE.winsDelta).toFixed(1)} projected wins you lose were never going to matter, and you turn a receiver who will be 30 next year into a 23-year-old and a first. The ${TRADE.valuePct} percent of value you gain is the currency you are collecting, and this is the price a contender pays in October.`,
    tone: "border-brand-purple/60",
  },
};

export function SameTradeTwoWays() {
  const [who, setWho] = useState<Who>("contender");
  const groupId = useId();
  const verdict = VERDICT[who];

  return (
    <div
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: the same trade, graded both ways
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          Every number in this box is invented to make the point.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-line bg-base/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              You send
            </p>
            <ul role="list" className="mt-1.5 space-y-1 text-sm text-ink">
              {TRADE.send.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-card border border-line bg-base/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              You receive
            </p>
            <ul role="list" className="mt-1.5 space-y-1 text-sm text-ink">
              {TRADE.receive.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-base/60 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
              Value
            </dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-brand-purple">
              Up {TRADE.valuePct}%
            </dd>
          </div>
          <div className="rounded-card border border-line bg-base/60 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
              Wins
            </dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-brand-cyan">
              Down {Math.abs(TRADE.winsDelta).toFixed(1)} wins
            </dd>
          </div>
          <div className="col-span-2 rounded-card border border-line bg-base/60 px-3 py-2 sm:col-span-1">
            <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
              Playoff odds
            </dt>
            <dd className="font-mono text-base font-semibold tabular-nums text-ink">
              {TRADE.oddsBefore}% to {TRADE.oddsAfter}%
            </dd>
          </div>
        </dl>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">
            Which team are you?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["contender", "A contender, 5 and 1"],
                ["rebuilder", "A rebuilder, 1 and 5"],
              ] as const
            ).map(([value, label]) => {
              const checked = who === value;
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
                    name={`${groupId}-who`}
                    value={value}
                    checked={checked}
                    onChange={() => setWho(value)}
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
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div
          aria-live="polite"
          aria-atomic="true"
          className={`mt-4 rounded-card border-l-4 bg-base/60 p-3 sm:p-4 ${verdict.tone}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Verdict for{" "}
            {who === "contender" ? "the contender" : "the rebuilder"}
          </p>
          <p className="mt-1 text-base font-semibold text-ink">
            {verdict.label}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            {verdict.body}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- The pre-send checklist ---------- */

const CHECKLIST = [
  "I know which of my starters this changes, by name, and by how much a week.",
  "I have counted the roster spot, and I know who fills it from my wire.",
  "I checked his snaps, routes or touches before I looked at his points.",
  "I know whether I am buying wins or buying futures, and I picked the right one for my record.",
  "I checked the bye weeks on both sides of the deal.",
  "I checked the schedule for weeks 15 to 17, because that is when I need the points.",
  "I would accept this exact offer if it came to me.",
  "I have a reason the other manager says yes, in their words, not mine.",
];

export function SendChecklist() {
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
        Nothing here is saved. Tick through it for one trade, then close the
        tab.
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
        {done === CHECKLIST.length ? ". Send it." : ""}
      </p>
    </fieldset>
  );
}
