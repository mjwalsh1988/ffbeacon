import Link from "next/link";
import {
  ChartEmpty,
  ChartFigure,
  DataTable,
  Td,
  Th,
} from "@/components/chart-kit";
import { formatEasternShortDate } from "@/lib/datetime";
import { teamStatusBands } from "@/lib/league-team-status";
import {
  AGE_BANDS,
  AGE_MARKET_TOP_N,
  AGE_MARKET_VETERAN_AGE,
  type AgeBandKey,
  type DynastyAgeMarket,
} from "@/lib/guides/dynasty-age-market";

/**
 * The diagrams in the dynasty strategy guide.
 *
 * THREE KINDS OF NUMBER LIVE HERE, AND EACH FIGURE SAYS WHICH IT IS.
 *
 *   - LIVE. AgeMarketFigure reads the dynasty values the rankings boards read,
 *     through lib/guides/dynasty-age-market.ts, and its caption names the
 *     source, the format and the date of the values.
 *   - PUBLISHED. ProductionCurveFigure and HitRateFigure carry figures from
 *     named studies (4for4, ESPN, Dynasty Nerds), and each caption names the
 *     study. Nothing is rounded into a different claim: the hit rates are the
 *     study's own, including the one bucket that runs backwards, which the
 *     caption points out rather than smoothing away.
 *   - ENGINE. StatusBandsFigure draws its cut lines by calling
 *     teamStatusBands() from lib/league-team-status.ts, the function League
 *     Pulse uses, so the picture cannot drift from the tag a reader sees.
 *
 * EVERY OTHER NUMBER IS INVENTED to show a shape, and the caption says so.
 *
 * Every figure goes through ChartFigure, which puts the conclusion in a sentence
 * before the graphic and the plotted values in a real table under a disclosure.
 * The graphics that are pure drawing are aria-hidden, because the sentence and
 * the table carry the meaning. The DOM-built timelines keep their text in the
 * tree, so nothing about them is hidden from a screen reader.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const ORANGE = "#FB923C";
const ROSE = "#FB7185";
const GREY = "#3A3A5A";

/* ---------- Lesson 1: the four bands ---------- */

type BandKey = "contender" | "bubble" | "rebuilder";

const BAND_STYLE: Record<BandKey, { cell: string; label: string }> = {
  contender: {
    cell: "border-brand-cyan/70 bg-brand-cyan/15 text-ink",
    label: "Contender",
  },
  bubble: {
    cell: "border-brand-purple/60 bg-brand-purple/10 text-ink",
    label: "Bubble or Loaded",
  },
  rebuilder: {
    cell: "border-line bg-base/60 text-ink-muted",
    label: "Rebuilder",
  },
};

