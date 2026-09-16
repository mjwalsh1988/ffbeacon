"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

/**
 * The three interactive pieces of the superflex guide.
 *
 * QbRosterPlanner takes the three facts that decide how many quarterbacks a
 * roster needs (teams, whether the slot is superflex or true 2QB, and whether
 * the league is redraft, dynasty or best ball) and works the arithmetic the
 * guide teaches: starters needed, the free quarterback's rank, how many NFL
 * starters are left over, and a roster target with the reason attached. The
 * counts are the guide's own rules of thumb, stated as such; the starters and
 * the replacement rank are arithmetic.
 *
 * DraftSlotPlan is one invented plan per draft position for the first three
 * rounds of a twelve-team superflex draft. It changes nothing about the league;
 * it changes what the reader should do with their picks, which is the lesson.
 *
 * DraftChecklist is the pre-draft list from the end of the guide as real
 * checkboxes. Nothing is stored: it is a scratchpad for one draft.
 *
 * All three are native form controls inside a fieldset, so keyboard movement,
 * checked state and the group's name come from the platform. Each result is a
 * polite live region, so a screen reader hears the change without the focus
 * moving.
 *
 * THE ROSTER COUNTS ARE RULES OF THUMB and the box says so. NFL_TEAMS is the
 * number of teams in the league, which is where "about 32 starting
 * quarterbacks" comes from.
 */

const NFL_TEAMS = 32;

type Teams = 10 | 12 | 14;
type Slot = "superflex" | "2qb";
type Kind = "redraft" | "dynasty" | "bestball";

const KIND_LABEL: Record<Kind, string> = {
  redraft: "Redraft",
  dynasty: "Dynasty",
  bestball: "Best ball",
};

/** The roster target as a range, from the guide's own rules. */
function rosterTarget(teams: Teams, slot: Slot, kind: Kind): [number, number] {
  let low: number;
  let high: number;
  if (kind === "dynasty") {
    low = teams === 10 ? 3 : 4;
    high = teams === 14 ? 5 : 4;
  } else {
    low = 3;
    high = teams === 14 ? 4 : 3;
  }
  if (slot === "2qb") {
    low += 1;
    high += 1;
  }
  return [low, high];
}

function rangeText([low, high]: [number, number]): string {
  return low === high ? String(low) : `${low} to ${high}`;
}

function planReason(teams: Teams, slot: Slot, kind: Kind): string {
  const base =
    slot === "2qb"
      ? "Two must start every week with no other position allowed in the slot, so a bye or an injury with only two rostered is a zero, and you need a third to cover byes and a fourth for the week the third is on his."
      : "Two start every week, and the third covers the bye weeks and the one injury a season you should expect.";
  const kindNote =
    kind === "dynasty"
      ? " In dynasty a fourth is a stash rather than a waste: quarterbacks keep their value for years, and a backup who becomes a starter is a trade chip the whole league wants."
      : kind === "bestball"
        ? " In best ball nobody sets a lineup, so the third quarterback is your bye cover and your injury cover at once; a fourth only earns his spot in a fourteen-team room where the wire has nothing."
        : " In redraft a fourth quarterback is a bench spot that never scores. Trade him to the team with two before his bye week does it for you.";
  const sizeNote =
    teams === 14
      ? " Fourteen teams is the one size where the wire genuinely runs dry, which is why the top of the range moves up."
      : teams === 10
        ? " Ten teams leaves real starters on the wire all season, which is why you can hold the low end of the range."
        : "";
  return base + kindNote + sizeNote;
}

