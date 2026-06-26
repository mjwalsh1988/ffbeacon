"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Armchair,
  BarChart3,
  Check,
  Database,
  Flame,
  Info,
  Layers,
  Lightbulb,
  Shuffle,
  Sparkles,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { BeaconValue } from "@/components/beacon-value-icon";
import { calculateFaabRecommendation } from "@/lib/faab/calculate-faab";
import type {
  FaabResult,
  FaabSettings,
  NeedLevel as FaabNeedLevel,
} from "@/lib/faab/types";

export type FaabPlayer = {
  slug: string;
  name: string;
  position: string;
  team: string | null;
  /** Sleeper player id pulled from players.external_ids.sleeper. Drives
   * the headshot CDN URL; null when we don't have a Sleeper mapping yet. */
  sleeper_id: string | null;
  overall_rank: number;
  /** Per-position rank from rankings.position_rank for the resolved
   * (format, source) pair. Surfaced in the selected-player card. */
  position_rank: number;
  value: number | null;
};

type NeedLevel = FaabNeedLevel;

/** Card presentation for each roster-need level: a title, a short intensity
 * hint, and a thematic icon. The accessible name still comes from the visible
 * title + hint text inside each option's label. */
const NEED_META: Record<
  NeedLevel,
  { title: string; hint: string; icon: LucideIcon }
> = {
  low: { title: "Bench depth", hint: "Low need", icon: Armchair },
  medium: { title: "Streamer / FLEX", hint: "Medium need", icon: Shuffle },
  high: { title: "Starter you need now", hint: "High need", icon: Flame },
};

const MAX_SUGGESTIONS = 40;

