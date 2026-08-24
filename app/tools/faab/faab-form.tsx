"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import {
  Armchair,
  BarChart3,
  Check,
  Database,
  Flame,
  Layers,
  Shuffle,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { BeaconValue } from "@/components/beacon-value-icon";
import { LeaguePanel } from "./league-panel";
import { ManualResult } from "./manual-result";
import { PlayerCombobox, type FaabPlayer } from "./player-combobox";
import { calculateFaabRecommendation } from "@/lib/faab/calculate-faab";
import type {
  FaabResult,
  FaabSettings,
  NeedLevel as FaabNeedLevel,
} from "@/lib/faab/types";

export type { FaabPlayer };

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

export function FaabForm({
  masthead,
  players,
  formatName,
  rankingsSourceName,
  valueSourceName,
  valueSourceIsBeacon = false,
  settings,
  seasons,
  formatSlug,
  rankingsSourceSlug = null,
  initialSleeperUsername = null,
}: {
  /**
   * The page hero, rendered on the server and handed in so this component can
   * decide when it belongs. It is for people deciding whether to use the
   * calculator; once a player is picked they have decided, so the tool leads
   * and the marketing copy above it steps aside.
   */
  masthead: ReactNode;
  players: FaabPlayer[];
  formatName: string;
  /** Resolved format slug, so the manual read picks the right scoring base. */
  formatSlug: string;
  /** Resolved rankings source slug, used to list a league's free agents. */
  rankingsSourceSlug?: string | null;
  /** The signed-in reader's linked Sleeper handle, prefilled into the league
   * box. Null when signed out or not linked. */
  initialSleeperUsername?: string | null;
  /** Seasons offered by the league panel. Server-derived. */
  seasons: string[];
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
    // No space-y-* here on purpose: it emits `margin-top: 0` on every child
    // after the first at a higher specificity than a utility class, which
    // silently flattened the separator's own margin. The separator owns its
    // spacing instead.
    <>
      {!selectedPlayer && masthead}
      {/* One width, always, matching the other tools. An earlier version only
          widened once a player was picked, which left the page people actually
          land on sitting in a 48rem column under a full-width hero, and made
          the layout jump the moment they picked someone. */}
      <div
        id="faab-form-section"
        // The top margin belongs to the gap under the hero, so it goes when the
        // hero does and the tool sits directly under the breadcrumb bar.
        className={`mx-auto max-w-[88rem] scroll-mt-24 ${selectedPlayer ? "" : "mt-8"}`}
      >
      {/* The page h1 while the hero is not rendering one. Not painted: the
          selected player's card names him directly below. */}
      {selectedPlayer && (
        <h1 className="sr-only">FAAB bid for {selectedPlayer.name}</h1>
      )}
      {/* The better answer leads. Connecting a league measures the bid against a
          real roster instead of a generic one, so it is offered first rather
          than tucked under the form where nobody found it. */}
      <LeaguePanel
        formatName={formatName}
        needLevel={need}
        fallbackBudget={budgetValid ? budget : userDefaults.defaultBudget}
        leagueModeNotice={settings.copy.leagueModeNotice}
        seasons={seasons}
        initialUsername={initialSleeperUsername}
        formatSlug={formatSlug}
        sourceSlug={rankingsSourceSlug}
      />

      <OrDivider />

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
      {/* Setup on the left, the bid on the right, from lg up. Both columns are
          there before a player is picked too: the right one holds the empty
          state that explains what it will show, which is a better use of the
          space than centring the form and leaving half the page blank.
          `items-start` plus a sticky right column keeps the recommendation on
          screen while the league setup below it is adjusted, which is the loop
          this tool exists for.
          The left column carries `relative z-10` so the player combobox's
          listbox still paints over the sticky column beside it: a sticky
          element makes its own stacking context and would otherwise win. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-8">
      <div className="relative z-10 space-y-6">
      <div>
        <h2 id="faab-form-heading" className="text-lg font-semibold tracking-tight text-ink">
          No league? Enter your setup instead
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          We price him against the best player you could already start in a league
          this size, then adjust for his projections, usage, and the calendar.
        </p>
      </div>

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
            className="mt-2 w-full max-w-xs rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
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
          <div className="mt-2 flex max-w-md flex-col gap-2">
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

      </div>

      <div className="lg:sticky lg:top-24">
      <ManualResult
        player={selectedPlayer}
        formatSlug={formatSlug}
        formatName={formatName}
        teams={teams}
        starters={starters}
        budget={budget}
        budgetValid={budgetValid}
        need={need}
        settings={settings}
        fallbackResult={result}
      />
      </div>
      </div>
      </form>
      </div>
    </>
  );
}

/**
 * The choice between the two paths, made visible.
 *
 * Generous margin on both sides so it reads as a fork rather than a caption on
 * whichever block it happens to sit next to.
 */
function OrDivider() {
  return (
    <div
      role="separator"
      aria-label="or, without a league"
      className="my-16 flex items-center gap-4 sm:my-20"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted"
      >
        or
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
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
              {player.team ? `, ${player.team}` : ""}, {formatName}
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