export function QbRosterPlanner() {
  const [teams, setTeams] = useState<Teams>(12);
  const [slot, setSlot] = useState<Slot>("superflex");
  const [kind, setKind] = useState<Kind>("redraft");
  const groupId = useId();

  const starters = teams * 2;
  const replacementRank = starters + 1;
  const leftOver = Math.max(0, NFL_TEAMS - starters);
  const target = rosterTarget(teams, slot, kind);

  return (
    <div
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
          Try it: how many quarterbacks does this league need?
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          The starters and the free quarterback&apos;s rank are arithmetic. The
          roster target is my rule of thumb, and the reason is written out so
          you can disagree with it.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <RadioGroup
            legend="How many teams?"
            name={`${groupId}-teams`}
            value={String(teams)}
            options={[
              ["10", "10 teams"],
              ["12", "12 teams"],
              ["14", "14 teams"],
            ]}
            onChange={(v) => setTeams(Number(v) as Teams)}
          />
          <RadioGroup
            legend="What kind of slot?"
            name={`${groupId}-slot`}
            value={slot}
            options={[
              ["superflex", "Superflex"],
              ["2qb", "True 2QB"],
            ]}
            onChange={(v) => setSlot(v as Slot)}
          />
          <RadioGroup
            legend="What kind of league?"
            name={`${groupId}-kind`}
            value={kind}
            options={[
              ["redraft", "Redraft"],
              ["dynasty", "Dynasty"],
              ["bestball", "Best ball"],
            ]}
            onChange={(v) => setKind(v as Kind)}
          />
        </div>

        <div
          aria-live="polite"
          aria-atomic="true"
          className="mt-4 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            {teams}-team {slot === "2qb" ? "2QB" : "superflex"},{" "}
            {KIND_LABEL[kind].toLowerCase()}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Readout
              label="Starters needed"
              value={String(starters)}
              tone="purple"
            />
            <Readout
              label="The free one"
              value={`QB${replacementRank}`}
              tone="cyan"
            />
            <Readout
              label="NFL starters left over"
              value={String(leftOver)}
              detail={`of about ${NFL_TEAMS}`}
            />
            <Readout
              label="Roster this many"
              value={rangeText(target)}
              tone="cyan"
            />
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            {planReason(teams, slot, kind)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  detail,
  tone = "plain",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "plain" | "cyan" | "purple";
}) {
  const color =
    tone === "cyan"
      ? "text-brand-cyan"
      : tone === "purple"
        ? "text-brand-purple"
        : "text-ink";
  return (
    <div className="rounded-card border border-line bg-base/60 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className={`font-mono text-base font-semibold tabular-nums ${color}`}>
        {value}
        {detail ? (
          <span className="ml-1 text-xs font-normal text-ink-subtle">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function RadioGroup({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([v, label]) => {
          const checked = value === v;
          return (
            <label
              key={v}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
                checked
                  ? "border-brand-cyan bg-brand-cyan/10 text-ink"
                  : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={v}
                checked={checked}
                onChange={() => onChange(v)}
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
  );
}

/* ---------- The draft slot plan ---------- */

type Pick = "early" | "middle" | "late";

const PLANS: Record<
  Pick,
  {
    label: string;
    picks: string;
    rounds: [string, string, string];
    note: string;
  }
> = {
  early: {
    label: "An early pick, 1 to 4",
    picks: "You pick around 3, then 22, then 27.",
    rounds: [
      "Round 1: take the best player on the board, quarterback or not. If the top quarterback is there and the room is one that starts its run early, he is a fine pick here; if the best running back is clearly better, take him and plan the quarterback for the turn.",
      "Round 2 and 3, the turn: you get two picks in a row with about twenty picks gone between them. This is where your pillar quarterback comes from if round 1 was not one. Take him with the first of the two and the best available player with the second, or the other way round if the quarterback tier still has three names in it.",
      "Round 4 to 6: your second quarterback. The run has usually passed by now and the fourth-round quarterback is a real starter with a full season of games. Do not leave round 6 without two.",
    ],
    note: "An early pick's problem is the long wait between picks. Plan your quarterback around the turn, where you control two picks in a row.",
  },
  middle: {
    label: "A middle pick, 5 to 8",
    picks: "You pick around 6, then 19, then 30.",
    rounds: [
      "Round 1: usually the best running back or receiver, because the middle of round 1 is where the elite non-quarterbacks are still there and the elite quarterbacks are already going. If a top-three quarterback falls to you, take him.",
      "Round 2 or 3: one quarterback, whichever of these two rounds still has a starter with a settled job. About twelve picks pass between each of your turns, so count how many quarterbacks are left in the tier before you wait.",
      "Round 4 to 6: the second quarterback. From the middle you have the most flexibility of anyone in the room, so let the run tell you when: the moment the room takes three quarterbacks in a row, take yours next.",
    ],
    note: "A middle pick is the most flexible seat in a superflex draft. The skill is counting the tier, not committing to a round.",
  },
  late: {
    label: "A late pick, 9 to 12",
    picks: "You pick around 11, then 14, then 35.",
    rounds: [
      "Round 1 and 2, the turn: you get two picks together and then about twenty-two picks pass. The quarterback run happens in that gap, every year, so one of these two picks is a quarterback. If two are still there, both can be, and you will have the best quarterback pair in the room.",
      "Round 3 and 4, the next turn: if you took one quarterback at the first turn, take the second here, before the gap. If you took two, this is where you catch up at running back and receiver with the players the quarterback run pushed down.",
      "Round 5 onward: the third quarterback, a backup with a path to starting, comes in the double-digit rounds, not here. Fill your lineup first.",
    ],
    note: "A late pick has the worst wait in the draft, so the turn is where you take your quarterback. Waiting through a twenty-two pick gap during the run is how a late-pick team ends up starting QB25.",
  },
};

export function DraftSlotPlan() {
  const [pick, setPick] = useState<Pick>("middle");
  const groupId = useId();
  const plan = PLANS[pick];

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Try it: where do you pick?
      </h3>
      <p className="mt-1 text-xs text-ink-subtle">
        A plan for the first six rounds of a twelve-team superflex redraft. A
        plan, not a law: the room decides when the run starts, and you adjust.
      </p>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-ink">
          Your draft slot
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(PLANS) as Pick[]).map((value) => {
            const checked = pick === value;
            return (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
                  checked
                    ? "border-brand-purple bg-brand-purple/10 text-ink"
                    : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
                }`}
              >
                <input
                  type="radio"
                  name={`${groupId}-pick`}
                  value={value}
                  checked={checked}
                  onChange={() => setPick(value)}
                  className="sr-only"
                />
                {checked ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-4 w-4 text-brand-purple"
                  />
                ) : (
                  <Circle
                    aria-hidden="true"
                    className="h-4 w-4 text-ink-subtle"
                  />
                )}
                {PLANS[value].label}
              </label>
            );
          })}
        </div>
      </fieldset>
      {/* Only the one-line header is live. The plan below it is about 250
          words, and re-reading all of it on every arrow key would bury the
          change; a reader hears which seat is selected and reads the plan at
          their own pace. */}
      <div className="mt-4 rounded-card border-l-4 border-brand-purple/60 bg-base/60 p-3 sm:p-4">
        <p
          aria-live="polite"
          aria-atomic="true"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
        >
          Plan for {plan.label.toLowerCase()}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{plan.picks}</p>
        <ol
          role="list"
          className="mt-3 space-y-2 text-sm leading-relaxed text-ink"
        >
          {plan.rounds.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 font-mono text-xs font-semibold text-brand-purple"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm font-medium leading-relaxed text-ink">
          {plan.note}
        </p>
      </div>
    </div>
  );
}

/* ---------- The pre-draft checklist ---------- */

const CHECKLIST = [
  "I know how many teams there are and whether the slot is superflex or true 2QB.",
  "I have counted the starters the league needs and how many NFL starters that leaves on the wire.",
  "I have a target number of quarterbacks for this format, and I know why it is that number.",
  "I looked at last year's draft in this room and know which round the quarterback run started.",
  "I have at least two pillar quarterbacks I would take in the first three rounds, so one going early does not wreck the plan.",
  "I have a short list of late quarterbacks with a settled job and a path to seventeen starts.",
  "I checked the bye weeks of the quarterbacks I am targeting against each other.",
  "I know whether this roster is redraft, keeper or dynasty, so I know whether a fourth quarterback is a stash or a wasted spot.",
];

export function DraftChecklist() {
  const [checked, setChecked] = useState<boolean[]>(() =>
    CHECKLIST.map(() => false),
  );
  const groupId = useId();
  const done = checked.filter(Boolean).length;

  return (
    <fieldset className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-ink">
        Before your superflex draft
      </legend>
      <p className="mt-1 text-xs text-ink-subtle">
        Nothing here is saved. Tick through it for one draft, then close the
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
        {done === CHECKLIST.length ? ". You are ready." : ""}
      </p>
    </fieldset>
  );
}