export function FaabForm({
  players,
  formatName,
  rankingsSourceName,
  valueSourceName,
  valueSourceIsBeacon = false,
  settings,
}: {
  players: FaabPlayer[];
  formatName: string;
  /** Display name of the source backing the rankings (e.g. "KTC",
   * "FantasyCalc"). Falls back to null when no source covers the format. */
  rankingsSourceName: string | null;
  /** Same, for the player_value_history source. Often equal to rankings
   * source but can differ when one source publishes rankings only. */
  valueSourceName: string | null;
  /** True when the value source is FF Beacon, so the market value renders
   * with the FF Beacon mark. */
  valueSourceIsBeacon?: boolean;
  /** Editable calculator settings (bid curve, depth, dump, copy). Resolved
   * server-side; always a complete object thanks to code defaults. */
  settings: FaabSettings;
}) {
  const { userDefaults } = settings;
  const [query, setQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<FaabPlayer | null>(null);
  const [budget, setBudget] = useState(userDefaults.defaultBudget);
  const [need, setNeed] = useState<NeedLevel>(userDefaults.defaultNeed);
  const [teams, setTeams] = useState(userDefaults.defaultTeams);
  const [starters, setStarters] = useState(userDefaults.defaultStarters);

  // The page already resolved the ranked player list for the active
  // (source, format). That same list IS the value pool the calculator needs:
  // no extra fetch, and it normalizes value against this source's own range.
  const playerPool = useMemo(
    () => players.map((p) => ({ overallRank: p.overall_rank, value: p.value })),
    [players],
  );

  const budgetValid = Number.isFinite(budget) && budget > 0;

  const result = useMemo<FaabResult | null>(() => {
    if (!selectedPlayer || !budgetValid) return null;
    return calculateFaabRecommendation({
      player: {
        overallRank: selectedPlayer.overall_rank,
        positionRank: selectedPlayer.position_rank,
        value: selectedPlayer.value,
      },
      remainingBudget: budget,
      needLevel: need,
      teams,
      offensiveStarters: starters,
      settings,
      playerPool,
    });
  }, [selectedPlayer, budgetValid, budget, need, teams, starters, settings, playerPool]);

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="relative space-y-6 rounded-modal border border-line bg-surface p-6 sm:p-7"
      style={{ boxShadow: "0 0 64px -44px rgba(168, 85, 247, 0.6)" }}
      aria-labelledby="faab-form-heading"
    >
      {/* Beacon hairline inset from the corners so it does not poke past the
          rounded edges. The form intentionally avoids overflow-hidden so the
          player combobox listbox can extend past the card bounds. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-6 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <h2 id="faab-form-heading" className="sr-only">
        FAAB calculator inputs
      </h2>

      <SourceContextBar
        formatName={formatName}
        rankingsSourceName={rankingsSourceName}
        valueSourceName={valueSourceName}
      />

      <PlayerCombobox
        players={players}
        query={query}
        onQueryChange={setQuery}
        selected={selectedPlayer}
        onSelect={(p) => {
          setSelectedPlayer(p);
          setQuery(p ? p.name : "");
        }}
        formatName={formatName}
      />

      {selectedPlayer && (
        <SelectedPlayerCard
          player={selectedPlayer}
          formatName={formatName}
          rankingsSourceName={rankingsSourceName}
          valueSourceName={valueSourceName}
          valueSourceIsBeacon={valueSourceIsBeacon}
        />
      )}

      {/* League setup */}
      <fieldset className="rounded-card border border-line bg-base/40 p-4">
        <legend className="px-1 text-sm font-semibold text-ink">League setup</legend>
        <div className="mt-2 space-y-5">
          <PillGroup
            label="How many teams?"
            help={settings.copy.teamsHelp}
            icon={Users}
            name="faab-teams"
            options={userDefaults.teamOptions}
            value={teams}
            onChange={setTeams}
          />
          <PillGroup
            label="How many offensive starters?"
            help={settings.copy.startersHelp}
            icon={Layers}
            name="faab-starters"
            options={userDefaults.starterOptions}
            value={starters}
            onChange={setStarters}
          />
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="faab-budget" className="block text-sm font-medium text-ink">
            Remaining FAAB budget
          </label>
          <input
            id="faab-budget"
            type="number"
            min={1}
            max={1000}
            inputMode="numeric"
            value={Number.isFinite(budget) ? budget : ""}
            aria-invalid={!budgetValid}
            aria-describedby={!budgetValid ? "faab-budget-error" : undefined}
            onChange={(event) =>
              setBudget(Number.parseInt(event.target.value || "0", 10))
            }
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
          {!budgetValid && (
            <p id="faab-budget-error" role="alert" className="mt-1.5 text-xs text-signal-danger">
              Enter a remaining budget of at least 1 FAAB.
            </p>
          )}
        </div>
        <fieldset>
          <legend className="block text-sm font-medium text-ink">
            How badly do you need this position?
          </legend>
          <div className="mt-2 flex flex-col gap-2">
            {(["low", "medium", "high"] as NeedLevel[]).map((level) => (
              <NeedOption
                key={level}
                level={level}
                selected={need === level}
                onSelect={() => setNeed(level)}
              />
            ))}
          </div>
        </fieldset>
      </div>

      <ResultPanel
        result={result}
        selected={Boolean(selectedPlayer)}
        budgetValid={budgetValid}
        economyNotice={settings.copy.economyNotice}
      />
    </form>
  );
}

/**
 * The recommendation surface. Mirrors the Signal Check result hero: a tinted
 * card with a corner glow, an eyebrow, a large gradient figure, supporting
 * chips, a "why" card, situational notices, and the always-on league economy
 * note. Renders friendly empty/validation states before a result exists.
 */
