"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Search } from "lucide-react";
import { ChartFigure, DataTable, Td, Th } from "@/components/chart-kit";
import { GLOSSARY_QUICK_LINKS } from "@/lib/guides/fantasy-football-terms";
import { searchGlossary, type GlossarySearchEntry } from "@/lib/guides/glossary-search";

/**
 * The two interactive pieces of the glossary.
 *
 * GlossaryFinder is a search box over every term and abbreviation on the page.
 * It never replaces the page: every definition is still server-rendered below
 * it, which is what a crawler reads, and a result is a plain link to that
 * definition's anchor. The box only saves a reader scrolling a very long page.
 * The result count is spoken through a polite live region once typing pauses,
 * so a screen reader hears how many matches there are without focus moving
 * out of the input, and Enter jumps to the best match.
 *
 * ScoringSwitcher scores the same four invented stat lines under standard,
 * half PPR, full PPR and TE premium, and re-sorts them. It exists because the
 * one thing a reader needs to learn about scoring is that the ORDER changes,
 * and that is easier to see than to read. Native radios inside a fieldset, a
 * polite live sentence stating the new order, and the whole comparison in a
 * table under the disclosure, so nothing depends on seeing the bars move.
 */

/* ---------- Find a term ---------- */

/** Results shown at once. The count said aloud is the full count, never this cap. */
const SHOWN = 8;

/** How long typing has to pause before the result count is announced. */
const ANNOUNCE_DELAY_MS = 600;

function countSentence(total: number, typed: boolean, entryCount: number): string {
  if (!typed) return `${entryCount} terms and abbreviations to search.`;
  if (total === 0) return "No match. Try the abbreviation on its own, or a shorter word.";
  if (total > SHOWN) return `${total} matches. The first ${SHOWN} are listed below the box.`;
  return `${total} ${total === 1 ? "match" : "matches"}, listed below the box.`;
}