export function StatusBandsFigure() {
  const teams = 12;
  const playoffTeams = 6;
  // The same function League Pulse calls. If the cut lines ever move there,
  // this picture moves with them.
  const bands = teamStatusBands({ teamCount: teams, playoffTeams });
  const ranks = Array.from({ length: teams }, (_, i) => i + 1);
  const bandOf = (r: number): BandKey =>
    r <= bands.contenderCeiling
      ? "contender"
      : r <= bands.bubbleCeiling
        ? "bubble"
        : "rebuilder";

  const contenders = `1 to ${bands.contenderCeiling}`;
  const bubble = `${bands.contenderCeiling + 1} to ${bands.bubbleCeiling}`;
  const rebuilders = `${bands.bubbleCeiling + 1} to ${teams}`;

  return (
    <ChartFigure
      titleLevel={3}
      title="Where the lines fall in a twelve-team league"
      description={`A twelve-team league that sends ${playoffTeams} teams to the playoffs, ranked by Power Pulse projected wins. The cut lines are drawn by the same code League Pulse uses to tag your team.`}
      summary={`In a twelve-team league with a ${playoffTeams}-team playoff, ranks ${contenders} by projected wins are Contenders, ranks ${bubble} are Bubble teams, or Loaded when the roster's value runs well ahead of its projected wins, and ranks ${rebuilders} are Rebuilders.`}
      table={
        <DataTable
          caption="The three rank ranges in a twelve-team league with a six-team playoff. The playoff line falls after rank 6."
          head={
            <>
              <Th>Power Pulse rank</Th>
              <Th>Band</Th>
              <Th>What it means</Th>
            </>
          }
        >
          <tr>
            <Td>{contenders}</Td>
            <Td>Contender</Td>
            <Td>Most of the playoff field. Built to win this year.</Td>
          </tr>
          <tr>
            <Td>{bubble}</Td>
            <Td>Bubble, or Loaded</Td>
            <Td>
              In range of the bracket. Loaded when the roster is worth a lot
              more than its projected wins.
            </Td>
          </tr>
          <tr>
            <Td>{rebuilders}</Td>
            <Td>Rebuilder</Td>
            <Td>Out of range. The season is no longer the thing to play for.</Td>
          </tr>
        </DataTable>
      }
    >
      <ol
        role="list"
        aria-hidden="true"
        className="grid grid-cols-6 gap-1.5 sm:grid-cols-12"
      >
        {ranks.map((r) => {
          const b = bandOf(r);
          return (
            <li
              key={r}
              className={`flex h-12 flex-col items-center justify-center rounded-card border font-mono text-sm font-semibold tabular-nums ${BAND_STYLE[b].cell}`}
            >
              {r}
              {r === playoffTeams && (
                <span className="text-[11px] font-sans font-medium uppercase tracking-wide text-ink-subtle">
                  cut
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <ul
        role="list"
        aria-hidden="true"
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-medium text-ink-muted"
      >
        {(Object.keys(BAND_STYLE) as BandKey[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-3 w-3 rounded-sm border ${BAND_STYLE[k].cell}`}
            />
            {/* The range in words, so the grid never depends on colour alone. */}
            {BAND_STYLE[k].label}, ranks{" "}
            {k === "contender"
              ? contenders
              : k === "bubble"
                ? bubble
                : rebuilders}
          </li>
        ))}
        <li>The playoff line falls after rank {playoffTeams}.</li>
      </ul>
    </ChartFigure>
  );
}

/* ---------- Lesson 2: three paths ---------- */

type Season = { finish: string; note: string; tone: "win" | "mid" | "low" };

const PATHS: { name: string; blurb: string; seasons: Season[] }[] = [
  {
    name: "Went all in",
    blurb: "Bought veterans with picks while the window was open.",
    seasons: [
      { finish: "2nd", note: "Lost the final", tone: "win" },
      { finish: "1st", note: "Champion", tone: "win" },
      { finish: "9th", note: "Sold the veterans for picks", tone: "low" },
    ],
  },
  {
    name: "Rebuilt on purpose",
    blurb: "Sold every veteran the first October.",
    seasons: [
      { finish: "12th", note: "Held the 1.01 and two more firsts", tone: "low" },
      { finish: "5th", note: "Second-year receivers broke out", tone: "mid" },
      { finish: "1st", note: "Champion", tone: "win" },
    ],
  },
  {
    name: "Stayed in the middle",
    blurb: "Bought a little, sold a little, every year.",
    seasons: [
      { finish: "7th", note: "Missed by a game, picked 1.06", tone: "mid" },
      { finish: "6th", note: "Out in round one, picked 1.07", tone: "mid" },
      { finish: "7th", note: "Missed by a game, picked 1.06", tone: "mid" },
    ],
  },
];

const SEASON_TONE: Record<Season["tone"], string> = {
  win: "border-brand-cyan/60 bg-brand-cyan/10",
  mid: "border-brand-purple/40 bg-brand-purple/5",
  low: "border-line bg-base/60",
};

export function ThreePathsFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="Three managers, three seasons"
      description="An invented twelve-team league. Two managers pick a lane and one does not. Every finish here is made up to show the shape."
      summary="In this invented league the manager who went all in won a title in year two, and the manager who rebuilt on purpose won one in year three. The manager who stayed in the middle finished seventh, sixth and seventh, never had a real shot at the title, and never picked higher than sixth in the rookie draft."
      tableLabel="View the three paths as a table"
      table={
        <DataTable
          caption="Finishes for the three invented managers over three seasons."
          head={
            <>
              <Th>Manager</Th>
              <Th>Year 1</Th>
              <Th>Year 2</Th>
              <Th>Year 3</Th>
            </>
          }
        >
          {PATHS.map((p) => (
            <tr key={p.name}>
              <Td>{p.name}</Td>
              {p.seasons.map((s, i) => (
                <Td key={i}>
                  {s.finish}: {s.note}
                </Td>
              ))}
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="space-y-3">
        {PATHS.map((p) => (
          <li key={p.name} className="rounded-card border border-line bg-base/40 p-3">
            <p className="text-sm font-semibold text-ink">{p.name}</p>
            <p className="text-xs text-ink-subtle">{p.blurb}</p>
            <ol role="list" className="mt-2 grid gap-2 sm:grid-cols-3">
              {p.seasons.map((s, i) => (
                <li
                  key={i}
                  className={`rounded-card border px-3 py-2 ${SEASON_TONE[s.tone]}`}
                >
                  <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
                    Year {i + 1}
                  </span>
                  <span className="block font-mono text-base font-semibold tabular-nums text-ink">
                    {s.finish}
                  </span>
                  <span className="block text-xs leading-relaxed text-ink-muted">
                    {s.note}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}

/* ---------- Lesson 3: production by age, from published studies ---------- */

/**
 * "hold" is the stretch between the study's stated peak and the age it says
 * decline begins. Drawing it as peak would claim more than the source does.
 */
type Phase = "rise" | "peak" | "hold" | "decline";

type CurveRow = {
  position: string;
  /** Inclusive peak range. */
  peak: [number, number];
  /** The age decline begins, per the study. */
  declineFrom: number;
  note: string;
};

// Every anchor here is quoted from a named study; see the caption and the
// Sources section of the page. 4for4 (Tristan Bassett, 2025) for the peak and
// decline ages; ESPN (Tristan H. Cockcroft, 2023) for the running back drop.
const CURVES: CurveRow[] = [
  {
    position: "Running back",
    peak: [26, 28],
    declineFrom: 29,
    note: "Peaks at 26, holds through 28. ESPN measured a 25.2 percent drop in PPR points per game from 28 to 29.",
  },
  {
    position: "Wide receiver",
    peak: [26, 28],
    declineFrom: 32,
    note: "Peaks at 26 to 28. Steep declines at 32 and 33, to about 74 percent of career baseline.",
  },
  {
    position: "Tight end",
    peak: [26, 26],
    declineFrom: 31,
    note: "Peaks at 26 and shows no regression until 31. Still at 89 percent of baseline at 34.",
  },
];

const AGES = Array.from({ length: 14 }, (_, i) => 21 + i);

function phaseAt(row: CurveRow, age: number): Phase {
  if (age >= row.declineFrom) return "decline";
  if (age > row.peak[1]) return "hold";
  if (age >= row.peak[0]) return "peak";
  return "rise";
}

function peakText(row: CurveRow): string {
  return row.peak[0] === row.peak[1]
    ? String(row.peak[0])
    : `${row.peak[0]} to ${row.peak[1]}`;
}

const PHASE_CELL: Record<Phase, string> = {
  rise: "bg-ink/[0.06]",
  peak: "bg-brand-cyan/70",
  hold: "bg-brand-cyan/25",
  decline: "bg-brand-purple/60",
};

export function ProductionCurveFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="When production actually peaks and fades"
      description="Peak and decline ages from 4for4's 2025 production-curve study of every running back and receiver with two or more top-12 seasons, and tight end with two or more top-6 seasons, over 25 years. The running back drop is ESPN's. Published figures, not ours."
      summary="In the published studies, running backs peak at 26 and hold through 28, then fall about a quarter from 28 to 29. Receivers peak at 26 to 28 and fall steeply at 32 and 33. Tight ends peak at 26 and do not regress until 31. The running back window closes two to three years before the other two."
      table={
        <DataTable
          caption="Peak and decline ages by position, from the studies named in the caption."
          head={
            <>
              <Th>Position</Th>
              <Th>Peak</Th>
              <Th numeric>Decline begins</Th>
              <Th>Detail</Th>
            </>
          }
        >
          {CURVES.map((c) => (
            <tr key={c.position}>
              <Td>{c.position}</Td>
              <Td>{peakText(c)}</Td>
              <Td numeric>{c.declineFrom}</Td>
              <Td>{c.note}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[30rem]">
          <div className="grid grid-cols-[7.5rem_repeat(14,minmax(0,1fr))] gap-0.5 text-center text-[10px] text-ink-subtle">
            <span />
            {AGES.map((a) => (
              <span key={a} className="font-mono tabular-nums">
                {a}
              </span>
            ))}
          </div>
          {CURVES.map((c) => (
            <div
              key={c.position}
              className="mt-1.5 grid grid-cols-[7.5rem_repeat(14,minmax(0,1fr))] items-center gap-0.5"
            >
              <span className="pr-2 text-xs font-semibold text-ink">
                {c.position}
              </span>
              {AGES.map((a) => (
                <span
                  key={a}
                  className={`h-6 rounded-sm ${PHASE_CELL[phaseAt(c, a)]}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <ul
        role="list"
        aria-hidden="true"
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-medium text-ink-muted"
      >
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-ink/[0.06]" />
          Still rising
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-brand-cyan/70" />
          Peak years
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-brand-cyan/25" />
          Past peak, no clear decline yet
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-brand-purple/60" />
          Decline has begun
        </li>
      </ul>
      {/* The same ages in words, so the strip never depends on colour alone. */}
      <ul
        role="list"
        aria-hidden="true"
        className="mt-2 space-y-0.5 text-[11px] text-ink-subtle"
      >
        {CURVES.map((c) => (
          <li key={c.position}>
            {c.position}: peak {peakText(c)}, decline from {c.declineFrom}
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}

/* ---------- Lesson 3: the live age market ---------- */

const BAND_COLOR: Record<AgeBandKey, string> = {
  young: CYAN,
  prime: PURPLE,
  late: ORANGE,
  veteran: ROSE,
};

const POSITION_NAME: Record<string, string> = {
  QB: "Quarterbacks",
  RB: "Running backs",
  WR: "Wide receivers",
  TE: "Tight ends",
};

export function AgeMarketFigure({ market }: { market: DynastyAgeMarket }) {
  if (market.status !== "ok") {
    return (
      <figure className="mt-6 rounded-card border border-line bg-base/40 p-4">
        <figcaption>
          <h3 className="text-sm font-semibold text-ink">
            Who the dynasty market pays for, by age
          </h3>
        </figcaption>
        <div className="mt-3">
          <ChartEmpty>{market.reason}</ChartEmpty>
        </div>
      </figure>
    );
  }

  const { positions, sourceName, sourceSlug, format, asOf } = market;
  const rb = positions.find((p) => p.position === "RB");
  const qb = positions.find((p) => p.position === "QB");
  const wr = positions.find((p) => p.position === "WR");

  const shareText = (pct: number | null) =>
    pct === null ? "no share" : `${pct} percent`;
  // The closing reading is only printed when tonight's numbers show it. On a
  // night when veterans held as much running back value as quarterback value,
  // a fixed sentence would contradict the figure it sits beside.
  const rbShare = rb?.veteranValueSharePct ?? null;
  const qbShare = qb?.veteranValueSharePct ?? null;
  const reading =
    rbShare !== null && qbShare !== null && rbShare < qbShare
      ? " Running backs in their late twenties are still inside their production peak in the published studies, yet they hold far less of their position's value than quarterbacks of the same age hold of theirs."
      : "";
  const summary = `Live from ${sourceName}'s ${format.displayName} values. Of the ${AGE_MARKET_TOP_N} most valuable players at each position, players ${AGE_MARKET_VETERAN_AGE} and over hold ${shareText(qbShare)} of the quarterback value, ${shareText(rbShare)} of the running back value and ${shareText(wr?.veteranValueSharePct ?? null)} of the receiver value.${reading}`;

  return (
    <ChartFigure
      titleLevel={3}
      title={`Who the dynasty market pays for, by age`}
      description={`Live, not invented. The ${AGE_MARKET_TOP_N} most valuable players at each position in ${format.displayName} by ${sourceName}, split by age, with the share of that value held by players ${AGE_MARKET_VETERAN_AGE} and over.${asOf ? ` Values as of ${formatEasternShortDate(asOf)}, refreshed with the nightly sync.` : ""}`}
      summary={summary}
      table={
        <DataTable
          caption={`Age breakdown of the top ${AGE_MARKET_TOP_N} players at each position in ${format.displayName}, from ${sourceName}.`}
          head={
            <>
              <Th>Position</Th>
              {AGE_BANDS.map((b) => (
                <Th key={b.key} numeric>
                  {b.label}
                </Th>
              ))}
              <Th numeric>Age unknown</Th>
              <Th numeric>{AGE_MARKET_VETERAN_AGE} and over</Th>
              <Th numeric>Median age</Th>
              <Th numeric>Value held by {AGE_MARKET_VETERAN_AGE}+</Th>
            </>
          }
        >
          {positions.map((p) => (
            <tr key={p.position}>
              <Td>{POSITION_NAME[p.position]}</Td>
              {AGE_BANDS.map((b) => (
                <Td key={b.key} numeric>
                  {p.bands[b.key]}
                </Td>
              ))}
              <Td numeric>{p.unknownAge}</Td>
              <Td numeric>{p.veteranCount}</Td>
              <Td numeric>{p.medianAge ?? "n/a"}</Td>
              <Td numeric>
                {p.veteranValueSharePct === null
                  ? "n/a"
                  : `${p.veteranValueSharePct}%`}
              </Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul
        role="list"
        aria-hidden="true"
        className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-medium text-ink-muted"
      >
        {AGE_BANDS.map((b) => (
          <li key={b.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: BAND_COLOR[b.key] }}
            />
            {b.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: GREY }}
          />
          Age unknown
        </li>
      </ul>
      <ul role="list" aria-hidden="true" className="mt-3 space-y-3">
        {positions.map((p) => (
          <li key={p.position}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
              <span className="font-semibold text-ink">
                {POSITION_NAME[p.position]}
              </span>
              <span className="text-ink-muted">
                {AGE_MARKET_VETERAN_AGE} and over:{" "}
                <span className="font-mono font-semibold tabular-nums text-ink">
                  {p.veteranCount}
                </span>{" "}
                of {p.counted} players,{" "}
                <span className="font-mono font-semibold tabular-nums text-brand-cyan">
                  {p.veteranValueSharePct === null
                    ? "n/a"
                    : `${p.veteranValueSharePct}%`}
                </span>{" "}
                of the value
              </span>
            </div>
            <div className="mt-1 flex h-7 w-full overflow-hidden rounded-card border border-line">
              {AGE_BANDS.map((b) => {
                const n = p.bands[b.key];
                if (n === 0) return null;
                return (
                  <span
                    key={b.key}
                    className="flex items-center justify-center font-mono text-[11px] font-semibold tabular-nums text-black"
                    style={{
                      width: `${(100 * n) / Math.max(1, p.counted)}%`,
                      background: BAND_COLOR[b.key],
                    }}
                  >
                    {n}
                  </span>
                );
              })}
              {p.unknownAge > 0 && (
                <span
                  className="flex items-center justify-center font-mono text-[11px] tabular-nums text-ink"
                  style={{
                    width: `${(100 * p.unknownAge) / Math.max(1, p.counted)}%`,
                    background: GREY,
                  }}
                >
                  {p.unknownAge}
                </span>
              )}
            </div>
            {/* The bands in words, so the bar never depends on colour alone. */}
            <p className="mt-1 text-[11px] text-ink-subtle">
              {AGE_BANDS.map((b) => `${b.label}: ${p.bands[b.key]}`).join(", ")}
              {p.unknownAge > 0 ? `, age unknown: ${p.unknownAge}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Want the names?{" "}
        <Link
          href={`/rankings/${format.slug}?source=${encodeURIComponent(sourceSlug)}`}
          className="text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          The full {format.displayName} board
        </Link>{" "}
        lists every player these counts come from.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 4: rookie pick hit rates, published ---------- */

// Dynasty Nerds, Mychal Warno, March 17, 2025, rookie drafts 2018 to 2023. A
// "hit" is a Tier 1 season or multiple Tier 2 or better seasons; "hit or mid"
// adds a Tier 2 season with a Tier 3, or multiple Tier 3 seasons.
const HIT_RATES: { slot: string; hit: number; hitOrMid: number }[] = [
  { slot: "1.01", hit: 83.33, hitOrMid: 100 },
  { slot: "1.02 to 1.04", hit: 70.83, hitOrMid: 83.33 },
  { slot: "1.05 to 1.08", hit: 37.5, hitOrMid: 41.67 },
  { slot: "1.09 to 1.12", hit: 45.83, hitOrMid: 62.5 },
  { slot: "2.01 to 2.06", hit: 22.22, hitOrMid: 30.56 },
  { slot: "2.07 to 2.12", hit: 19.44, hitOrMid: 33.33 },
  { slot: "Round 3 and later", hit: 8.33, hitOrMid: 13.89 },
];

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function HitRateFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="How often a rookie pick becomes a player"
      description="Hit rates by rookie draft slot from Dynasty Nerds' study of 2018 to 2023 rookie drafts (Mychal Warno, March 2025). A hit is one top-tier season or several second-tier ones. Published figures, not ours."
      summary="In the Dynasty Nerds study, the 1.01 hit 83 percent of the time and picks 1.02 to 1.04 hit 71 percent. After that the odds fall off fast: the middle of round one hit 38 percent, the end of round one 46 percent, round two about 20 percent, and round three and later 8 percent. Past the first four picks, a rookie pick is closer to a coin flip than a sure thing."
      table={
        <DataTable
          caption="Rookie pick hit rates by slot, 2018 to 2023, from Dynasty Nerds."
          head={
            <>
              <Th>Slot</Th>
              <Th numeric>Hit</Th>
              <Th numeric>Hit or mid</Th>
            </>
          }
        >
          {HIT_RATES.map((h) => (
            <tr key={h.slot}>
              <Td>{h.slot}</Td>
              <Td numeric>{h.hit.toFixed(1)}%</Td>
              <Td numeric>{h.hitOrMid.toFixed(1)}%</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" aria-hidden="true" className="space-y-2">
        {HIT_RATES.map((h) => (
          <li
            key={h.slot}
            className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-2 text-xs sm:grid-cols-[9rem_1fr_7rem]"
          >
            <span className="font-medium text-ink">{h.slot}</span>
            <span className="relative h-5 overflow-hidden rounded-sm bg-ink/[0.06]">
              <span
                className="absolute inset-y-0 left-0 bg-brand-purple/35"
                style={{ width: `${h.hitOrMid}%` }}
              />
              <span
                className="absolute inset-y-0 left-0 bg-brand-cyan"
                style={{ width: `${h.hit}%` }}
              />
            </span>
            <span className="text-right font-mono tabular-nums text-ink-subtle">
              <span className="font-semibold text-ink">{pct(h.hit)}</span>
              {" / "}
              {pct(h.hitOrMid)}
            </span>
          </li>
        ))}
      </ul>
      <ul
        role="list"
        aria-hidden="true"
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-medium text-ink-muted"
      >
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-brand-cyan" />
          Hit (first figure)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-brand-purple/35" />
          Hit or mid (second figure)
        </li>
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        The end of round one beating the middle of it is the study&apos;s own
        result, from six drafts of four picks each. That is a small sample, and
        the honest reading is that picks five through twelve are all roughly a
        coin flip.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: the dynasty year ---------- */

type Stretch = {
  when: string;
  name: string;
  buy: string;
  sell: string;
  tone: "cyan" | "purple" | "muted";
};

const YEAR: Stretch[] = [
  {
    when: "September",
    name: "Kickoff",
    buy: "Rookie picks. Contenders are chasing players and let picks go cheap.",
    sell: "Aging backups you kept as insurance and no longer need.",
    tone: "cyan",
  },
  {
    when: "October to the deadline",
    name: "The market splits",
    buy: "If contending: veteran starters, paid for with picks two years out.",
    sell: "If rebuilding: every veteran, before an injury or a bad month does it for you.",
    tone: "purple",
  },
  {
    when: "After the deadline to January",
    name: "Waivers and planning",
    buy: "Nothing by trade. Stash young players off the wire.",
    sell: "Nothing. Decide which lane next season is.",
    tone: "muted",
  },
  {
    when: "February to April",
    name: "Hype builds",
    buy: "Proven veterans, while every other manager is scouting rookies.",
    sell: "Running backs about to turn 27 or older, before the new class arrives.",
    tone: "cyan",
  },
  {
    when: "Late April to May",
    name: "NFL draft and rookie drafts",
    buy: "Players the NFL draft pushed down a depth chart, if the role is still there.",
    sell: "Rookie picks. This is the top of their market.",
    tone: "purple",
  },
  {
    when: "June to August",
    name: "The quiet months",
    buy: "Veterans the room forgot over the summer.",
    sell: "Little. Picks drift lower through these months.",
    tone: "muted",
  },
];

const STRETCH_TONE: Record<Stretch["tone"], string> = {
  cyan: "border-brand-cyan/60 bg-brand-cyan/10",
  purple: "border-brand-purple/60 bg-brand-purple/10",
  muted: "border-line bg-base/60",
};

export function DynastyYearFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="The dynasty year, and what to buy and sell in each stretch"
      description="A dynasty league trades all twelve months. The pick timing (buy in September, sell in May, soft through the summer) is from Footballguys' study of KeepTradeCut prices through 2023. The rest is the pattern this guide teaches."
      summary="The dynasty year runs in six stretches. Buy rookie picks in September. Contenders buy and rebuilders sell from October to the trade deadline. Nothing trades from the deadline to January. Buy veterans from February to April while the room is scouting rookies. Sell rookie picks around the NFL draft and the rookie drafts in late April and May, when they are most expensive. Picks drift lower from June to August."
      tableLabel="View the six stretches as a table"
      table={
        <DataTable
          caption="The six stretches of the dynasty year."
          head={
            <>
              <Th>When</Th>
              <Th>Stretch</Th>
              <Th>Buy</Th>
              <Th>Sell</Th>
            </>
          }
        >
          {YEAR.map((s) => (
            <tr key={s.when}>
              <Td>{s.when}</Td>
              <Td>{s.name}</Td>
              <Td>{s.buy}</Td>
              <Td>{s.sell}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {YEAR.map((s, i) => (
          <li
            key={s.when}
            className={`flex flex-col rounded-card border p-3 ${STRETCH_TONE[s.tone]}`}
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
              <span className="sr-only">Stretch {i + 1}: </span>
              {s.when}
            </span>
            <span className="mt-1 text-sm font-semibold text-ink">
              {s.name}
            </span>
            <span className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              <span className="font-semibold text-brand-cyan">Buy: </span>
              {s.buy}
            </span>
            <span className="mt-1 text-xs leading-relaxed text-ink-muted">
              <span className="font-semibold text-brand-purple">Sell: </span>
              {s.sell}
            </span>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}

/* ---------- Lesson 6: the contender's discount ---------- */

type Receiver = {
  label: string;
  age: number;
  ppg: number;
  price: number;
  note: string;
};

export function ContenderDiscountFigure() {
  const veteran: Receiver = {
    label: "The veteran",
    age: 28,
    ppg: 15.8,
    price: 100,
    note: "Three straight seasons as a starter. The room has started pricing in age.",
  };
  const prospect: Receiver = {
    label: "The prospect",
    age: 23,
    ppg: 15.4,
    price: 210,
    note: "Second-year breakout. The room is pricing in five more years like it.",
  };
  const perPoint = (r: Receiver) => r.price / r.ppg;
  const ratio = perPoint(prospect) / perPoint(veteran);

  return (
    <ChartFigure
      titleLevel={3}
      title="Same points this year, twice the price"
      description="Two invented receivers who score about the same this season. Price is market value indexed so the veteran is 100. Every number here is made up to show the shape."
      summary={`In this invented pair, the 28-year-old scores ${veteran.ppg} points a week and the 23-year-old scores ${prospect.ppg}. The market prices the younger one at ${prospect.price} against the veteran's ${veteran.price}, so a contender pays about ${ratio.toFixed(1)} times as much per point this season for the prospect. For a team playing for this year, the veteran is the better buy.`}
      table={
        <DataTable
          caption="The invented pair of receivers."
          head={
            <>
              <Th>Player</Th>
              <Th numeric>Age</Th>
              <Th numeric>Points a week</Th>
              <Th numeric>Price (veteran = 100)</Th>
            </>
          }
        >
          {[veteran, prospect].map((r) => (
            <tr key={r.label}>
              <Td>{r.label}</Td>
              <Td numeric>{r.age}</Td>
              <Td numeric>{r.ppg.toFixed(1)}</Td>
              <Td numeric>{r.price}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {[veteran, prospect].map((r, i) => (
          <div
            key={r.label}
            className={`rounded-card border bg-base/60 p-3 ${
              i === 0 ? "border-brand-cyan/60" : "border-brand-purple/60"
            }`}
          >
            <p
              className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
                i === 0 ? "text-brand-cyan" : "text-brand-purple"
              }`}
            >
              {r.label}, age {r.age}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <dt className="text-[11px] text-ink-subtle">Points a week</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {r.ppg.toFixed(1)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-ink-subtle">Price</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums text-ink">
                  {r.price}
                </dd>
              </div>
            </dl>
            <div aria-hidden="true" className="mt-2 h-2 rounded-full bg-ink/[0.06]">
              <div
                className={`h-2 rounded-full ${i === 0 ? "bg-brand-cyan" : "bg-brand-purple"}`}
                style={{ width: `${(100 * r.price) / prospect.price}%` }}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {r.note}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        Per point this season, the prospect costs about{" "}
        <span className="font-mono font-semibold tabular-nums text-brand-cyan">
          {ratio.toFixed(1)} times
        </span>{" "}
        as much. That gap is the contender&apos;s discount, and it exists
        because the market prices the next five years and you only need the
        next five months.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 7: a rebuild with an end date ---------- */

const REBUILD_STEPS: { when: string; title: string; body: string }[] = [
  {
    when: "This deadline",
    title: "Sell the veterans",
    body: "Every running back 26 or older and every starter who will not be one in two years goes to a contender, for firsts and young players.",
  },
  {
    when: "The offseason",
    title: "Buy the year-two jump",
    body: "Trade for receivers and tight ends after a quiet rookie year. ESPN found receivers gain about 43 percent and tight ends about 98 percent in PPR points per game from year one to year two.",
  },
  {
    when: "Rookie draft",
    title: "Use the top picks, sell the rest",
    body: "Keep a top-four pick. Sell picks five through twelve at their May peak for a player you already know.",
  },
  {
    when: "Next season",
    title: "Set the end date",
    body: "If the core is 22 to 25 and five starters would start for the best team, stop collecting and start buying.",
  },
];

export function RebuildTimelineFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="A rebuild with an end date"
      description="Four steps across about a season and a half. The year-two jumps are ESPN's (Tristan H. Cockcroft, 2023); the rest is the plan this guide teaches."
      summary="A rebuild in four steps: sell the veterans at this deadline, buy receivers and tight ends before their second-year jump in the offseason, keep a top-four rookie pick and sell the rest in May, and set an end date for next season, when the young core is ready to start buying again."
      tableLabel="View the four steps as a table"
      table={
        <DataTable
          caption="The four steps of a rebuild with an end date."
          head={
            <>
              <Th>When</Th>
              <Th>Step</Th>
              <Th>What to do</Th>
            </>
          }
        >
          {REBUILD_STEPS.map((s) => (
            <tr key={s.when}>
              <Td>{s.when}</Td>
              <Td>{s.title}</Td>
              <Td>{s.body}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="relative space-y-3 sm:grid sm:grid-cols-4 sm:gap-3 sm:space-y-0">
        {REBUILD_STEPS.map((s, i) => (
          <li
            key={s.when}
            className="relative rounded-card border border-line bg-base/60 p-3"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-semibold text-black"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
            >
              {i + 1}
            </span>
            <span className="mt-2 block font-mono text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
              <span className="sr-only">Step {i + 1}: </span>
              {s.when}
            </span>
            <span className="mt-1 block text-sm font-semibold text-ink">
              {s.title}
            </span>
            <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
              {s.body}
            </span>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}
