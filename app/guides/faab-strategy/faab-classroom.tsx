"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

/**
 * The two interactive pieces of the FAAB guide.
 *
 * BidWorksheet lets the reader pick a remaining budget, a kind of pickup and
 * how many rivals need him, and prints the ladder the guide teaches: the value
 * ceiling from the band, the bid that usually wins from the room, and the
 * walk-away line. It is invented arithmetic that shows the SHAPE of the
 * calculator's answer; the real calculator prices a specific player against a
 * specific roster and reads real wallets. The caption says so.
 *
 * PreBidChecklist is the guide's own rules as real checkboxes. Nothing is
 * stored: it is a scratchpad for one claim, and a persisted checklist would
 * carry last week's ticks into this week's Tuesday.
 *
 * Both are native form controls inside fieldsets, so keyboard movement,
 * checked state and the group's name come from the platform. The result region
 * is polite live text, so a screen reader hears the change without the focus
 * moving. The counter on the checklist is live for the same reason.
 *
 * The band percentages are the calculator's DEFAULTS in
 * lib/faab/default-settings.ts, merged into the guide's four buckets. The
 * "to be sure" rung being about a third above the likely bid follows the
 * default ladder.aggressiveAbovePct of 35. EVERY DOLLAR FIGURE IS INVENTED.
 */

type Kind = "flyer" | "depth" | "starter" | "winner";
type Rivals = "one" | "two" | "five";

const BUDGETS = [100, 70, 40, 15] as const;

const KINDS: Record<
  Kind,
  { label: string; minPct: number; maxPct: number; note: string }
> = {
  flyer: {
    label: "A streamer or a flyer",
    minPct: 0,
    maxPct: 4,
    note: "One matchup, a bye fill, a dart throw.",
  },
  depth: {
    label: "Depth or a stash",
    minPct: 4,
    maxPct: 25,
    note: "A handcuff, a returning player, a rookie with a path.",
  },
  starter: {
    label: "A new weekly starter",
    minPct: 25,
    maxPct: 65,
    note: "A role change and a clear upgrade most weeks.",
  },
  winner: {
    label: "A league-winner",
    minPct: 65,
    maxPct: 100,
    note: "A full-time job in a good offense, starting for you every week.",
  },
};

const RIVALS: Record<Rivals, { label: string; share: number; note: string }> =
  {
    one: {
      label: "One other team",
      share: 0.55,
      note: "A bargain. You only have to beat one person.",
    },
    two: {
      label: "Two other teams",
      share: 0.7,
      note: "A real auction. Clear the higher wallet by a little.",
    },
    five: {
      label: "Five other teams",
      share: 0.9,
      note: "A bidding war. Usually one to let somebody else win.",
    },
  };

function oddUp(n: number): number {
  // People bid in round numbers; the guide says bid one over. A flyer stays
  // at the league minimum rather than being pushed to 3.
  if (n <= 1) return 1;
  return n % 2 === 0 ? n + 1 : n;
}

export function BidWorksheet() {
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]>(70);
  const [kind, setKind] = useState<Kind>("starter");
  const [rivals, setRivals] = useState<Rivals>("two");
  const groupId = useId();

  const band = KINDS[kind];
  const midPct = (band.minPct + band.maxPct) / 2;
  const ceiling = Math.max(1, Math.round((band.maxPct / 100) * budget));
  const worth = Math.max(1, Math.round((midPct / 100) * budget));
  const likely = Math.min(ceiling, oddUp(Math.round(worth * RIVALS[rivals].share)));
  const sure = Math.min(ceiling, Math.max(likely, oddUp(Math.round(likely * 1.35))));
  const war = rivals === "five" && kind !== "winner";

  const radioClass = (checked: boolean) =>
    `flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
      checked
        ? "border-brand-cyan bg-brand-cyan/10 text-ink"
        : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
    }`;

  const Mark = ({ checked }: { checked: boolean }) =>
    checked ? (
      <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
    ) : (
      <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />
    );

  return (
    <div
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: build a bid ladder
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          Every dollar in this box is invented arithmetic from the default
          bands. The real calculator prices a specific player against your
          actual roster and reads your league&apos;s real wallets.
        </p>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">
            How much do you have left?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {BUDGETS.map((b) => {
              const checked = budget === b;
              return (
                <label key={b} className={radioClass(checked)}>
                  <input
                    type="radio"
                    name={`${groupId}-budget`}
                    value={b}
                    checked={checked}
                    onChange={() => setBudget(b)}
                    className="sr-only"
                  />
                  <Mark checked={checked} />
                  {b} dollars
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">
            What kind of pickup is he?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(Object.keys(KINDS) as Kind[]).map((k) => {
              const checked = kind === k;
              return (
                <label key={k} className={radioClass(checked)}>
                  <input
                    type="radio"
                    name={`${groupId}-kind`}
                    value={k}
                    checked={checked}
                    onChange={() => setKind(k)}
                    className="sr-only"
                  />
                  <Mark checked={checked} />
                  <span>
                    <span className="block">{KINDS[k].label}</span>
                    <span className="block text-xs text-ink-subtle">
                      {KINDS[k].note}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">
            How many other teams need him?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(RIVALS) as Rivals[]).map((r) => {
              const checked = rivals === r;
              return (
                <label key={r} className={radioClass(checked)}>
                  <input
                    type="radio"
                    name={`${groupId}-rivals`}
                    value={r}
                    checked={checked}
                    onChange={() => setRivals(r)}
                    className="sr-only"
                  />
                  <Mark checked={checked} />
                  {RIVALS[r].label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div
          aria-live="polite"
          aria-atomic="true"
          className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Your ladder, with {budget} dollars left
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                Bid this
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-brand-cyan">
                {likely} dollars
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                To be sure
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-brand-purple">
                {sure} dollars
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
                Walk away above
              </dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-ink">
                {ceiling} dollars
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {band.label} sits in the {band.minPct} to {band.maxPct} percent
            band, so the most he is worth to your lineup is about {ceiling} of
            your {budget}. {RIVALS[rivals].note}
            {war
              ? " With that many teams chasing him, the winning bid will usually land close to the ceiling, and the right move is often to let it."
              : " Bid an odd number: it wins the ties you did not know you were in."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- The pre-bid checklist ---------- */

const CHECKLIST = [
  "I know how many weeks he starts for me between now and the end of the season.",
  "I know how many more points he scores in those weeks than the player I am cutting.",
  "I looked at his snaps and touches before I looked at his points.",
  "I know what week it is, and I priced the dollar for that week, not for September.",
  "I checked what the other teams who need him have left to spend.",
  "I know who I am dropping, and he is not a handcuff or a dynasty asset.",
  "I have a walk-away number, and I wrote it down before I wrote the bid.",
  "My bid is an odd number.",
];

export function PreBidChecklist() {
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
        Nothing here is saved. Tick through it for one claim, then close the
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
        {done === CHECKLIST.length ? ". Put the bid in." : ""}
      </p>
    </fieldset>
  );
}
