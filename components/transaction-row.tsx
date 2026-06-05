import type { TradeAnalysis, TradeSide } from "@/lib/trade-analyzer";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { CopyLinkButton } from "@/components/copy-link-button";

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

function TradeSideCard({ side, isWinner }: { side: TradeSide; isWinner: boolean }) {
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
          {formatValue(side.totalValue)}
        </p>
      </header>
      <p className="mt-1 text-xs uppercase tracking-wider text-ink-subtle">Acquired</p>
      <ul className="mt-2 space-y-1.5" role="list">
        {side.players.map((p) => (
          <li
            key={`${side.rosterId}-p-${p.sleeperId}`}
            className="flex items-baseline justify-between gap-2 text-sm"
            aria-label={`${p.name}${p.position ? ` ${p.position}` : ""}${p.team ? ` ${p.team}` : ""}, ${p.noValue ? "value not available" : `value ${formatValue(p.value)}`}`}
          >
            <div className="min-w-0">
              <span className="truncate text-ink">{p.name}</span>
              {p.position && (
                <span className="ml-1 text-xs text-ink-muted">{p.position}</span>
              )}
              {p.team && <span className="ml-1 text-xs text-ink-muted">· {p.team}</span>}
            </div>
            <span
              className={`font-mono text-sm tabular-nums ${
                p.noValue ? "text-ink-muted italic" : "text-ink-muted"
              }`}
            >
              {p.noValue ? "—" : formatValue(p.value)}
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
              className="flex items-baseline justify-between gap-2 text-sm"
              aria-label={`${slotAria}, ${p.noValue ? "value not available" : `value ${formatValue(p.value)}`}`}
            >
              <div className="min-w-0">
                <span className="text-ink">{labelText}</span>
                {!p.pickLabel && (
                  <span className="ml-1 text-xs text-ink-muted">{p.pickPosition}</span>
                )}
              </div>
              <span
                className={`font-mono text-sm tabular-nums ${
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
  playerLookup: Record<
    string,
    { name: string; position: string | null; team: string | null }
  >;
  rosterIdentities: Record<
    number,
    { teamName: string; ownerHandle: string | null; avatarId: string | null }
  >;
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

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {addEntries.length > 0 && (
        <section aria-labelledby="adds-heading">
          <h3
            id="adds-heading"
            className="text-xs font-semibold uppercase tracking-wider text-brand-cyan"
          >
            Acquired
          </h3>
          <ul className="mt-2 space-y-1.5" role="list">
            {addEntries.map(([pid, rid]) => (
              <PlayerLine
                key={`add-${pid}`}
                pid={pid}
                rosterId={rid}
                lookup={playerLookup}
                rosterIdentities={rosterIdentities}
              />
            ))}
          </ul>
        </section>
      )}
      {dropEntries.length > 0 && (
        <section aria-labelledby="drops-heading">
          <h3
            id="drops-heading"
            className="text-xs font-semibold uppercase tracking-wider text-signal-warning"
          >
            Released
          </h3>
          <ul className="mt-2 space-y-1.5" role="list">
            {dropEntries.map(([pid, rid]) => (
              <PlayerLine
                key={`drop-${pid}`}
                pid={pid}
                rosterId={rid}
                lookup={playerLookup}
                rosterIdentities={rosterIdentities}
              />
            ))}
          </ul>
        </section>
      )}
      {waiverBudget.length > 0 && (
        <section aria-labelledby="faab-heading" className="sm:col-span-2">
          <h3
            id="faab-heading"
            className="text-xs font-semibold uppercase tracking-wider text-ink-muted"
          >
            FAAB transfer
          </h3>
          <ul className="mt-2 space-y-1" role="list">
            {waiverBudget.map((b, i) => (
              <li key={`faab-${i}`} className="text-sm text-ink">
                {labelFor(b.sender, rosterIdentities)} → {labelFor(b.receiver, rosterIdentities)} ·{" "}
                <span className="font-mono text-ink-muted">${b.amount}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {draftPicks.length > 0 && (
        <section aria-labelledby="picks-heading" className="sm:col-span-2">
          <h3
            id="picks-heading"
            className="text-xs font-semibold uppercase tracking-wider text-ink-muted"
          >
            Draft picks moved
          </h3>
          <ul className="mt-2 space-y-1" role="list">
            {draftPicks.map((raw, i) => {
              const p = (raw ?? {}) as Record<string, unknown>;
              const season = String(p.season ?? "?");
              const round = Number(p.round ?? 0);
              const label =
                typeof p.pick_label === "string" && p.pick_label
                  ? p.pick_label
                  : null;
              return (
                <li key={`pick-${i}`} className="text-sm text-ink">
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

function PlayerLine({
  pid,
  rosterId,
  lookup,
  rosterIdentities,
}: {
  pid: string;
  rosterId: number;
  lookup: Record<string, { name: string; position: string | null; team: string | null }>;
  rosterIdentities: Record<
    number,
    { teamName: string; ownerHandle: string | null; avatarId: string | null }
  >;
}) {
  const meta = lookup[pid] ?? { name: pid, position: null, team: null };
  const roster = rosterIdentities[rosterId];
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <div className="min-w-0">
        <span className="truncate text-ink">{meta.name}</span>
        {meta.position && (
          <span className="ml-1 text-xs text-ink-muted">{meta.position}</span>
        )}
        {meta.team && <span className="ml-1 text-xs text-ink-muted">· {meta.team}</span>}
      </div>
      {roster && (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted"
          aria-label={`via ${roster.teamName}`}
        >
          <SleeperAvatar
            avatarId={roster.avatarId}
            initial={roster.teamName.charAt(0)}
            title={roster.teamName}
            size={20}
          />
          <span className="truncate">{roster.teamName}</span>
        </span>
      )}
    </li>
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
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
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
