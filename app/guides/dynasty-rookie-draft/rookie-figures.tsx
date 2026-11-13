import Link from "next/link";
import { ChartFigure, DataTable, Td, Th, linePath, makeScale } from "@/components/chart-kit";
import { formatEasternDate, formatEasternShortDate } from "@/lib/datetime";
import { ROOKIE_PICK_HIT_RATES } from "@/lib/guides/dynasty-rookie-draft";
import type {
  ClassBoard,
  PickMarket,
  PriceHistory,
  QbGap,
  RookieDraftFacts,
  Share,
} from "@/lib/guides/rookie-draft-data";

/**
 * The figures in the dynasty rookie draft guide.
 *
 * TWO KINDS OF NUMBER LIVE HERE, AND EACH FIGURE SAYS WHICH IT IS.
 *
 *   - LIVE. Read from this site's own tables through
 *     lib/guides/rookie-draft-data.ts: the shape and timing of real rookie
 *     drafts, where the newest class went in them, and what each pick slot
 *     costs today. Every caption names the count behind it, and the two value
 *     figures name the value source and the league format.
 *   - PUBLISHED. The price calendar carries the finding of a named study
 *     (Footballguys), and the key figures quote Dynasty Nerds. Each says so.
 *
 * The page's hierarchy follows the Team Blueprint: the number a reader came
 * for is large and set in the mono face, and everything that explains it is
 * small. A figure is always one real text node. Bars, tracks and lines are
 * decoration and are hidden from a screen reader; the words and numbers beside
 * them are not, and every chart keeps its values in a table under a
 * disclosure.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";

const HERO = "font-mono text-4xl font-black leading-none tabular-nums text-ink sm:text-5xl";
const FIGURE = "font-mono text-2xl font-black leading-none tabular-nums text-ink sm:text-3xl";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-subtle";
const NOTE = "text-xs leading-relaxed text-ink-muted";
const LINK = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";
/** A player's name in a ruled row: a 44px target that still truncates. */
const ROW_LINK =
  "flex min-h-11 min-w-0 items-center text-sm font-semibold text-ink underline-offset-2 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** A week key (a UTC Monday) as a calendar date, read at noon so no zone moves it a day. */
function weekDate(week: string, withYear = false): string {
  const iso = `${week}T12:00:00Z`;
  return withYear ? formatEasternDate(iso) : formatEasternShortDate(iso);
}

/** "2.01" for a 12-team average pick of 13.4. */
export function pickLabel(adp: number): string {
  const pick = Math.max(1, Math.round(adp));
  const round = Math.floor((pick - 1) / 12) + 1;
  const slot = ((pick - 1) % 12) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

/** A share as text. One draft in several hundred rounds to 0, which would read as none. */
function shareText(s: Share): string {
  return s.pct === 0 && s.count > 0 ? "Under 1%" : `${s.pct}%`;
}

function Readout({ value, label, note }: { value: string; label: string; note?: string }) {
  // The figure is drawn first and its label under it, so a row of readouts
  // keeps its numbers on one line however the labels wrap. The DOM order is
  // still term, then value, then note.
  return (
    <div className="flex min-w-0 flex-col border-t border-line pt-3">
      <dt className={`order-2 mt-2 ${LABEL}`}>{label}</dt>
      <dd className={`order-1 ${FIGURE}`}>{value}</dd>
      {note ? <dd className={`order-3 mt-1 ${NOTE}`}>{note}</dd> : null}
    </div>
  );
}

/* ---------- The short version: four figures ---------- */

export function KeyFigures({ facts }: { facts: RookieDraftFacts | null }) {
  const pct = (key: string) => Math.round(ROOKIE_PICK_HIT_RATES.find((h) => h.key === key)?.hit ?? 0);
  const published = [
    { value: `${pct("101")}%`, label: "Hit rate at the 1.01", note: "Dynasty Nerds, rookie drafts 2018 to 2023." },
    {
      value: `${pct("300")}%`,
      label: "Hit rate in round 3",
      note: "Same study. Most late picks never start for you.",
    },
  ];
  const live = facts
    ? [
        {
          value: `${facts.linearPct}%`,
          label: "Of rookie drafts are linear",
          note: `${facts.drafts.toLocaleString("en-US")} Sleeper rookie drafts synced on FF Beacon in ${facts.season}.`,
        },
        {
          value: facts.busiestMonth,
          label: "Busiest month to draft",
          note: `${facts.busiestMonthPct}% of those drafts started then.`,
        },
      ]
    : [
        {
          value: `${pct("102")}%`,
          label: "Hit rate, picks 1.02 to 1.04",
          note: "Same study. The top four are a different kind of pick.",
        },
        { value: `${pct("201")}%`, label: "Hit rate, early round 2", note: "Same study. About one in five." },
      ];
  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5 lg:grid-cols-4">
      {[...live, ...published].map((f) => (
        <Readout key={f.label} {...f} />
      ))}
    </dl>
  );
}

