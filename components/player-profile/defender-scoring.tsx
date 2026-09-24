"use client";

/**
 * The defender profile's scoring selector and every figure it re-scores
 * (plan IDP-205, IDP-206, R-16).
 *
 * WHY SCORING IS PICKED HERE. IDP scoring varies more than offensive scoring
 * does: a tackle is worth 1 point in one league and 2 in the next, and a sack
 * anywhere from 2 to 6. A single number on a defender's page would be right
 * for almost nobody. So the page holds stat lines, and every point figure on
 * it is computed in the browser from those lines under the scoring the reader
 * picks: Sleeper's default, Big 3, FantasyPros, ESPN, or one of the reader's
 * own synced IDP leagues.
 *
 * The choice is remembered per viewer in localStorage, inside try/catch, and
 * the page renders correctly without it (Sleeper default).
 *
 * One polite live region announces the new season total when the scoring
 * changes, and nothing else, so a screen reader hears one sentence rather
 * than every cell on the page.
 *
 * Never names a stored points column (lib/idp/points-guard.test.ts does not
 * scan components, but the rule is the same: defender points come from the
 * line, never from pts_*).
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Panel } from "@/components/dashboard-panel";
import { StatScroll } from "@/components/player-profile/stat-shaping";
import { scoreIdpLine, type StatLine } from "@/lib/idp/stat-line";
import {
  IDP_PRESETS,
  IDP_PRESET_LABEL,
  type IdpPresetKey,
  type IdpScoringMap,
} from "@/lib/idp/scoring-presets";
import type {
  DefenderAccuracy,
  DefenderSeason,
  DefenderWeek,
  ReaderIdpLeague,
} from "@/lib/player-profile/defender";

/* ---------- the scoring choice ---------- */

export type ScoringOption = {
  id: string;
  /** How the option is named beside a number. */
  label: string;
  map: IdpScoringMap;
};

const PRESET_ORDER: IdpPresetKey[] = ["idp123", "big3", "fantasypros", "espn"];

export function scoringOptions(leagues: ReaderIdpLeague[]): ScoringOption[] {
  return [
    ...PRESET_ORDER.map((key) => ({
      id: key,
      label: IDP_PRESET_LABEL[key],
      map: IDP_PRESETS[key],
    })),
    ...leagues.map((league) => ({
      id: `league:${league.id}`,
      label: `your league's scoring (${league.name})`,
      map: league.scoring,
    })),
  ];
}

const STORAGE_KEY = "ffb:idp-scoring";

type ScoringContextValue = { option: ScoringOption };
const ScoringContext = createContext<ScoringContextValue | null>(null);

function useScoring(): ScoringOption {
  const ctx = useContext(ScoringContext);
  return ctx?.option ?? scoringOptions([])[0];
}

/** Points for a line under a map, rounded for display. */
export function pointsFor(line: StatLine, map: IdpScoringMap): number {
  return Math.round(scoreIdpLine(line, map) * 100) / 100;
}

/** True when a scoring map rewards something Sleeper does not project. */
export function scoresUnprojectedKeys(map: IdpScoringMap): boolean {
  return ["bonus_tkl_10p", "bonus_sack_2p", "idp_pass_def_3p", "idp_blk_kick"].some(
    (key) => (map[key] ?? 0) !== 0,
  );
}

/**
 * The selector plus everything under it. `seasonTotalLine` is the line whose
 * total the live region announces on a change (the game log's season).
 */
