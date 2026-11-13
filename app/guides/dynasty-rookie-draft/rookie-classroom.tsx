"use client";

import { useId, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { positionHeading, positionNoun } from "@/lib/site";
import { ringGeometry } from "@/lib/league-blueprint/ring-geometry";
import {
  CAPITAL_POSITIONS,
  DRAFT_CAPITAL,
  ROOKIE_PICK_HIT_RATES,
  clockCall,
  outOfTen,
  ownPicks,
  slotOdds,
  sortRookie,
  type CapitalDay,
  type CapitalPosition,
  type DepthPath,
  type DraftOrder,
  type Lane,
  type SlotBand,
  type TierShape,
} from "@/lib/guides/dynasty-rookie-draft";

/**
 * The interactive pieces of the dynasty rookie draft guide.
 *
 * PickFinder lists the picks a team holds from its draft slot, in a linear or
 * a snake draft. PickOdds draws the Dynasty Nerds hit rates as two meters.
 * CapitalExplorer is the Footballguys draft capital study, one position at a
 * time, as a real table whose cells carry their own bars. RookieSorter and
 * ClockCall run the guide's own rules of thumb, and say that is what they are.
 * PostDraftChecklist is a list of real checkboxes; nothing is stored, because
 * a saved checklist would carry last year's ticks into this year's draft.
 *
 * Every control is a native form control inside a fieldset, so keyboard
 * movement, checked state and each group's name come from the platform. Each
 * result sits in a polite live region, and only the short verdict is live, so
 * arrowing through a group does not re-read a paragraph per option.
 */

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-subtle";
const BOX_TITLE = "text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan";
const SELECT_CLASS =
  "mt-1.5 block min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

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
    <fieldset className="min-w-0">
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

/** The gradient-edged box every "try it" piece sits in. */
function TryBox({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <div
      className="mt-6 rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-card bg-surface-elevated p-4 sm:p-5">
        <h3 className={BOX_TITLE}>{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{intro}</p>
        {children}
      </div>
    </div>
  );
}

function ordinalWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/* ---------- Lesson 1: which picks are yours ---------- */

export function PickFinder() {
  const groupId = useId();
  const [teams, setTeams] = useState<number>(12);
  const [rounds, setRounds] = useState<number>(4);
  const [order, setOrder] = useState<DraftOrder>("linear");
  const [slot, setSlot] = useState<number>(5);

  const mine = Math.min(slot, teams);
  const picks = ownPicks(teams, mine, rounds, order);

  return (
    <TryBox
      title="Try it: which picks are yours?"
      intro="Set your league and the slot you draft from. The list is every pick you hold before any trade. Nothing is saved."
    >
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
            setSlot((s) => Math.min(s, v));
          }}
        />
        <RadioChips<number>
          legend="Rounds"
          name={`${groupId}-rounds`}
          value={rounds}
          options={[
            { value: 3, label: "3" },
            { value: 4, label: "4" },
            { value: 5, label: "5" },
          ]}
          onChange={setRounds}
        />
        <RadioChips<DraftOrder>
          legend="Draft order"
          name={`${groupId}-order`}
          value={order}
          options={[
            { value: "linear", label: "Linear" },
            { value: "snake", label: "Snake" },
          ]}
          onChange={setOrder}
        />
        <div>
          <label htmlFor={`${groupId}-slot`} className="text-sm font-semibold text-ink">
            Your draft slot
          </label>
          <select
            id={`${groupId}-slot`}
            value={mine}
            onChange={(e) => setSlot(Number(e.target.value))}
            className={SELECT_CLASS}
          >
            {Array.from({ length: teams }, (_, i) => i + 1).map((s) => (
              <option key={s} value={s}>
                {ordinalWord(s)} of {teams}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
        <p className={LABEL}>Your picks</p>
        <p aria-live="polite" aria-atomic="true" className="mt-1 text-sm font-semibold text-ink">
          {order === "linear"
            ? `Linear: you pick ${ordinalWord(mine)} in every round.`
            : `Snake: you pick ${ordinalWord(mine)} in odd rounds and ${ordinalWord(teams - mine + 1)} in even rounds.`}
        </p>
        <ol role="list" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
          {picks.map((p) => (
            <li key={p.round} className="border-t border-line pt-2">
              <span className="block font-mono text-2xl font-black leading-none tabular-nums text-ink">{p.label}</span>
              <span className="mt-1 block font-mono text-[11px] tabular-nums text-ink-subtle">
                Pick {p.overall} overall
              </span>
            </li>
          ))}
        </ol>
      </div>
    </TryBox>
  );
}

/* ---------- Lesson 3: the odds at each slot ---------- */

const RING_SIZE = 132;
const RING_STROKE = 11;

function Meter({ id, pct, label, tone }: { id: string; pct: number; label: string; tone: "beacon" | "purple" }) {
  const r = ringGeometry(pct, RING_SIZE, RING_STROKE, 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          aria-hidden="true"
          className="pointer-events-none"
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#A855F7" />
              <stop offset="1" stopColor={tone === "beacon" ? "#22D3EE" : "#A855F7"} />
            </linearGradient>
          </defs>
          <circle cx={r.cx} cy={r.cy} r={r.r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={RING_STROKE} />
          {r.fraction > 0 && (
            <circle
              cx={r.cx}
              cy={r.cy}
              r={r.r}
              fill="none"
              stroke={`url(#${id})`}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={r.dashArray}
              transform={r.transform}
              style={{ transition: "stroke-dasharray 320ms ease" }}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-4xl font-black tabular-nums text-ink">
          {Math.round(pct)}%
        </span>
      </div>
      <span className={`mt-2 ${LABEL}`}>{label}</span>
    </div>
  );
}

export function PickOdds() {
  const groupId = useId();
  const [key, setKey] = useState<string>(ROOKIE_PICK_HIT_RATES[0].key);
  const rate = ROOKIE_PICK_HIT_RATES.find((h) => h.key === key) ?? ROOKIE_PICK_HIT_RATES[0];
  const n = outOfTen(rate.hit);
  const reading =
    rate.hit >= 66
      ? "This is the rare pick that usually becomes a player. Keep it unless the offer is a proven starter."
      : rate.hit >= 35
        ? "A coin flip at best. Fine to use, and fine to sell while a name is attached to it."
        : rate.hit >= 15
          ? "Most picks here miss. Draft for upside, and do not pay a starter's price to move up into this range."
          : "A long shot. Worth a roster spot only when the spot is free.";

  return (
    <TryBox
      title="Try it: the odds at your pick"
      intro="Pick a slot. The meters are the hit rates from the Dynasty Nerds study of 2018 to 2023 rookie drafts. Published figures, not ours."
    >
      <div className="mt-4">
        <RadioChips<string>
          legend="Where is the pick?"
          name={`${groupId}-slot`}
          value={key}
          options={ROOKIE_PICK_HIT_RATES.map((h) => ({ value: h.key, label: h.slot }))}
          onChange={setKey}
        />
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div aria-live="polite" aria-atomic="true" className="flex justify-center gap-6">
          <span className="sr-only">{rate.slot}: </span>
          <Meter id={`${groupId}-hit`} pct={rate.hit} label="Hit" tone="beacon" />
          <Meter id={`${groupId}-mid`} pct={rate.hitOrMid} label="Hit or mid" tone="purple" />
        </div>
        <div className="rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
          <p className={LABEL}>{rate.slot}</p>
          <p className="mt-1 text-base font-semibold text-ink">
            About {n} of every 10 picks here became a hit.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{reading}</p>
          <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
            A hit is one top-tier season or several second-tier ones. Hit or mid adds players with a useful season or
            two.
          </p>
        </div>
      </div>
    </TryBox>
  );
}

/* ---------- Lesson 6: draft capital, position by position ---------- */

function BarCell({ pct, tone }: { pct: number; tone: "cyan" | "purple" }) {
  return (
    <span className="flex items-center justify-end gap-2">
      {/* The track is decoration; below sm the column is the number alone, so
          the table fits a phone without scrolling sideways. */}
      <span aria-hidden="true" className="hidden h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-ink/[0.06] sm:block">
        <span
          className={`block h-full rounded-sm ${tone === "cyan" ? "bg-brand-cyan" : "bg-brand-purple"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-11 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-ink">
        {pct.toFixed(1)}%
      </span>
    </span>
  );
}

export function CapitalExplorer() {
  const groupId = useId();
  const [pos, setPos] = useState<CapitalPosition>("RB");
  const study = DRAFT_CAPITAL[pos];
  const r1 = study.rounds[0];
  const r2 = study.rounds[1];
  const day3 = study.rounds.slice(3);
  const day3Players = day3.reduce((s, r) => s + r.players, 0);
  const day3Top12 = day3.reduce((s, r) => s + Math.round((r.top12 * r.players) / 100), 0);

  return (
    <TryBox
      title="Try it: what NFL draft round buys"
      intro="Pick a position. Rookie-season fantasy finishes by NFL draft round, for every player drafted from 2016 to 2025, from Footballguys (Jason Wood, July 2026). Published figures, not ours."
    >
      <div className="mt-4">
        <RadioChips<CapitalPosition>
          legend="Position"
          name={`${groupId}-pos`}
          value={pos}
          options={CAPITAL_POSITIONS.map((p) => ({ value: p, label: positionHeading(p) }))}
          onChange={setPos}
        />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <p aria-live="polite" aria-atomic="true" className="border-t border-line pt-3">
          <span className="block font-mono text-4xl font-black leading-none tabular-nums text-ink sm:text-5xl">
            {r1.wide.toFixed(1)}%
          </span>
          <span className={`mt-2 block ${LABEL}`}>
            Of round 1 {positionNoun(pos, "plural")} were top {study.wideRank} as rookies
          </span>
        </p>
        <p className="border-t border-line pt-3">
          <span className="block font-mono text-2xl font-black leading-none tabular-nums text-ink sm:text-3xl">
            {r2.wide.toFixed(1)}%
          </span>
          <span className={`mt-2 block ${LABEL}`}>Of round 2, same bar</span>
        </p>
        <p className="border-t border-line pt-3">
          <span className="block font-mono text-2xl font-black leading-none tabular-nums text-ink sm:text-3xl">
            {day3Top12} of {day3Players}
          </span>
          <span className={`mt-2 block ${LABEL}`}>From rounds 4 to 7 were top 12 as rookies</span>
        </p>
      </div>

      <div
        className="mt-5 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        tabIndex={0}
        role="region"
        aria-label={`${positionHeading(pos)}: rookie-season finishes by NFL draft round`}
      >
        <table className="w-full border-collapse text-left text-xs sm:min-w-[26rem]">
          <caption className="sr-only">
            {positionHeading(pos)} drafted 2016 to 2025: share who finished in the top {study.wideRank} and in the top
            12 at the position in their rookie season, by NFL draft round.
          </caption>
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                NFL round
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                Drafted
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold sm:w-[36%] sm:text-left">
                Top {study.wideRank}
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold sm:w-[36%] sm:text-left">
                Top 12
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {study.rounds.map((r) => (
              <tr key={r.round}>
                <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
                  Round {r.round}
                </th>
                <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-muted">{r.players}</td>
                <td className="py-2 pr-3">
                  <BarCell pct={r.wide} tone="cyan" />
                </td>
                <td className="py-2">
                  <BarCell pct={r.top12} tone="purple" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
        {study.players} {positionNoun(pos, "plural")} in the sample. These are rookie-year finishes only. A player can miss as a rookie
        and still hit later, which is why the next lesson is about patience.
      </p>
    </TryBox>
  );
}

/* ---------- Lesson 7: sort a rookie ---------- */

export function RookieSorter() {
  const groupId = useId();
  const [capital, setCapital] = useState<CapitalDay>("day2");
  const [path, setPath] = useState<DepthPath>("open");
  const result = sortRookie(capital, path);

  return (
    <TryBox
      title="Try it: sort a rookie"
      intro="Two questions about any rookie. The answer is this guide's rule of thumb, not a model: capital tells you how long the team will wait, and the depth chart tells you how soon he plays."
    >
      <div className="mt-4 grid gap-4">
        <RadioChips<CapitalDay>
          legend="When was he taken in the NFL draft?"
          name={`${groupId}-capital`}
          value={capital}
          options={[
            { value: "day1", label: "Round 1" },
            { value: "day2", label: "Rounds 2 to 3" },
            { value: "day3", label: "Rounds 4 to 7 or undrafted" },
          ]}
          onChange={setCapital}
        />
        <RadioChips<DepthPath>
          legend="What is in front of him on the depth chart?"
          name={`${groupId}-path`}
          value={path}
          options={[
            { value: "open", label: "An open job" },
            { value: "shared", label: "A shared role" },
            { value: "blocked", label: "An established starter" },
          ]}
          onChange={setPath}
        />
      </div>
      <div className="mt-5 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
        <p className={LABEL}>He is a</p>
        <p aria-live="polite" aria-atomic="true" className="mt-1">
          <span className="block text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{result.title}</span>
          <span className="mt-1 block text-sm font-semibold text-brand-cyan">{result.move}.</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{result.body}</p>
      </div>
    </TryBox>
  );
}

/* ---------- Lesson 9: on the clock ---------- */

export function ClockCall() {
  const groupId = useId();
  const [lane, setLane] = useState<Lane>("rebuild");
  const [band, setBand] = useState<SlotBand>("mid1");
  const [tier, setTier] = useState<TierShape>("flat");
  const result = clockCall(lane, band, tier);

  return (
    <TryBox
      title="Try it: pick, trade back or sell?"
      intro="Three questions for the moment you are on the clock. The answer is this guide's rule of thumb, built on the hit rates in lesson 3."
    >
      <div className="mt-4 grid gap-4">
        <RadioChips<Lane>
          legend="Your team this season"
          name={`${groupId}-lane`}
          value={lane}
          options={[
            { value: "contend", label: "Contending" },
            { value: "middle", label: "In the middle" },
            { value: "rebuild", label: "Rebuilding" },
          ]}
          onChange={setLane}
        />
        <RadioChips<SlotBand>
          legend="Where is the pick?"
          name={`${groupId}-band`}
          value={band}
          options={[
            { value: "top4", label: "1.01 to 1.04" },
            { value: "mid1", label: "1.05 to 1.08" },
            { value: "late1", label: "1.09 to 1.12" },
            { value: "later", label: "Round 2 or later" },
          ]}
          onChange={setBand}
        />
        <RadioChips<TierShape>
          legend="Your board at this pick"
          name={`${groupId}-tier`}
          value={tier}
          options={[
            { value: "clear", label: "One player stands above the rest" },
            { value: "flat", label: "The next few look the same" },
          ]}
          onChange={setTier}
        />
      </div>
      <div className="mt-5 rounded-card border-l-4 border-brand-cyan/60 bg-base/60 p-3 sm:p-4">
        <p className={LABEL}>The call</p>
        <p
          aria-live="polite"
          aria-atomic="true"
          className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl"
        >
          {result.call}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{result.body}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">{slotOdds(band)}</p>
      </div>
    </TryBox>
  );
}

/* ---------- Lesson 10: the week after the draft ---------- */

const AFTER_DRAFT: { id: string; label: string }[] = [
  { id: "taxi", label: "Move every rookie who will not start for you onto the taxi squad." },
  { id: "cut", label: "Cut the veteran you kept only as insurance, to make the roster spots." },
  { id: "wire", label: "Check the waiver wire for undrafted rookies who signed into an open depth chart." },
  { id: "picks", label: "Count next year's picks. If you spent them, decide which lane that puts you in." },
  { id: "note", label: "Write down why you took each rookie, so you can tell a slow start from a wrong read." },
  { id: "date", label: "Set a review date after year two for each one. Not before." },
];

export function PostDraftChecklist() {
  const groupId = useId();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const count = AFTER_DRAFT.filter((i) => done[i.id]).length;
  const fraction = count / AFTER_DRAFT.length;

  return (
    <div className="mt-6 rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h3 className={BOX_TITLE}>The week after your draft</h3>
          <p className="mt-1 text-xs text-ink-subtle">Six jobs. Tick them off as you go. Nothing is saved.</p>
        </div>
        <p aria-live="polite" aria-atomic="true" className="text-right">
          <span className="block font-mono text-2xl font-black leading-none tabular-nums text-ink">
            {count} of {AFTER_DRAFT.length}
          </span>
          <span className={`mt-1 block ${LABEL}`}>Done</span>
        </p>
      </div>
      <span aria-hidden="true" className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
        <span
          className="block h-full rounded-full bg-beacon transition-[width] duration-300"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </span>
      <fieldset className="mt-4">
        <legend className="sr-only">Jobs for the week after your rookie draft</legend>
        <ul role="list" className="divide-y divide-line/70 border-y border-line">
          {AFTER_DRAFT.map((item) => (
            <li key={item.id}>
              <label
                htmlFor={`${groupId}-${item.id}`}
                className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm leading-relaxed text-ink-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan"
              >
                <input
                  id={`${groupId}-${item.id}`}
                  type="checkbox"
                  checked={!!done[item.id]}
                  onChange={(e) => setDone((d) => ({ ...d, [item.id]: e.target.checked }))}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-line bg-base accent-[#22D3EE]"
                />
                <span className={done[item.id] ? "text-ink" : ""}>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
