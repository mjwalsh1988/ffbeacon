import { Plus, Minus, ArrowRight, Coins, Layers } from "lucide-react";
import type { TradeAnalysis, TradeSide } from "@/lib/trade-analyzer";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { PlayerHeadshot } from "@/components/player-headshot";
import { CopyLinkButton } from "@/components/copy-link-button";
import { BeaconValue, BEACON_SOURCE_SLUG } from "@/components/beacon-value-icon";
import { SITE_TIME_ZONE } from "@/lib/datetime";

export type TransactionRowData = {
  /** Sleeper transaction id (used in trade share links). */
  sleeperTransactionId: string;
  /** "trade" | "waiver" | "free_agent" | "commissioner" — display label is derived. */
  type: string;
  status: string | null;
  week: number | null;
  season: number | null;
  /** ISO timestamp of the Sleeper-side creation event. */
  createdAtSleeper: string | null;
  /** Map of sleeper_player_id → receiving roster_id. */
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  /** Normalized draft pick array (see lib/league-pulse.normalizeDraftPicks). */
  draftPicks: unknown[];
  /** Sleeper waiver_budget transfer array. */
  waiverBudget: Array<{ sender: number; receiver: number; amount: number }>;
  /** Resolved player metadata (for non-trade types). For trades we use
   * analysis.sides instead so values render alongside names. */
  playerLookup: Record<
    string,
    { name: string; position: string | null; team: string | null }
  >;
  /** Per-roster identity for the involved rosters. */
  rosterIdentities: Record<
    number,
    { teamName: string; ownerHandle: string | null; avatarId: string | null }
  >;
  /** Trade-only analysis result. null for non-trade types. */
  analysis: TradeAnalysis | null;
};

type TransactionRowProps = {
  data: TransactionRowData;
  sleeperLeagueId: string;
  /** When true, render the share/copy link button. False on the OG card / OG
   * preview where we don't want clipboard buttons. */
  showShareLink?: boolean;
};

/**
 * One-row renderer used by both the Transactions tab (recent 10) and the
 * full /leagues/[id]/transactions feed.
 *
 * Trades render side-by-side acquired-by-team layouts with per-side value
 * totals and a verdict. Waivers and free-agent moves render the plain
 * adds/drops list. Mobile-first: rows stack on narrow viewports; nothing
 * is hidden by responsive utilities.
 */
export function TransactionRow({
  data,
  sleeperLeagueId,
  showShareLink = true,
}: TransactionRowProps) {
  const typeLabel = formatTypeLabel(data.type);
  const isTrade = data.type === "trade";
  const isComplete = (data.status ?? "").toLowerCase() === "complete";

  return (
    <article
      className="rounded-card border border-line bg-surface p-4 sm:p-5"
      aria-label={typeLabel}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TypePill type={data.type} label={typeLabel} />
          {data.week != null && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
              {data.week === 0 ? "Preseason" : `Week ${data.week}`}
            </span>
          )}
          {data.season != null && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
              {data.season}
            </span>
          )}
          {!isComplete && data.status && (
            <span
              className="rounded-full border border-signal-warning/50 bg-signal-warning/10 px-2 py-0.5 text-xs text-signal-warning"
              aria-label={`Status: ${data.status}`}
            >
              {data.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data.createdAtSleeper && (
            <time
              dateTime={data.createdAtSleeper}
              className="text-xs text-ink-subtle"
            >
              {formatDateLabel(data.createdAtSleeper)}
            </time>
          )}
          {showShareLink && isTrade && (
            <CopyLinkButton
              href={`/leagues/${sleeperLeagueId}/transactions#tx-${data.sleeperTransactionId}`}
              ariaLabel={`Copy link to this trade`}
              size="sm"
            />
          )}
        </div>
      </header>

      {isTrade && data.analysis ? (
        <TradeAnalyzerBody analysis={data.analysis} />
      ) : (
        <MovesBody
          adds={data.adds}
          drops={data.drops}
          draftPicks={data.draftPicks}
          waiverBudget={data.waiverBudget}
          playerLookup={data.playerLookup}
          rosterIdentities={data.rosterIdentities}
        />
      )}
    </article>
  );
}