export function GlossaryFinder({ entries }: { entries: GlossarySearchEntry[] }) {
  const [query, setQuery] = useState("");
  const [announced, setAnnounced] = useState("");
  const inputId = useId();
  const helpId = useId();
  const statusId = useId();
  const all = useMemo(() => searchGlossary(entries, query, Infinity), [entries, query]);
  const results = all.slice(0, SHOWN);
  const typed = query.trim().length > 0;
  const sentence = countSentence(all.length, typed, entries.length);

  // The visible count updates on every keystroke. The spoken one waits for a
  // pause, so a screen reader hears one count for a word rather than a queue
  // of "3 matches, 1 match, 2 matches" while it is still being typed.
  useEffect(() => {
    if (!typed) {
      setAnnounced("");
      return;
    }
    const t = window.setTimeout(() => setAnnounced(sentence), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [sentence, typed]);

  return (
    <div
      className="rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      {/* A search landmark, and Enter jumps to the best match. */}
      <form
        role="search"
        aria-label="Glossary"
        className="rounded-card bg-surface-elevated p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) window.location.hash = results[0].id;
        }}
      >
        <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
          Look up a term or abbreviation
        </label>
        <p id={helpId} className="mt-0.5 text-xs text-ink-subtle">
          Type it the way you would ask it, like &quot;what does BN mean&quot;, and press Enter to
          jump to the best match. Every definition is also written out in full further down the
          page.
        </p>
        <div className="relative mt-3">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby={`${helpId} ${statusId}`}
            autoComplete="off"
            spellCheck={false}
            placeholder="OPRK, handcuff, W/R/T..."
            className="min-h-11 w-full rounded-card border border-line bg-base/80 py-2 pl-9 pr-3 text-base text-ink placeholder:text-ink-subtle focus-visible:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm"
          />
        </div>

        <p id={statusId} className="mt-2 text-xs text-ink-subtle">
          {sentence}
        </p>
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {announced}
        </p>

        {typed && results.length > 0 && (
          <ul role="list" className="mt-2 space-y-1.5">
            {results.map((r) => (
              <li key={r.id}>
                <a
                  href={`#${r.id}`}
                  className="group flex min-h-11 items-start gap-3 rounded-card border border-line bg-base/60 px-3 py-2 transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">
                      {r.label}
                      {r.aka && (
                        <span className="ml-1.5 font-normal text-ink-subtle">({r.aka})</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{r.gist}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-subtle">In: {r.group}</span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 h-4 w-4 shrink-0 text-brand-cyan transition-transform motion-safe:group-hover:translate-x-0.5"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}

        <nav aria-label="Most looked-up terms" className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Most looked up
          </p>
          <ul role="list" className="mt-2 flex flex-wrap gap-2">
            {GLOSSARY_QUICK_LINKS.map((link) => (
              <li key={link.id}>
                <a
                  href={`#${link.id}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-card border border-line bg-base/60 px-3 font-mono text-sm text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </form>
    </div>
  );
}

/* ---------- Scoring switcher ---------- */

type Setting = "standard" | "half" | "ppr" | "tep";

const SETTINGS: Record<Setting, { label: string; perCatch: number; teBonus: number }> = {
  standard: { label: "Standard", perCatch: 0, teBonus: 0 },
  half: { label: "Half PPR", perCatch: 0.5, teBonus: 0 },
  ppr: { label: "Full PPR", perCatch: 1, teBonus: 0 },
  tep: { label: "TE premium", perCatch: 1, teBonus: 0.5 },
};

/**
 * Invented stat lines, chosen so the order moves under every setting. The
 * scoring is the plain version every league starts from: a point per 10 yards,
 * 6 per touchdown, plus whatever a catch is worth.
 */
const LINES = [
  {
    key: "goal-line",
    name: "Goal-line running back",
    isTe: false,
    yards: 68,
    catches: 1,
    tds: 2,
    line: "64 rushing yards, 1 catch for 4 yards, 2 touchdowns",
  },
  {
    key: "slot",
    name: "Slot receiver",
    isTe: false,
    yards: 104,
    catches: 10,
    tds: 0,
    line: "10 catches for 104 yards",
  },
  {
    key: "te",
    name: "Tight end",
    isTe: true,
    yards: 82,
    catches: 8,
    tds: 0,
    line: "8 catches for 82 yards",
  },
  {
    key: "pass-catching",
    name: "Pass-catching running back",
    isTe: false,
    yards: 83,
    catches: 6,
    tds: 0,
    line: "38 rushing yards, 6 catches for 45 yards",
  },
];

function score(line: (typeof LINES)[number], s: Setting): number {
  const cfg = SETTINGS[s];
  const perCatch = cfg.perCatch + (line.isTe ? cfg.teBonus : 0);
  // Rounded to one decimal so 6.800000000000001 never reaches the page.
  return Math.round((line.yards / 10 + line.tds * 6 + line.catches * perCatch) * 10) / 10;
}

function ranked(s: Setting) {
  return LINES.map((l) => ({ ...l, pts: score(l, s) })).sort((a, b) => b.pts - a.pts);
}

const MAX_PTS = Math.max(
  ...(Object.keys(SETTINGS) as Setting[]).flatMap((s) => LINES.map((l) => score(l, s))),
);

export function ScoringSwitcher() {
  const [setting, setSetting] = useState<Setting>("standard");
  const groupId = useId();
  const order = ranked(setting);
  const sentence = `Under ${SETTINGS[setting].label}: ${order
    .map((o, i) => `${i + 1}, ${o.name.toLowerCase()}, ${o.pts.toFixed(1)}`)
    .join("; ")}.`;

  const radioClass = (checked: boolean) =>
    `flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
      checked
        ? "border-brand-cyan bg-brand-cyan/10 text-ink"
        : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
    }`;

  return (
    <ChartFigure
      titleLevel={3}
      title="Try it: one Sunday, four scoring settings"
      description="Four invented stat lines from the same week. Switch the scoring and watch the order change. A point per 10 yards and 6 per touchdown throughout; only what a catch is worth moves."
      summary="The same four stat lines finish in a different order under each setting. The goal-line back leads in standard and half PPR, the slot receiver takes over in full PPR, and in TE premium the tight end climbs from last to second."
      tableLabel="View every setting as a table"
      table={
        <DataTable
          caption="Fantasy points for four invented stat lines under four scoring settings."
          head={
            <>
              <Th>Player</Th>
              {(Object.keys(SETTINGS) as Setting[]).map((s) => (
                <Th key={s} numeric>
                  {SETTINGS[s].label}
                </Th>
              ))}
            </>
          }
        >
          {LINES.map((l) => (
            <tr key={l.key}>
              <Td>{l.name}</Td>
              {(Object.keys(SETTINGS) as Setting[]).map((s) => (
                <Td key={s} numeric>
                  {score(l, s).toFixed(1)}
                </Td>
              ))}
            </tr>
          ))}
        </DataTable>
      }
    >
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Scoring setting</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(SETTINGS) as Setting[]).map((s) => {
            const checked = setting === s;
            return (
              <label key={s} className={radioClass(checked)}>
                <input
                  type="radio"
                  name={`${groupId}-setting`}
                  value={s}
                  checked={checked}
                  onChange={() => setSetting(s)}
                  className="sr-only"
                />
                {checked ? (
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
                ) : (
                  <Circle aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />
                )}
                {SETTINGS[s].label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <ol role="list" className="mt-4 space-y-2">
        {order.map((o, i) => (
          <li key={o.key} className="rounded-card border border-line bg-surface/60 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm font-semibold text-ink">
                <span className="mr-2 font-mono text-brand-cyan">{i + 1}.</span>
                {o.name}
              </span>
              <span className="shrink-0 font-mono text-base font-semibold tabular-nums text-ink">
                {o.pts.toFixed(1)}
                <span className="sr-only"> points</span>
              </span>
            </div>
            {/* The bar repeats the number beside it. Decorative. */}
            <span aria-hidden="true" className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-base">
              <span
                className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300"
                style={{
                  width: `${(o.pts / MAX_PTS) * 100}%`,
                  backgroundImage: o.isTe
                    ? "linear-gradient(90deg, #A855F7, #C084FC)"
                    : "linear-gradient(90deg, #A855F7, #22D3EE)",
                }}
              />
            </span>
            <span className="mt-1.5 block text-xs text-ink-muted">{o.line}</span>
          </li>
        ))}
      </ol>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {sentence}
      </p>
      <p className="mt-3 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        Same players, same Sunday. The only thing that changed is what a catch is worth, and it
        reshuffled the whole list.
      </p>
    </ChartFigure>
  );
}