function ResultPanel({
  result,
  selected,
  budgetValid,
  economyNotice,
}: {
  result: FaabResult | null;
  selected: boolean;
  budgetValid: boolean;
  economyNotice: string;
}) {
  const isDump = result?.isDumpCandidate ?? false;

  // One concise spoken status instead of making the whole rich card a live
  // region. This keeps announcements short and avoids re-reading the entire
  // recommendation on every budget keystroke.
  const liveSummary = !selected
    ? ""
    : !budgetValid
      ? "Enter your remaining FAAB budget to see a recommended bid."
      : result
        ? `Recommended bid ${
            result.lowBid === result.highBid
              ? `${result.highBid}`
              : `${result.lowBid} to ${result.highBid}`
          } FAAB, ${
            result.lowPct === result.highPct
              ? `${result.highPct}`
              : `${result.lowPct} to ${result.highPct}`
          } percent of budget. Tier ${result.tierLabel}. ${result.aggressionLabel}.`
        : "";

  return (
    <div className="space-y-3">
      <p className="sr-only" role="status" aria-live="polite">
        {liveSummary}
      </p>
      <div
        className={`relative overflow-hidden rounded-modal border p-5 ${
          !result
            ? "border-line bg-base/40"
            : isDump
              ? "border-brand-purple/40 bg-brand-purple/5"
              : "border-brand-cyan/30 bg-brand-cyan/5"
        }`}
      >
        {result && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full"
            style={{
              background: isDump
                ? "radial-gradient(circle, rgba(168,85,247,0.20) 0%, rgba(34,211,238,0.06) 50%, transparent 75%)"
                : "radial-gradient(circle, rgba(34,211,238,0.20) 0%, rgba(168,85,247,0.06) 50%, transparent 75%)",
            }}
          />
        )}
        <div className="relative">
          {!selected ? (
            <EmptyResult />
          ) : !budgetValid ? (
            <p className="text-sm text-ink-muted">
              Enter your remaining FAAB budget above to see a recommended bid.
            </p>
          ) : result ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    Recommended FAAB bid
                  </p>
                  <p
                    className="mt-1 bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent forced-colors:text-ink sm:text-4xl"
                    style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
                  >
                    {result.lowBid === result.highBid
                      ? `${result.highBid} FAAB`
                      : `${result.lowBid}-${result.highBid} FAAB`}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    Budget share {result.lowPct === result.highPct
                      ? `${result.highPct}%`
                      : `${result.lowPct}%-${result.highPct}%`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip label="Tier" value={result.tierLabel} />
                  <AggressionChip label={result.aggressionLabel} />
                </div>
              </div>

              <div className="rounded-card border border-line bg-base/50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Lightbulb aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                  Why this range?
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {result.explanation}
                </p>
              </div>

              {result.notices.map((note, i) => (
                <NoticeCard key={i}>{note}</NoticeCard>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* League economy note: always shown so the baseline nature of the
          numbers is clear. */}
      <div className="rounded-card border border-line bg-surface/40 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Info aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          League economy note
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{economyNotice}</p>
      </div>
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">Pick a player to get a bid.</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Set your league size, starters, budget, and need, then search a player
          above. We will weigh weekly starter demand, value, and your budget to
          recommend a FAAB range.
        </p>
      </div>
    </div>
  );
}

function NoticeCard({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-line/60 bg-base/60 px-3 py-2 text-xs leading-relaxed text-ink-subtle">
      {children}
    </p>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-3 py-1 text-xs">
      <span className="text-ink-subtle">{label}:</span>
      <span className="font-medium text-ink">{value}</span>
    </span>
  );
}

function AggressionChip({ label }: { label: FaabResult["aggressionLabel"] }) {
  const tone =
    label === "Empty the Clip"
      ? "border-brand-purple/50 bg-brand-purple/10 text-brand-purple"
      : label === "Aggressive"
        ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
        : label === "Balanced"
          ? "border-line bg-base text-ink"
          : "border-line bg-base text-ink-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * Accessible pill-style radiogroup for the team count and starter count. Native
 * radios are kept (visually hidden) so keyboard + screen reader semantics are
 * preserved; the selected pill lights up with the beacon gradient. The help
 * text is always visible (best for screen readers) and wired via
 * aria-describedby on the group.
 */
function PillGroup({
  label,
  help,
  icon: Icon,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  help: string;
  icon: LucideIcon;
  name: string;
  options: number[];
  value: number;
  onChange: (n: number) => void;
}) {
  const helpId = useId();
  return (
    <fieldset aria-describedby={helpId}>
      <legend className="flex items-center gap-2 text-sm font-medium text-ink">
        <Icon aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        {label}
      </legend>
      <p id={helpId} className="mt-1 text-xs leading-relaxed text-ink-subtle">
        {help}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <label key={opt} className="relative cursor-pointer">
              <input
                type="radio"
                name={name}
                value={opt}
                checked={selected}
                onChange={() => onChange(opt)}
                className="peer sr-only"
              />
              <span
                className={`flex h-11 min-w-11 items-center justify-center gap-1 rounded-card border px-4 text-sm font-semibold tabular-nums motion-safe:transition-all peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-cyan ${
                  selected
                    ? "border-transparent text-ink"
                    : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
                style={
                  selected
                    ? {
                        backgroundImage:
                          "linear-gradient(135deg, rgba(168,85,247,0.22) 0%, rgba(34,211,238,0.14) 100%)",
                        borderColor: "rgba(168,85,247,0.55)",
                        boxShadow: "0 0 28px -16px rgba(168,85,247,0.7)",
                      }
                    : undefined
                }
              >
                {/* Non-color selection cue (alongside the gradient fill) so the
                    active pill is distinguishable without relying on color. */}
                {selected && <Check aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />}
                {opt}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Roster-need selector rendered as a card-style radio. The native radio is
 * kept (visually hidden) so the group stays a real, keyboard-and-screen-reader
 * accessible radiogroup; the visible card carries an icon, a title, and an
 * intensity hint. The selected card lights up with the beacon gradient. Focus
 * is mirrored onto the card via the peer-focus-visible ring.
 */
function NeedOption({
  level,
  selected,
  onSelect,
}: {
  level: NeedLevel;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = NEED_META[level];
  const Icon = meta.icon;
  return (
    <label className="group relative block cursor-pointer">
      <input
        type="radio"
        name="need"
        value={level}
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={`flex min-h-11 items-center gap-3 rounded-card border p-3 motion-safe:transition-all peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-cyan ${
          selected
            ? "border-transparent text-ink"
            : "border-line bg-base/60 text-ink-muted hover:border-line-accent hover:text-ink"
        }`}
        style={
          selected
            ? {
                backgroundImage:
                  "linear-gradient(135deg, rgba(168,85,247,0.20) 0%, rgba(34,211,238,0.12) 100%)",
                borderColor: "rgba(168,85,247,0.55)",
                boxShadow: "0 0 36px -18px rgba(168,85,247,0.7)",
              }
            : undefined
        }
      >
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${
            selected ? "" : "border-line bg-base text-brand-cyan"
          }`}
          style={
            selected
              ? {
                  backgroundImage:
                    "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
                  borderColor: "transparent",
                  color: "#07070D",
                }
              : undefined
          }
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{meta.title}</span>
          <span className="block text-xs text-ink-subtle">{meta.hint}</span>
        </span>
        {selected && (
          <Check aria-hidden="true" className="ml-auto h-4 w-4 text-brand-cyan" />
        )}
      </span>
    </label>
  );
}

/**
 * Small banner pinned to the top of the form so the user always knows which
 * (source, format) pair is feeding rankings + values. Mirrors the design of
 * the league overview header chips: icon + label + value, brand-cyan accents.
 */
function SourceContextBar({
  formatName,
  rankingsSourceName,
  valueSourceName,
}: {
  formatName: string;
  rankingsSourceName: string | null;
  valueSourceName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-base/60 px-3 py-2.5 text-xs text-ink-muted">
      <ContextChip
        icon={Trophy}
        label="Format"
        value={formatName}
        tone="purple"
      />
      <ContextChip
        icon={BarChart3}
        label="Rankings"
        value={rankingsSourceName ?? "-"}
        tone="cyan"
      />
      {valueSourceName && valueSourceName !== rankingsSourceName ? (
        <ContextChip
          icon={Database}
          label="Values"
          value={valueSourceName}
          tone="cyan"
        />
      ) : (
        <ContextChip
          icon={Database}
          label="Values"
          value={valueSourceName ?? rankingsSourceName ?? "-"}
          tone="cyan"
        />
      )}
      <p className="ml-auto text-[11px] text-ink-subtle">
        Change source or format from the site header.
      </p>
    </div>
  );
}

function ContextChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  tone: "cyan" | "purple";
}) {
  const palette =
    tone === "cyan"
      ? {
          backgroundColor: "rgba(34, 211, 238, 0.08)",
          borderColor: "rgba(34, 211, 238, 0.30)",
          iconColor: "#22D3EE",
        }
      : {
          backgroundColor: "rgba(168, 85, 247, 0.08)",
          borderColor: "rgba(168, 85, 247, 0.30)",
          iconColor: "#A855F7",
        };
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
      style={{
        backgroundColor: palette.backgroundColor,
        borderColor: palette.borderColor,
      }}
    >
      <Icon
        className="h-3.5 w-3.5"
        style={{ color: palette.iconColor }}
        aria-hidden="true"
      />
      <span className="font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

/**
 * Selected-player card. Shows the player identity (position badge, name,
 * NFL team) on the left and the three metrics that drive the FAAB heuristic
 * on the right: per-position rank, overall rank, and market value, each
 * labeled with the source it came from so users know which data they're
 * looking at (KTC vs FantasyCalc).
 */
function SelectedPlayerCard({
  player,
  formatName,
  rankingsSourceName,
  valueSourceName,
  valueSourceIsBeacon,
}: {
  player: FaabPlayer;
  formatName: string;
  rankingsSourceName: string | null;
  valueSourceName: string | null;
  valueSourceIsBeacon: boolean;
}) {
  return (
    <section
      aria-label="Selected player"
      className="relative overflow-hidden rounded-card border border-line bg-base/60 p-4"
    >
      {/* Left-edge gradient accent strip, the shared FF Beacon card motif. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage:
            "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PlayerHeadshot
            sleeperId={player.sleeper_id}
            position={player.position}
            name={player.name}
            size={48}
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{player.name}</h3>
            <p className="truncate text-xs text-ink-subtle">
              {player.position}
              {player.team ? ` · ${player.team}` : ""} · {formatName}
            </p>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric
          label={`${player.position} rank`}
          value={`#${player.position_rank}`}
          attribution={rankingsSourceName ?? "-"}
        />
        <Metric
          label="Overall rank"
          value={`#${player.overall_rank}`}
          attribution={rankingsSourceName ?? "-"}
        />
        <Metric
          label="Market value"
          value={
            player.value != null && player.value > 0 ? (
              <BeaconValue show={valueSourceIsBeacon}>
                {player.value.toLocaleString()}
              </BeaconValue>
            ) : (
              "-"
            )
          }
          attribution={valueSourceName ?? rankingsSourceName ?? "-"}
        />
      </dl>
    </section>
  );
}

function Metric({
  label,
  value,
  attribution,
}: {
  label: string;
  value: React.ReactNode;
  attribution: string;
}) {
  return (
    <div className="rounded-card border border-line/60 bg-surface px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-ink">
        {value}
      </dd>
      <p className="mt-0.5 text-[10px] text-ink-subtle">via {attribution}</p>
    </div>
  );
}


/**
 * Accessible combobox/listbox replacement for the old <datalist>. The native
 * datalist was the source of the bugs the user reported:
 *   - On iOS Safari / Chrome Android, datalist suggestions either don't render
 *     or only display the `value` attribute (so no metadata is visible).
 *   - On desktop, the browser-rendered popup can't be styled, and with 300
 *     options it occasionally renders pinned to the viewport edge instead of
 *     anchored below the input.
 *
 * This custom combobox follows the WAI-ARIA combobox-with-listbox pattern:
 *   role="combobox" on the input, aria-controls + aria-expanded wired to the
 *   listbox, aria-activedescendant tracks the highlighted option, and the
 *   listbox is positioned absolutely directly under the input.
 */
function PlayerCombobox({
  players,
  query,
  onQueryChange,
  selected,
  onSelect,
  formatName,
}: {
  players: FaabPlayer[];
  query: string;
  onQueryChange: (q: string) => void;
  selected: FaabPlayer | null;
  onSelect: (player: FaabPlayer | null) => void;
  formatName: string;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Empty query - show the top-ranked players so users see something
      // immediately when they tap the field.
      return players.slice(0, MAX_SUGGESTIONS);
    }
    // Rank substring matches by overall_rank ascending so the most relevant
    // player shows up first. Cap to keep the DOM small.
    const out: FaabPlayer[] = [];
    for (const p of players) {
      if (p.name.toLowerCase().includes(q)) out.push(p);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }, [players, query]);

  // Clamp the active index whenever the visible match list changes (e.g. user
  // types another character and the matching set shrinks).
  useEffect(() => {
    if (activeIdx >= matches.length) setActiveIdx(0);
  }, [matches.length, activeIdx]);

  // Click-outside closes the listbox.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      const node = wrapperRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const commit = useCallback(
    (player: FaabPlayer) => {
      onSelect(player);
      setOpen(false);
      // Defocus on touch devices so the on-screen keyboard collapses; users
      // wanted to see the recommendation after selecting.
      inputRef.current?.blur();
    },
    [onSelect],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && matches[activeIdx]) {
        event.preventDefault();
        commit(matches[activeIdx]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Home") {
      if (open) {
        event.preventDefault();
        setActiveIdx(0);
      }
    } else if (event.key === "End") {
      if (open) {
        event.preventDefault();
        setActiveIdx(matches.length - 1);
      }
    }
  };

  const showClear = query.length > 0 || selected != null;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium">
        Player
      </label>
      <div className="relative mt-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && matches[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined
          }
          aria-describedby={helpId}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          inputMode="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
            // Editing invalidates the current selection - caller re-resolves
            // on the next commit.
            if (selected && event.target.value !== selected.name) {
              onSelect(null);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Start typing a player name"
          className="w-full rounded-card border border-line bg-base px-3 py-2 pr-9 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none sm:text-sm"
        />
        {showClear && (
          <button
            type="button"
            onClick={() => {
              onQueryChange("");
              onSelect(null);
              setActiveIdx(0);
              setOpen(true);
              inputRef.current?.focus();
            }}
            aria-label={
              selected
                ? `Clear ${selected.name} and search for a different player`
                : "Clear search field"
            }
            title="Clear"
            className="absolute inset-y-0 right-0 my-1 mr-1 inline-flex w-8 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-line/40 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        Pull from the top 300 ranked players. {formatName} format.
      </p>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player suggestions"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {matches.length === 0 ? (
            <li role="presentation" className="px-3 py-3 text-sm text-ink-subtle">
              No players match &ldquo;{query}&rdquo;.
            </li>
          ) : (
            matches.map((p, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={p.slug}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  // Mouse-over highlights so cursor + keyboard stay in sync.
                  onMouseEnter={() => setActiveIdx(i)}
                  // onMouseDown (not click) so the input doesn't blur before
                  // we get the chance to handle selection.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(p);
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm motion-safe:transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ""}
                    </span>
                  </span>
                  <span className="flex-shrink-0 font-mono text-xs tabular-nums text-ink-subtle">
                    #{p.overall_rank}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