export function DefenderScoringProvider({
  leagues,
  seasonTotal,
  children,
}: {
  leagues: ReaderIdpLeague[];
  seasonTotal: { season: number; line: StatLine; games: number } | null;
  children: ReactNode;
}) {
  const options = useMemo(() => scoringOptions(leagues), [leagues]);
  const [id, setId] = useState<string>(options[0].id);
  const [announce, setAnnounce] = useState("");
  const groupId = useId();

  // Restore a remembered choice after mount, so the server render and the
  // first client render agree (Sleeper default) and nothing is patched.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && options.some((o) => o.id === saved)) setId(saved);
    } catch {
      // Private window or blocked storage: the default stands.
    }
  }, [options]);

  const option = options.find((o) => o.id === id) ?? options[0];

  function choose(next: ScoringOption) {
    setId(next.id);
    try {
      window.localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      // Not remembered, still applied.
    }
    if (seasonTotal) {
      const total = pointsFor(seasonTotal.line, next.map);
      setAnnounce(
        `Scoring changed to ${next.label}. ${seasonTotal.season} total ${total.toFixed(1)} points over ${seasonTotal.games} ${
          seasonTotal.games === 1 ? "game" : "games"
        }.`,
      );
    } else {
      setAnnounce(`Scoring changed to ${next.label}.`);
    }
  }

  return (
    <ScoringContext.Provider value={{ option }}>
      <fieldset
        className="rounded-card border border-line bg-surface/60 p-4"
        aria-describedby={`${groupId}-help`}
      >
        <legend className="px-1 text-sm font-semibold text-ink">Score this player as</legend>
        <p id={`${groupId}-help`} className="text-xs leading-relaxed text-ink-subtle">
          Every point figure below is worked out from the stat line under the scoring you pick.
          Tackle and sack values differ a lot between leagues.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {options.map((o) => {
            const checked = o.id === option.id;
            return (
              <label
                key={o.id}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan ${
                  checked
                    ? "border-brand-cyan bg-brand-cyan/10 text-ink"
                    : "border-line bg-base/60 text-ink-muted hover:border-line-accent"
                }`}
              >
                <input
                  type="radio"
                  name={`${groupId}-scoring`}
                  value={o.id}
                  checked={checked}
                  onChange={() => choose(o)}
                  className="h-4 w-4 accent-brand-cyan"
                />
                <span className="min-w-0">
                  {o.id.startsWith("league:") ? (
                    <>
                      <span className="block break-words font-medium">
                        {o.label.replace(/^your league's scoring \((.*)\)$/, "$1")}
                      </span>
                      <span className="block text-[11px] text-ink-subtle">Your league</span>
                    </>
                  ) : (
                    <span className="font-medium">{o.label}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
      </fieldset>
      {children}
    </ScoringContext.Provider>
  );
}

/* ---------- shared cells ---------- */

function fmt(n: number | undefined, digits = 0): string {
  if (n === undefined || !Number.isFinite(n)) return "0";
  return digits === 0 && Number.isInteger(n) ? String(n) : n.toFixed(digits === 0 ? 1 : digits);
}

type DefCol = { label: string; name: string; get: (l: StatLine) => string };

/** The defender stat columns. No offensive key appears here (plan IDP-206). */
export const DEFENDER_COLUMNS: DefCol[] = [
  { label: "TFL", name: "Tackles for loss", get: (l) => fmt(l.idp_tkl_loss) },
  { label: "Sack", name: "Sacks", get: (l) => fmt(l.idp_sack) },
  { label: "QB hit", name: "Quarterback hits", get: (l) => fmt(l.idp_qb_hit) },
  { label: "PD", name: "Passes defended", get: (l) => fmt(l.idp_pass_def) },
  { label: "INT", name: "Interceptions", get: (l) => fmt(l.idp_int) },
  { label: "FF", name: "Forced fumbles", get: (l) => fmt(l.idp_ff) },
  { label: "FR", name: "Fumble recoveries", get: (l) => fmt(l.idp_fum_rec) },
  { label: "TD", name: "Defensive touchdowns", get: (l) => fmt(l.idp_def_td) },
];

/** Combined tackles, falling back to solo plus assisted when the total is absent. */
export function totalTackles(l: StatLine): number {
  if (typeof l.idp_tkl === "number") return l.idp_tkl;
  return (l.idp_tkl_solo ?? 0) + (l.idp_tkl_ast ?? 0);
}

function TackleCell({ line }: { line: StatLine }) {
  const solo = line.idp_tkl_solo ?? 0;
  const ast = line.idp_tkl_ast ?? 0;
  return (
    <td className="px-3 py-2 text-right">
      <span className="block font-mono tabular-nums text-ink">{fmt(totalTackles(line))}</span>
      <span className="block font-mono text-[10px] tabular-nums text-ink-subtle">
        {fmt(solo)} solo, {fmt(ast)} asst
      </span>
    </td>
  );
}

function Th({ children, numeric = true, title }: { children: ReactNode; numeric?: boolean; title?: string }) {
  return (
    // The abbreviation stays one real text node and the spelled-out form is
    // the header's own name, so a reader pointing at the header finds it
    // (CLAUDE.md: never draw a figure twice, one copy aria-hidden).
    <th
      scope="col"
      aria-label={title}
      className={`px-3 py-2 font-semibold ${numeric ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

/* ---------- game log ---------- */

const STATUS_WORDS: Record<Exclude<DefenderWeek["status"], "played">, string> = {
  special: "No defensive snaps",
  bye: "Bye week",
  missed: "Did not play",
  upcoming: "Not played yet",
};

export function DefenderGameLog({
  season,
  weeks,
  playerName,
}: {
  season: number;
  weeks: DefenderWeek[];
  playerName: string;
}) {
  const option = useScoring();
  const cols = DEFENDER_COLUMNS;
  return (
    <StatScroll caption={`${playerName}, ${season} weekly defensive stat lines, scored in ${option.label}`}>
      <table className="w-full min-w-[900px] text-sm">
        <caption className="sr-only">
          {playerName}, {season} weekly defensive stat lines. Points are in {option.label}.
        </caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
          <tr className="border-b border-line">
            <Th numeric={false} title="Week">Wk</Th>
            <Th numeric={false} title="Opponent">Opp</Th>
            <Th title="Share of team defensive snaps">Snap%</Th>
            <Th title="Tackles, solo and assisted">Tkl</Th>
            {cols.map((c) => (
              <Th key={c.label} title={c.name}>
                {c.label}
              </Th>
            ))}
            <Th title="Points">Pts</Th>
            <Th title="Projected points">Proj</Th>
            <Th title="Points against projection">+/-</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {weeks.map((w) => {
            const proj = w.projected ? pointsFor(w.projected, option.map) : null;
            if (w.status === "played") {
              const pts = pointsFor(w.line, option.map);
              const delta = proj !== null ? pts - proj : null;
              return (
                <tr key={w.week} className="align-top hover:bg-surface">
                  <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink">
                    {w.week}
                  </th>
                  <td className="px-3 py-2 text-ink-muted">{w.opponent ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                    {w.snapPct !== null ? `${Math.round(w.snapPct * 100)}%` : "-"}
                  </td>
                  <TackleCell line={w.line} />
                  {cols.map((c) => (
                    <td key={c.label} className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                      {c.get(w.line)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                    {pts.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    {proj !== null ? proj.toFixed(1) : "-"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                      delta === null
                        ? "text-ink-subtle"
                        : delta >= 0
                          ? "text-signal-success"
                          : "text-signal-danger"
                    }`}
                  >
                    {delta === null ? "-" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
                  </td>
                </tr>
              );
            }
            return (
              <tr
                key={w.week}
                className={`align-top ${
                  w.status === "bye"
                    ? "bg-black/55 shadow-[inset_0_3px_10px_-2px_rgba(0,0,0,0.9),inset_0_-3px_10px_-2px_rgba(0,0,0,0.9)]"
                    : ""
                }`}
              >
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink-subtle">
                  {w.week}
                </th>
                <td className="px-3 py-2 text-ink-subtle">{w.opponent ?? "-"}</td>
                <td colSpan={cols.length + 3} className="px-3 py-2 text-xs uppercase tracking-wider text-ink-subtle">
                  {STATUS_WORDS[w.status]}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                  {proj !== null ? proj.toFixed(1) : "-"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink-subtle">-</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </StatScroll>
  );
}

/* ---------- career ---------- */

export function DefenderCareerTable({
  seasons,
  playerName,
}: {
  seasons: DefenderSeason[];
  playerName: string;
}) {
  const option = useScoring();
  if (seasons.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No regular-season defensive games on file for {playerName}.
      </p>
    );
  }
  return (
    <StatScroll caption={`${playerName}, career defensive totals by season, scored in ${option.label}`}>
      <table className="w-full min-w-[980px] text-sm">
        <caption className="sr-only">
          {playerName}, regular-season defensive totals by season. Points are in {option.label}.
        </caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
          <tr className="border-b border-line">
            <Th numeric={false}>Season</Th>
            <Th numeric={false} title="Position">Pos</Th>
            <Th title="Games">G</Th>
            <Th title="Games with 20 or more defensive snaps">G 20+</Th>
            <Th title="Average share of team defensive snaps">Snap%</Th>
            <Th title="Tackles, solo and assisted">Tkl</Th>
            {DEFENDER_COLUMNS.map((c) => (
              <Th key={c.label} title={c.name}>
                {c.label}
              </Th>
            ))}
            <Th title="Points">Pts</Th>
            <Th title="Points per game">PPG</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {seasons.map((s) => {
            const pts = pointsFor(s.line, option.map);
            return (
              <tr key={s.season} className="align-top hover:bg-surface">
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink">
                  {s.season}
                </th>
                <td className="px-3 py-2 text-ink-muted">{s.position}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{s.games}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{s.games20}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                  {s.avgSnapPct !== null ? `${Math.round(s.avgSnapPct * 100)}%` : "-"}
                </td>
                <TackleCell line={s.line} />
                {DEFENDER_COLUMNS.map((c) => (
                  <td key={c.label} className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                    {c.get(s.line)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                  {pts.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                  {s.games > 0 ? (pts / s.games).toFixed(1) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </StatScroll>
  );
}

/* ---------- this week ---------- */

export function DefenderThisWeek({
  next,
  accuracy,
  playerName,
  engineDisplay,
  headingLevel = 3,
  leagueLinks = [],
}: {
  next: DefenderWeek | null;
  accuracy: DefenderAccuracy | null;
  playerName: string;
  engineDisplay: string;
  headingLevel?: 2 | 3;
  /**
   * The reader's own IDP leagues, linked into League Pulse Lineups. Passed
   * only once the IDP switch is on (plan IDP-314); empty otherwise, so the
   * panel renders exactly as before.
   */
  leagueLinks?: { name: string; href: string }[];
}) {
  const option = useScoring();
  if (!next || !next.projected) {
    return (
      <Panel eyebrow="Outlook" title="This week" headingLevel={headingLevel}>
        <p className="text-sm leading-relaxed text-ink-muted">
          {engineDisplay} has not published a projection for {playerName}&apos;s next game.
        </p>
      </Panel>
    );
  }
  const line = next.projected;
  const pts = pointsFor(line, option.map);
  const parts = [
    `${fmt(totalTackles(line), 1)} tackles`,
    line.idp_sack ? `${fmt(line.idp_sack, 2)} sacks` : null,
    line.idp_qb_hit ? `${fmt(line.idp_qb_hit, 1)} QB hits` : null,
    line.idp_pass_def ? `${fmt(line.idp_pass_def, 1)} passes defended` : null,
    line.idp_int ? `${fmt(line.idp_int, 2)} interceptions` : null,
  ].filter((p): p is string => p !== null);
  return (
    <Panel
      eyebrow="Outlook"
      title={`Week ${next.week}${next.opponent ? ` against ${next.opponent}` : ""}`}
      helper={`${engineDisplay} projection, ${option.label}`}
      headingLevel={headingLevel}
    >
      <p className="font-mono text-3xl font-bold tabular-nums text-brand-purple">
        {pts.toFixed(1)}
        <span className="ml-2 font-sans text-sm font-medium text-ink-muted">projected points</span>
      </p>
      <p className="mt-2 text-sm text-ink-muted">Projected line: {parts.join(", ")}.</p>
      {scoresUnprojectedKeys(option.map) && (
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
          This scoring also rewards threshold bonuses, blocked kicks or games with three or more passes defended, which
          {" "}{engineDisplay} does not project, so the figure leaves them out.
        </p>
      )}
      {accuracy && (
        <p className="mt-3 border-t border-line pt-3 text-sm text-ink-muted">
          Beat the {engineDisplay} projection in {accuracy.weeksBeat} of {accuracy.weeksPlayed} games (
          {Math.round(accuracy.beatRate * 100)}%), measured in Sleeper default IDP scoring.
        </p>
      )}
      {leagueLinks.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {leagueLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Your lineup in {link.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