function TypePill({ type, label }: { type: string; label: string }) {
  const tone =
    type === "trade"
      ? "border-brand-purple/40 bg-brand-purple/10 text-brand-purple"
      : type === "waiver"
        ? "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
        : "border-line bg-surface-elevated text-ink";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}

function TradeAnalyzerBody({ analysis }: { analysis: TradeAnalysis }) {
  const { sides, verdict, hasMissingValues, context } = analysis;
  const verdictLabel = buildVerdictLabel(verdict, sides);
  // Player values come from the user-selected value source; mark them when
  // that source is FF Beacon. Draft pick values always come from KTC
  // (context.pickSourceSlug), so pick rows never get the mark.
  const valueIsBeacon = context.sourceSlug === BEACON_SOURCE_SLUG;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {sides.map((side) => (
          <TradeSideCard
            key={side.rosterId}
            side={side}
            isWinner={
              verdict.winnerRosterId != null && side.rosterId === verdict.winnerRosterId
            }
            valueIsBeacon={valueIsBeacon}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-base/40 p-3 text-sm">
        <p className="font-semibold text-ink">
          <span className="text-ink-muted">Verdict: </span>
          {verdictLabel}
        </p>
        <p className="text-xs text-ink-muted">
          Values via {context.sourceDisplay} • {context.formatDisplay}
        </p>
      </div>

      {context.pickSourceSlug && context.pickSourceSlug !== context.sourceSlug && (
        <p className="text-xs text-ink-muted">
          Draft pick values powered by {context.pickSourceDisplay} (
          {context.sourceDisplay} doesn't publish pick values).
        </p>
      )}

      {hasMissingValues && (
        <p className="text-xs text-signal-warning" role="status">
          Some assets in this trade lack value data; differential may be incomplete.
        </p>
      )}
    </div>
  );
}

function TradeSideCard({
  side,
  isWinner,
  valueIsBeacon,
}: {
  side: TradeSide;
  isWinner: boolean;
  valueIsBeacon: boolean;
}) {
  return (
    <section
      aria-labelledby={`side-${side.rosterId}-name`}
      className={`rounded-card border p-4 ${
        isWinner ? "border-brand-cyan/60 bg-brand-cyan/5" : "border-line bg-base/30"
      }`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={`side-${side.rosterId}-name`}
            className="truncate text-sm font-semibold text-ink"
          >
            {side.teamName}
          </h3>
          {side.ownerHandle && (
            <p className="truncate text-[11px] text-ink-subtle">@{side.ownerHandle}</p>
          )}
        </div>
        <p
          className="font-mono text-lg font-semibold text-ink"
          aria-label={`Total value received: ${formatValue(side.totalValue)} points`}
        >
          <BeaconValue show={valueIsBeacon}>
            {formatValue(side.totalValue)}
          </BeaconValue>
        </p>
      </header>
      <p className="mt-1 text-xs uppercase tracking-wider text-ink-subtle">Acquired</p>
      <ul className="mt-2 space-y-1.5" role="list">
        {side.players.map((p) => (
          <li
            key={`${side.rosterId}-p-${p.sleeperId}`}
            className="flex items-center justify-between gap-2 text-sm"
            aria-label={`${p.name}${p.position ? ` ${p.position}` : ""}${p.team ? ` ${p.team}` : ""}, ${p.noValue ? "value not available" : `value ${formatValue(p.value)}`}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <PlayerHeadshot
                sleeperId={p.sleeperId}
                position={p.position ?? ""}
                name={p.name}
                size={20}
              />
              <span className="min-w-0 truncate text-ink">{p.name}</span>
              <PlayerMetaTag position={p.position} team={p.team} />
            </div>
            <span
              className={`shrink-0 font-mono text-sm tabular-nums ${
                p.noValue ? "text-ink-muted italic" : "text-ink-muted"
              }`}
            >
              <BeaconValue show={valueIsBeacon && !p.noValue}>
                {p.noValue ? "—" : formatValue(p.value)}
              </BeaconValue>
            </span>
          </li>
        ))}
        {side.picks.map((p, i) => {
          const labelText = p.pickLabel
            ? `${p.season} R${p.pickLabel}`
            : `${p.season} ${ordinal(p.round)} round`;
          const slotAria = p.pickLabel
            ? `${p.season} round ${p.round}, slot ${p.slot}`
            : `${p.season} ${ordinal(p.round)} round pick (${p.pickPosition})`;
          return (
            <li
              key={`${side.rosterId}-pick-${i}`}
              className="flex items-center justify-between gap-2 text-sm"
              aria-label={`${slotAria}, ${p.noValue ? "value not available" : `value ${formatValue(p.value)}`}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <PickToken />
                <span className="truncate text-ink">{labelText}</span>
                {!p.pickLabel && (
                  <span className="shrink-0 text-xs text-ink-muted">{p.pickPosition}</span>
                )}
              </div>
              <span
                className={`shrink-0 font-mono text-sm tabular-nums ${
                  p.noValue ? "text-ink-muted italic" : "text-ink-muted"
                }`}
              >
                {p.noValue ? "—" : formatValue(p.value)}
              </span>
            </li>
          );
        })}
        {side.players.length === 0 && side.picks.length === 0 && (
          <li className="text-xs text-ink-subtle italic">No assets received.</li>
        )}
      </ul>
    </section>
  );
}

type PlayerMeta = { name: string; position: string | null; team: string | null };
type RosterIdentity = {
  teamName: string;
  ownerHandle: string | null;
  avatarId: string | null;
};

function MovesBody({
  adds,
  drops,
  draftPicks,
  waiverBudget,
  playerLookup,
  rosterIdentities,
}: {
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draftPicks: unknown[];
  waiverBudget: Array<{ sender: number; receiver: number; amount: number }>;
  playerLookup: Record<string, PlayerMeta>;
  rosterIdentities: Record<number, RosterIdentity>;
}) {
  const addEntries = adds ? Object.entries(adds) : [];
  const dropEntries = drops ? Object.entries(drops) : [];
  const empty =
    addEntries.length === 0 &&
    dropEntries.length === 0 &&
    draftPicks.length === 0 &&
    waiverBudget.length === 0;

  if (empty) {
    return (
      <p className="mt-3 text-sm italic text-ink-subtle">
        No player movement recorded for this transaction.
      </p>
    );
  }

  // Group adds and drops under the roster that made the move. The common
  // waiver / free-agent shape is one manager adding a player and dropping
  // another, so showing the team once with clearly-labelled Added / Dropped
  // columns reads far cleaner than repeating "via Team" on every line.
  const byRoster = new Map<number, { added: string[]; dropped: string[] }>();
  const ensure = (rid: number) => {
    let group = byRoster.get(rid);
    if (!group) {
      group = { added: [], dropped: [] };
      byRoster.set(rid, group);
    }
    return group;
  };
  for (const [pid, rid] of addEntries) ensure(rid).added.push(pid);
  for (const [pid, rid] of dropEntries) ensure(rid).dropped.push(pid);
  const rosterGroups = Array.from(byRoster.entries());

  return (
    <div className="mt-4 space-y-3">
      {rosterGroups.map(([rid, group]) => (
        <RosterMoveCard
          key={`roster-${rid}`}
          rosterId={rid}
          roster={rosterIdentities[rid]}
          added={group.added}
          dropped={group.dropped}
          lookup={playerLookup}
        />
      ))}

      {waiverBudget.length > 0 && (
        <section
          aria-labelledby="faab-heading"
          className="rounded-card border border-line bg-base/30 p-3 sm:p-4"
        >
          <h3
            id="faab-heading"
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
          >
            <Coins aria-hidden="true" className="h-3.5 w-3.5 text-signal-positive" />
            FAAB transfer
          </h3>
          <ul className="mt-2 space-y-1.5" role="list">
            {waiverBudget.map((b, i) => (
              <li
                key={`faab-${i}`}
                className="flex flex-wrap items-center gap-1.5 text-sm"
                aria-label={`${labelFor(b.sender, rosterIdentities)} sent $${b.amount} FAAB to ${labelFor(b.receiver, rosterIdentities)}`}
              >
                <span className="text-ink">{labelFor(b.sender, rosterIdentities)}</span>
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                <span className="text-ink">{labelFor(b.receiver, rosterIdentities)}</span>
                <span className="ml-0.5 rounded-full border border-signal-positive/30 bg-signal-positive/10 px-2 py-0.5 font-mono text-xs font-semibold text-signal-positive">
                  ${b.amount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {draftPicks.length > 0 && (
        <section
          aria-labelledby="picks-heading"
          className="rounded-card border border-line bg-base/30 p-3 sm:p-4"
        >
          <h3
            id="picks-heading"
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
          >
            <Layers aria-hidden="true" className="h-3.5 w-3.5 text-brand-purple" />
            Draft picks moved
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5" role="list">
            {draftPicks.map((raw, i) => {
              const p = (raw ?? {}) as Record<string, unknown>;
              const season = String(p.season ?? "?");
              const round = Number(p.round ?? 0);
              const label =
                typeof p.pick_label === "string" && p.pick_label
                  ? p.pick_label
                  : null;
              return (
                <li
                  key={`pick-${i}`}
                  className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-ink"
                >
                  {label ? `${season} R${label}` : `${season} ${ordinal(round)} round`}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function RosterMoveCard({
  rosterId,
  roster,
  added,
  dropped,
  lookup,
}: {
  rosterId: number;
  roster: RosterIdentity | undefined;
  added: string[];
  dropped: string[];
  lookup: Record<string, PlayerMeta>;
}) {
  const teamName = roster?.teamName ?? `Team ${rosterId}`;
  const bothSides = added.length > 0 && dropped.length > 0;
  return (
    <section
      aria-label={`Roster move for ${teamName}`}
      className="rounded-card border border-line bg-base/30 p-3 sm:p-4"
    >
      <header className="flex items-center gap-2 border-b border-line pb-2.5">
        <SleeperAvatar
          avatarId={roster?.avatarId ?? null}
          initial={teamName.charAt(0)}
          title={teamName}
          size={24}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{teamName}</p>
          {roster?.ownerHandle && (
            <p className="truncate text-[11px] text-ink-subtle">
              @{roster.ownerHandle}
            </p>
          )}
        </div>
      </header>
      <div
        className={`mt-3 grid gap-x-6 gap-y-3 ${
          bothSides ? "sm:grid-cols-2" : "sm:grid-cols-1"
        }`}
      >
        {added.length > 0 && (
          <MoveGroup variant="added" players={added} lookup={lookup} />
        )}
        {dropped.length > 0 && (
          <MoveGroup variant="dropped" players={dropped} lookup={lookup} />
        )}
      </div>
    </section>
  );
}

function MoveGroup({
  variant,
  players,
  lookup,
}: {
  variant: "added" | "dropped";
  players: string[];
  lookup: Record<string, PlayerMeta>;
}) {
  const isAdd = variant === "added";
  return (
    <div>
      <h4
        className={`text-[11px] font-semibold uppercase tracking-wider ${
          isAdd ? "text-brand-cyan" : "text-signal-warning"
        }`}
      >
        {isAdd ? "Added" : "Dropped"}{" "}
        <span className="text-ink-subtle">({players.length})</span>
      </h4>
      <ul className="mt-2 space-y-1.5" role="list">
        {players.map((pid) => (
          <MovePlayerLine
            key={`${variant}-${pid}`}
            pid={pid}
            lookup={lookup}
            variant={variant}
          />
        ))}
      </ul>
    </div>
  );
}

function MovePlayerLine({
  pid,
  lookup,
  variant,
}: {
  pid: string;
  lookup: Record<string, PlayerMeta>;
  variant: "added" | "dropped";
}) {
  const meta = lookup[pid] ?? { name: pid, position: null, team: null };
  const isAdd = variant === "added";
  const Icon = isAdd ? Plus : Minus;
  return (
    <li
      className="flex items-center gap-2 text-sm"
      aria-label={`${isAdd ? "Added" : "Dropped"} ${meta.name}${meta.position ? `, ${meta.position}` : ""}${meta.team ? `, ${meta.team}` : ""}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          isAdd
            ? "bg-brand-cyan/15 text-brand-cyan"
            : "bg-signal-warning/15 text-signal-warning"
        }`}
      >
        <Icon className="h-3 w-3" strokeWidth={3} />
      </span>
      <PlayerHeadshot
        sleeperId={pid}
        position={meta.position ?? ""}
        name={meta.name}
        size={20}
      />
      {/* Name is content-width (not flex-1) so the meta tag sits inline right
          after it on every breakpoint. min-w-0 + truncate lets a long name
          ellipsis instead of shoving the tag off the row. */}
      <span className="min-w-0 truncate text-ink">{meta.name}</span>
      <PlayerMetaTag position={meta.position} team={meta.team} />
    </li>
  );
}

/**
 * Condensed position + NFL team tag (e.g. "QB · KC") in one small rounded
 * pill. Shared by the trade side cards and the waiver / free-agent move
 * cards so player meta reads identically everywhere. The dot separator is a
 * styled element, not a character, so it stays crisp at any size.
 */
function PlayerMetaTag({
  position,
  team,
}: {
  position: string | null;
  team: string | null;
}) {
  if (!position && !team) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium leading-none">
      {position && <span className="uppercase text-ink-muted">{position}</span>}
      {position && team && (
        <span aria-hidden="true" className="h-0.5 w-0.5 rounded-full bg-ink-subtle" />
      )}
      {team && <span className="text-ink-subtle">{team}</span>}
    </span>
  );
}

/**
 * Round token rendered in front of draft picks in the trade side cards so
 * pick rows line up with the player rows (which lead with a headshot of the
 * same size). Uses the same purple Layers glyph as the "Draft picks" heading.
 */
function PickToken() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-base text-brand-purple"
    >
      <Layers className="h-3 w-3" />
    </span>
  );
}

function labelFor(
  rosterId: number,
  rosterIdentities: Record<
    number,
    { teamName: string; ownerHandle: string | null; avatarId: string | null }
  >,
): string {
  return rosterIdentities[rosterId]?.teamName ?? `Team ${rosterId}`;
}

function buildVerdictLabel(
  verdict: TradeAnalysis["verdict"],
  sides: TradeAnalysis["sides"],
): string {
  if (verdict.label === "Even trade") return "Even trade";
  const winner = sides.find((s) => s.rosterId === verdict.winnerRosterId);
  // Prefer the owner's Sleeper username on the verdict line so users
  // immediately recognize the trade partner; team names rotate but
  // handles are durable. Falls back to team name and a numeric label.
  const name = winner?.ownerHandle
    ? `@${winner.ownerHandle}`
    : (winner?.teamName ?? "—");
  if (verdict.label === "Slight edge") {
    return `Slight edge to ${name} (+${formatValue(verdict.differential)}, ${verdict.differentialPct.toFixed(1)}%)`;
  }
  return `${name} won the trade (+${formatValue(verdict.differential)}, ${verdict.differentialPct.toFixed(1)}%)`;
}

function formatTypeLabel(type: string): string {
  const map: Record<string, string> = {
    trade: "Trade",
    waiver: "Waiver",
    free_agent: "Free agent",
    commissioner: "Commissioner",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: SITE_TIME_ZONE,
  });
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}