/* ---------- Shared: a labeled share bar ---------- */

function ShareBars({ shares, tone }: { shares: Share[]; tone: "cyan" | "purple" }) {
  const top = shares.reduce((m, s) => Math.max(m, s.pct), 0);
  return (
    <ul role="list" className="space-y-1.5">
      {shares.map((s) => (
        <li key={s.key} className="grid grid-cols-[5.5rem_1fr_4.25rem] items-center gap-2 text-xs">
          <span className="font-medium text-ink">{s.label}</span>
          <span aria-hidden="true" className="h-3 overflow-hidden rounded-sm bg-ink/[0.06]">
            <span
              className={`block h-full rounded-sm ${tone === "cyan" ? "bg-brand-cyan" : "bg-brand-purple"} ${
                s.pct === top ? "" : "opacity-45"
              }`}
              style={{ width: `${Math.max(s.pct, s.count > 0 ? 1 : 0)}%` }}
            />
          </span>
          <span className="text-right font-mono font-semibold tabular-nums text-ink">{shareText(s)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Lesson 1: the shape of a rookie draft ---------- */

export function DraftShapeFigure({ facts }: { facts: RookieDraftFacts }) {
  const n = facts.drafts.toLocaleString("en-US");
  return (
    <ChartFigure
      titleLevel={3}
      title={`What ${n} real rookie drafts looked like`}
      description={`Live, not invented. Every completed rookie-only draft FF Beacon synced from Sleeper in ${facts.season}: the order it ran in, how many rounds it lasted and how many teams took part.`}
      summary={`Of ${n} rookie drafts in ${facts.season}, ${facts.linearPct} percent were linear. The most common length was ${facts.commonRounds} rounds, at ${facts.commonRoundsPct} percent of drafts, and the most common league size was ${facts.commonTeams} teams, at ${facts.commonTeamsPct} percent.`}
      table={
        <DataTable
          caption={`Rookie draft length and league size in ${facts.season}, as a share of ${n} drafts.`}
          head={
            <>
              <Th>Setting</Th>
              <Th numeric>Drafts</Th>
              <Th numeric>Share</Th>
            </>
          }
        >
          {[...facts.rounds, ...facts.teams].map((s) => (
            <tr key={s.label}>
              <Td>{s.label}</Td>
              <Td numeric>{s.count}</Td>
              <Td numeric>{shareText(s)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Readout value={`${facts.linearPct}%`} label="Linear order" note="Every round runs worst team first." />
        <Readout
          value={`${facts.commonRounds} rounds`}
          label="Most common length"
          note={`${facts.commonRoundsPct}% of drafts.`}
        />
        <Readout
          value={`${facts.commonTeams} teams`}
          label="Most common size"
          note={`${facts.commonTeamsPct}% of drafts.`}
        />
      </dl>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <p className={`mb-2 ${LABEL}`}>How many rounds</p>
          <ShareBars shares={facts.rounds} tone="cyan" />
        </div>
        <div>
          <p className={`mb-2 ${LABEL}`}>How many teams</p>
          <ShareBars shares={facts.teams} tone="purple" />
        </div>
      </div>
    </ChartFigure>
  );
}

/* ---------- Lesson 2: when rookie drafts start ---------- */

export function DraftMonthFigure({ facts }: { facts: RookieDraftFacts }) {
  const n = facts.drafts.toLocaleString("en-US");
  const top = facts.months.reduce((m, s) => Math.max(m, s.pct), 0);
  const august = facts.months.find((m) => m.label === "August");
  return (
    <ChartFigure
      titleLevel={3}
      title="The month each rookie draft started"
      description={`Live, not invented. The date of the first pick in ${n} completed Sleeper rookie drafts in ${facts.season}, by month, in Eastern time.`}
      summary={`${facts.busiestMonthPct} percent of ${facts.season} rookie drafts started in ${facts.busiestMonth}, the busiest month, and ${facts.byEndOfMayPct} percent had started by the end of May.${
        august ? ` A second, smaller group of ${august.pct} percent started in August.` : ""
      }`}
      table={
        <DataTable
          caption={`Rookie draft start month in ${facts.season}, as a share of ${n} drafts.`}
          head={
            <>
              <Th>Month</Th>
              <Th numeric>Drafts</Th>
              <Th numeric>Share</Th>
            </>
          }
        >
          {facts.months.map((s) => (
            <tr key={s.key}>
              <Td>{s.label}</Td>
              <Td numeric>{s.count}</Td>
              <Td numeric>{shareText(s)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-end">
        <p>
          <span className={`block ${HERO}`}>{facts.byEndOfMayPct}%</span>
          <span className={`mt-2 block ${LABEL}`}>Started by May 31</span>
          <span className={`mt-1.5 block ${NOTE}`}>The NFL draft is held in late April.</span>
        </p>
        <ol
          role="list"
          className="grid items-end gap-1.5"
          style={{ gridTemplateColumns: `repeat(${facts.months.length}, minmax(0, 1fr))` }}
        >
          {facts.months.map((s) => (
            <li key={s.key} className="flex min-w-0 flex-col items-center">
              <span className="whitespace-nowrap font-mono text-xs font-bold tabular-nums text-ink sm:text-sm">
                {s.pct === 0 && s.count > 0 ? "<1%" : `${s.pct}%`}
              </span>
              <span aria-hidden="true" className="mt-1 flex h-28 w-full items-end rounded-sm bg-ink/[0.04] sm:h-32">
                <span
                  className={`block w-full rounded-sm ${s.pct === top ? "bg-brand-cyan" : "bg-brand-purple/60"}`}
                  style={{ height: `${top > 0 ? Math.max(2, (100 * s.pct) / top) : 0}%` }}
                />
              </span>
              <span className="mt-1.5 w-full truncate text-center text-[10px] font-medium text-ink-muted sm:text-[11px]">
                {/* A phone has room for three letters. The short form is for
                    the eye only; a screen reader gets the whole month. */}
                <span aria-hidden="true" className="sm:hidden">
                  {s.label.slice(0, 3)}
                </span>
                <span className="sr-only sm:not-sr-only">{s.label}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </ChartFigure>
  );
}

/* ---------- Lesson 4: the pick ladder ---------- */

const ROUND_TONE = ["bg-brand-cyan", "bg-brand-purple", "bg-brand-purple/60", "bg-ink/40", "bg-ink/30", "bg-ink/25"];

export function PickLadderFigure({ market }: { market: PickMarket }) {
  const { ladder, sourceName, format, asOf } = market;
  const slot = (key: string) => ladder.slots.find((s) => s.key === key) ?? null;
  const mid1 = slot("1-mid");
  const late1 = slot("1-late");
  const mid2 = slot("2-mid");
  const mid3 = slot("3-mid");
  const rounds = [...new Set(ladder.slots.map((s) => s.round))];
  const asOfText = asOf ? ` Values as of ${formatEasternDate(asOf)}, refreshed with the nightly sync.` : "";
  const parts = [
    mid1 ? `a mid first is priced at ${mid1.index} percent of an early first` : null,
    late1 ? `a late first at ${late1.index} percent` : null,
    mid2 ? `a mid second at ${mid2.index} percent` : null,
    mid3 ? `a mid third at ${mid3.index} percent` : null,
  ].filter(Boolean);

  return (
    <ChartFigure
      titleLevel={3}
      title={`What each ${ladder.season} rookie pick costs today`}
      description={`Live, not invented. ${sourceName}'s ${format.displayName} value for every ${ladder.season} rookie pick slot, with the early first set to 100.${asOfText}`}
      summary={`In ${sourceName}'s ${format.displayName} values for the ${ladder.season} rookie draft, ${parts.join(", ")}.${
        ladder.nextYearDiscountPct !== null
          ? ` A mid first in the ${ladder.season + 1} draft costs ${ladder.nextYearDiscountPct} percent less than the same pick in ${ladder.season}.`
          : ""
      }`}
      table={
        <DataTable
          caption={`${sourceName} ${format.displayName} values for ${ladder.season} rookie picks.`}
          head={
            <>
              <Th>Pick</Th>
              <Th numeric>Value</Th>
              <Th numeric>Early 1st = 100</Th>
            </>
          }
        >
          {ladder.slots.map((s) => (
            <tr key={s.key}>
              <Td>{s.label}</Td>
              <Td numeric>{Math.round(s.value).toLocaleString("en-US")}</Td>
              <Td numeric>{s.index}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {mid2 ? (
          <Readout
            value={`${mid2.index}%`}
            label="Mid 2nd, against an early 1st"
            note="Its hit rate in lesson 3 is about a quarter of a top-four pick's."
          />
        ) : null}
        {mid3 ? <Readout value={`${mid3.index}%`} label="Mid 3rd, against an early 1st" /> : null}
        {ladder.nextYearDiscountPct !== null ? (
          <Readout
            value={`${ladder.nextYearDiscountPct}%`}
            label={`Discount on a ${ladder.season + 1} mid 1st`}
            note={`Against the same pick in ${ladder.season}.`}
          />
        ) : null}
      </dl>
      <div className="mt-6 space-y-4">
        {rounds.map((round, i) => (
          <ul key={round} role="list" className="space-y-1.5">
            {ladder.slots
              .filter((s) => s.round === round)
              .map((s) => (
                <li key={s.key} className="grid grid-cols-[4.75rem_1fr_2.5rem] items-center gap-2 text-xs sm:grid-cols-[5.5rem_1fr_6.5rem]">
                  <span className="font-medium text-ink">{s.label}</span>
                  <span aria-hidden="true" className="h-4 overflow-hidden rounded-sm bg-ink/[0.06]">
                    <span className={`block h-full rounded-sm ${ROUND_TONE[i] ?? "bg-ink/25"}`} style={{ width: `${Math.min(100, s.index)}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums">
                    <span className="text-sm font-bold text-ink">{s.index}</span>
                    <span className="hidden text-ink-subtle sm:inline"> ({Math.round(s.value).toLocaleString("en-US")})</span>
                  </span>
                </li>
              ))}
          </ul>
        ))}
      </div>
      <p className={`mt-4 ${NOTE}`}>
        The bold figure is the index, and the figure in brackets on wider screens is the raw value, which is also in
        the table. A trade is not simple addition, so price a real offer in the{" "}
        <Link href="/tools/trade-calculator" className={LINK}>
          trade calculator
        </Link>
        , which adjusts for how many pieces are on each side.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: the published price calendar ---------- */

type Period = {
  months: string;
  name: string;
  move: "Rising" | "Falling";
  detail: string;
  span: number;
};

// Footballguys, Dynasty Investor (Jay Stein, March 2024): KeepTradeCut prices
// for 2024 and 2025 rookie picks across calendar 2023, in the study's own four
// periods. One year of prices, as the study itself says.
const PERIODS: Period[] = [
  {
    months: "January and February",
    name: "NFL playoffs",
    move: "Rising",
    detail: "Picks gain value as the season ends and attention turns to the next class.",
    span: 2,
  },
  {
    months: "March to May",
    name: "Draft season",
    move: "Rising",
    detail: "The top of the market. The best time to sell is right after the NFL draft and during rookie drafts.",
    span: 3,
  },
  {
    months: "June to August",
    name: "Offseason",
    move: "Falling",
    detail: "Picks generally lose value. First-round picks mostly held their price in the study.",
    span: 3,
  },
  {
    months: "September to December",
    name: "Regular season",
    move: "Rising",
    detail: "The best time to buy is the start of September, before prices climb again.",
    span: 4,
  },
];

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function PriceCalendarFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="The rookie pick price calendar"
      description="Published, not ours. Footballguys' Dynasty Investor study (Jay Stein, March 2024) followed KeepTradeCut prices for 2024 and 2025 rookie picks through 2023. One year of prices, as the study itself notes."
      summary="In the Footballguys study, rookie picks rose in January and February, rose again from March to May, fell from June to August, and rose from September to December. The best time to sell was right after the NFL draft and during rookie drafts in May. The best time to buy was the start of September. First-round picks mostly held their price through the summer."
      tableLabel="View the four periods as a table"
      table={
        <DataTable
          caption="How rookie pick prices moved in each part of the year, from the Footballguys study."
          head={
            <>
              <Th>Months</Th>
              <Th>Period</Th>
              <Th>Direction</Th>
              <Th>Detail</Th>
            </>
          }
        >
          {PERIODS.map((p) => (
            <tr key={p.months}>
              <Td>{p.months}</Td>
              <Td>{p.name}</Td>
              <Td>{p.move}</Td>
              <Td>{p.detail}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="grid grid-cols-12 gap-0.5 text-center font-mono text-[10px] text-ink-subtle">
        {MONTH_INITIALS.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 grid grid-cols-12 gap-0.5">
        {PERIODS.map((p) => (
          <span
            key={p.months}
            className={`h-3 rounded-sm ${p.move === "Rising" ? "bg-brand-cyan" : "bg-brand-purple/70"}`}
            style={{ gridColumn: `span ${p.span} / span ${p.span}` }}
          />
        ))}
      </div>
      <ol role="list" className="mt-4 grid gap-2 sm:grid-cols-2">
        {PERIODS.map((p) => (
          <li
            key={p.months}
            className={`rounded-card border p-3 ${
              p.move === "Rising" ? "border-brand-cyan/50 bg-brand-cyan/5" : "border-brand-purple/50 bg-brand-purple/5"
            }`}
          >
            <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-ink-subtle">{p.months}</span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-lg font-black text-ink">{p.move}</span>
              <span className="text-xs font-semibold text-ink-muted">{p.name}</span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{p.detail}</span>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: our own recorded prices ---------- */

function signed(pct: number): string {
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(1)}%`;
}

function historyReading(h: PriceHistory): string {
  const direction = h.changePct > 0.5 ? "higher than" : h.changePct < -0.5 ? "lower than" : "about level with";
  const drop =
    h.dropFromHighPct >= 3
      ? ` Its highest week was the week of ${weekDate(h.high.week, true)}, and it fell ${h.dropFromHighPct.toFixed(1)} percent from there to its lowest week since.`
      : " It has not fallen more than 3 percent from its highest week.";
  return `A mid first in the ${h.season} rookie draft is ${direction} where it stood in the week of ${weekDate(h.start.week, true)}, a change of ${signed(h.changePct)}.${drop}`;
}

export function PriceHistoryFigure({ market, history }: { market: PickMarket; history: PriceHistory }) {
  const W = 600;
  const H = 200;
  const PAD = 10;
  const values = history.points.flatMap((p) => [p.first, p.second]).filter((v): v is number => v !== null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = makeScale(0, Math.max(1, history.points.length - 1), PAD, W - PAD);
  const y = makeScale(lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08, H - PAD, PAD);
  const series = (key: "first" | "second") =>
    history.points
      .map((p, i) => ({ v: p[key], i }))
      .filter((p): p is { v: number; i: number } => p.v !== null)
      .map((p) => ({ x: x(p.i), y: y(p.v) }));
  const firstPts = series("first");
  const secondPts = series("second");
  const first = history.points[0];
  const last = history.points[history.points.length - 1];
  const reading = historyReading(history);
  // A source that changed how it prices picks would draw its own change as a
  // market move, so the line starts after the last such change and says so.
  const since = history.methodChangedOn
    ? `from the week after ${market.sourceName} last changed how it prices picks (${weekDate(history.methodChangedOn, true)})`
    : "from the first week we recorded it";

  return (
    <ChartFigure
      titleLevel={3}
      title={`A ${history.season} rookie pick, week by week`}
      description={`Live, not invented. ${market.sourceName}'s ${market.format.displayName} value for a mid first and a mid second in the ${history.season} rookie draft, averaged by week, ${since}. The line grows every week.`}
      summary={`${reading} Recorded from the week of ${weekDate(first.week, true)} to the week of ${weekDate(last.week, true)}.`}
      table={
        <DataTable
          caption={`Weekly average value of ${history.season} mid first and mid second rookie picks, ${market.sourceName}, ${market.format.displayName}.`}
          head={
            <>
              <Th>Week of</Th>
              <Th numeric>Mid 1st</Th>
              <Th numeric>Mid 2nd</Th>
            </>
          }
        >
          {history.points.map((p) => (
            <tr key={p.week}>
              <Td>{weekDate(p.week, true)}</Td>
              <Td numeric>{p.first === null ? "No value" : p.first.toLocaleString("en-US")}</Td>
              <Td numeric>{p.second === null ? "No value" : p.second.toLocaleString("en-US")}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Readout
          value={signed(history.changePct)}
          label="Mid 1st since the line began"
          note={`From the week of ${weekDate(history.start.week)}.`}
        />
        <Readout
          value={history.dropFromHighPct > 0 ? `-${history.dropFromHighPct.toFixed(1)}%` : "0.0%"}
          label="Highest week to the low after it"
          note={`High: week of ${weekDate(history.high.week)}.`}
        />
        <Readout
          value={history.latest.value.toLocaleString("en-US")}
          label="Mid 1st value now"
          note={`${market.sourceName}, ${market.format.displayName}.`}
        />
      </dl>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="pointer-events-none mt-5 block h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - 2 * PAD)} y2={PAD + f * (H - 2 * PAD)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
        ))}
        <path d={linePath(secondPts)} fill="none" stroke={CYAN} strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round" />
        <path d={linePath(firstPts)} fill="none" stroke={PURPLE} strokeWidth="3.5" strokeLinejoin="round" />
        {firstPts.length > 0 ? (
          <circle cx={firstPts[firstPts.length - 1].x} cy={firstPts[firstPts.length - 1].y} r="5.5" fill={PURPLE} />
        ) : null}
        {secondPts.length > 0 ? (
          <rect x={secondPts[secondPts.length - 1].x - 5} y={secondPts[secondPts.length - 1].y - 5} width="10" height="10" fill={CYAN} />
        ) : null}
      </svg>
      <div aria-hidden="true" className="mt-1 flex justify-between font-mono text-[10px] text-ink-subtle">
        <span>{weekDate(first.week)}</span>
        <span>{weekDate(last.week)}</span>
      </div>
      <ul role="list" aria-hidden="true" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-ink-muted">
        <li className="flex items-center gap-1.5">
          <svg width="18" height="8" viewBox="0 0 18 8" className="pointer-events-none">
            <line x1="0" y1="4" x2="18" y2="4" stroke={PURPLE} strokeWidth="2.5" />
          </svg>
          Mid 1st (solid line, round marker)
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="18" height="8" viewBox="0 0 18 8" className="pointer-events-none">
            <line x1="0" y1="4" x2="18" y2="4" stroke={CYAN} strokeWidth="2.5" strokeDasharray="4 3" />
          </svg>
          Mid 2nd (dashed line, square marker)
        </li>
      </ul>
      <p className={`mt-3 ${NOTE}`}>
        {reading}
        {history.methodChangedOn
          ? ` The line starts after ${weekDate(history.methodChangedOn, true)}, when ${market.sourceName} changed how it prices picks. Prices from before that day are left out, because the step between them was the method and not the market.`
          : ""}
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 8: where the class went ---------- */

const POSITION_CHIP: Record<string, string> = {
  QB: "border-brand-purple/60 text-brand-purple",
  RB: "border-brand-cyan/60 text-brand-cyan",
  WR: "border-line-accent text-ink",
  TE: "border-line text-ink-muted",
};

export function ClassBoardFigure({ board }: { board: ClassBoard }) {
  const max = Math.max(36, ...board.players.map((p) => Math.min(p.latest, Math.ceil(p.adp + 2 * (p.stdev ?? 0)))));
  const at = (pick: number) => `${Math.min(100, Math.max(0, ((pick - 1) / (max - 1)) * 100))}%`;
  const first = board.players[0];
  const twelfth = board.players[11];
  const tight = board.spread[0];
  const loose = board.spread[board.spread.length - 1];
  const spreadText =
    tight.stdev !== null && loose.stdev !== null
      ? ` The first three picks varied by about ${tight.stdev.toFixed(1)} picks from draft to draft, and picks 13 to 24 by about ${loose.stdev.toFixed(1)}.`
      : "";

  return (
    <ChartFigure
      titleLevel={3}
      title={`Where the ${board.season} class went in ${board.drafts} real rookie drafts`}
      description={`Live, not invented. Every ${board.format.displayName} rookie draft FF Beacon synced from Sleeper in ${board.season}, with each pick scaled to a 12-team draft. The dot is the average pick, the bar is the usual range around it, and the thin line runs from the earliest pick to the latest.`}
      summary={`In ${board.drafts} ${board.format.displayName} rookie drafts in ${board.season}, ${first.name} went first on average, at pick ${first.adp.toFixed(1)}.${
        twelfth ? ` ${twelfth.name} was twelfth, at pick ${twelfth.adp.toFixed(1)}, and went as early as ${twelfth.earliest} and as late as ${twelfth.latest}.` : ""
      }${spreadText}`}
      tableLabel="View every player's picks as a table"
      table={
        <DataTable
          caption={`Average, earliest and latest pick for the first ${board.players.length} rookies in ${board.season} ${board.format.displayName} rookie drafts, scaled to 12 teams.`}
          head={
            <>
              <Th>Player</Th>
              <Th>Position</Th>
              <Th numeric>Average pick</Th>
              <Th numeric>Usual spread</Th>
              <Th numeric>Earliest</Th>
              <Th numeric>Latest</Th>
            </>
          }
        >
          {board.players.map((p) => (
            <tr key={p.rank}>
              <Td>{p.name}</Td>
              <Td>{p.position}</Td>
              <Td numeric>{p.adp.toFixed(1)}</Td>
              <Td numeric>{p.stdev === null ? "Not measured" : `${p.stdev.toFixed(1)} picks`}</Td>
              <Td numeric>{p.earliest}</Td>
              <Td numeric>{p.latest}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <p className={LABEL}>How many picks a player usually moved from one draft to the next</p>
      <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {board.spread.map((b) => (
          <Readout key={b.label} value={b.stdev === null ? "Not measured" : `${b.stdev.toFixed(1)}`} label={b.label} />
        ))}
      </dl>
      <ol role="list" className="mt-6 divide-y divide-line/70 border-y border-line">
        {board.players.map((p) => {
          const lo = Math.max(1, p.adp - (p.stdev ?? 0));
          const hi = p.adp + (p.stdev ?? 0);
          return (
            <li key={p.rank} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5.5rem]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-ink-subtle">{p.rank}</span>
                <span className={`shrink-0 rounded-sm border px-1 font-mono text-[10px] font-bold ${POSITION_CHIP[p.position]}`}>
                  {p.position}
                </span>
                {p.slug ? (
                  <Link href={`/players/${p.slug}`} className={ROW_LINK}>
                    <span className="truncate">{p.name}</span>
                  </Link>
                ) : (
                  <span className="flex min-h-11 min-w-0 items-center text-sm font-semibold text-ink">
                    <span className="truncate">{p.name}</span>
                  </span>
                )}
              </span>
              <span className="text-right sm:order-3">
                <span className="block font-mono text-lg font-black leading-none tabular-nums text-ink">{pickLabel(p.adp)}</span>
                <span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] tabular-nums text-ink-subtle">
                  {p.earliest} to {p.latest}
                </span>
              </span>
              <span aria-hidden="true" className="relative col-span-2 mx-1.5 h-4 sm:order-2 sm:col-span-1">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink/[0.08]" />
                <span
                  className="absolute top-1/2 h-px -translate-y-1/2 bg-ink/40"
                  style={{ left: at(p.earliest), right: `calc(100% - ${at(Math.min(p.latest, max))})` }}
                />
                <span
                  className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-beacon opacity-80"
                  style={{ left: at(lo), right: `calc(100% - ${at(hi)})`, minWidth: "4px" }}
                />
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base bg-ink"
                  style={{ left: at(p.adp) }}
                />
              </span>
            </li>
          );
        })}
      </ol>
      <p className={`mt-3 ${NOTE}`}>
        The large figure is the average pick written as round and slot in a 12-team draft, with the earliest and
        latest pick under it. The scale runs from pick 1 on the left to pick {max} on the right
        {board.players.some((p) => p.latest > max) ? "; a line that reaches the right edge went later than that" : ""}.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 8: the same quarterback, two kinds of league ---------- */

export function QbGapFigure({ gap }: { gap: QbGap }) {
  const lead = gap.rows[0];
  const max = Math.max(24, ...gap.rows.map((r) => Math.ceil(Math.max(r.oneQb, r.superflex))));
  const at = (pick: number) => `${Math.min(100, Math.max(0, ((pick - 1) / (max - 1)) * 100))}%`;
  return (
    <ChartFigure
      titleLevel={3}
      title="The same rookie quarterbacks, in two kinds of league"
      description={`Live, not invented. Average pick in ${gap.superflex.drafts} ${gap.superflex.displayName} rookie drafts against ${gap.oneQb.drafts} ${gap.oneQb.displayName} rookie drafts in ${gap.season}, each scaled to 12 teams.`}
      summary={`In ${gap.season} rookie drafts, ${lead.name} went at pick ${lead.superflex.toFixed(1)} on average in ${gap.superflex.displayName} leagues and at pick ${lead.oneQb.toFixed(1)} in ${gap.oneQb.displayName} leagues, ${Math.abs(lead.oneQb - lead.superflex).toFixed(1)} picks ${lead.oneQb >= lead.superflex ? "later" : "earlier"}.`}
      table={
        <DataTable
          caption={`Average rookie draft pick for quarterbacks in ${gap.season}, by league type, scaled to 12 teams.`}
          head={
            <>
              <Th>Quarterback</Th>
              <Th numeric>{gap.superflex.displayName}</Th>
              <Th numeric>{gap.oneQb.displayName}</Th>
              <Th numeric>Picks later in one-quarterback</Th>
            </>
          }
        >
          {gap.rows.map((r) => (
            <tr key={r.name}>
              <Td>{r.name}</Td>
              <Td numeric>{r.superflex.toFixed(1)}</Td>
              <Td numeric>{r.oneQb.toFixed(1)}</Td>
              <Td numeric>{(r.oneQb - r.superflex).toFixed(1)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="divide-y divide-line/70 border-y border-line">
        {gap.rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
            {r.slug ? (
              <Link href={`/players/${r.slug}`} className={ROW_LINK}>
                <span className="truncate">{r.name}</span>
              </Link>
            ) : (
              <span className="flex min-h-11 min-w-0 items-center text-sm font-semibold text-ink">
                <span className="truncate">{r.name}</span>
              </span>
            )}
            <span className="flex items-baseline gap-3 text-right sm:order-3">
              <span>
                <span className="block font-mono text-lg font-black leading-none tabular-nums text-brand-cyan">{pickLabel(r.superflex)}</span>
                <span className={`mt-0.5 block ${LABEL}`}>Superflex</span>
              </span>
              <span>
                <span className="block font-mono text-lg font-black leading-none tabular-nums text-brand-purple">{pickLabel(r.oneQb)}</span>
                <span className={`mt-0.5 block ${LABEL}`}>One QB</span>
              </span>
            </span>
            <span aria-hidden="true" className="relative col-span-2 mx-1.5 h-4 sm:order-2 sm:col-span-1">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink/[0.08]" />
              <span
                className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ink/40"
                style={{ left: at(Math.min(r.superflex, r.oneQb)), right: `calc(100% - ${at(Math.max(r.superflex, r.oneQb))})` }}
              />
              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-cyan" style={{ left: at(r.superflex) }} />
              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-brand-purple" style={{ left: at(r.oneQb) }} />
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-3 ${NOTE}`}>
        Round and slot in a 12-team draft. The round marker is the superflex pick and the square marker is the
        one-quarterback pick; the scale runs from pick 1 on the left to pick {max} on the right.
      </p>
    </ChartFigure>
  );
}
