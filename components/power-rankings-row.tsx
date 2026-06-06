"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SleeperAvatar } from "@/components/sleeper-avatar";

/**
 * One row of the Power Rankings table on the league overview.
 *
 * Desktop: shows Rank + Team (linked) + per-position rank columns (QB, RB,
 * WR, TE, Picks) + total team Value.
 *
 * Mobile (<md): only Rank + Team are visible; the per-position columns and
 * the Value column are hidden with `hidden md:table-cell`. The Team cell
 * becomes a tap target that opens a bottom-sheet modal listing the full
 * breakdown (record, total value, all position ranks) and a "View team"
 * button that links to the team's roster filter view. This satisfies the
 * mobile-first rule (no data hidden without being surfaced elsewhere).
 */

export type PowerRankingsRowData = {
  rosterRowId: string;
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  /** Overall rank from league_power_rankings_cache.overall_rank. Null when
   * the cache hasn't built yet for this (format, source). */
  overallRank: number | null;
  /** Per-position rank (1 = league-best). Null when the team has zero
   * combined value at that position or no cache row exists. */
  positionRanks: {
    QB: number | null;
    RB: number | null;
    WR: number | null;
    TE: number | null;
    PICKS: number | null;
  };
  record: { wins: number; losses: number; ties: number };
  /** Total value of all assets on the team (starters + bench + picks) from
   * league_power_rankings_cache.total_value. Null when no cache row exists. */
  totalValue: number | null;
};

export function PowerRankingsRow({
  data,
  teamCount,
  sleeperLeagueId,
  searchedUsername = null,
}: {
  data: PowerRankingsRowData;
  teamCount: number;
  sleeperLeagueId: string;
  /** Forwarded from `?username=` so the team link keeps the in-view league
   * switcher alive when it lands back on the main deep view. */
  searchedUsername?: string | null;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const teamHref = (() => {
    const qs = new URLSearchParams({
      tab: "teams",
      roster: String(data.sleeperRosterId),
    });
    if (searchedUsername) qs.set("username", searchedUsername);
    return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
  })();

  return (
    <>
      <tr className="hover:bg-surface">
        <td className="w-px whitespace-nowrap px-2 py-2 text-center font-mono tabular-nums text-ink-muted">
          {data.overallRank ?? "—"}
        </td>
        <td className="px-3 py-2">
          {/* Mobile: tap-to-open-sheet. Desktop: direct link. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label={`Open details for ${data.teamName}`}
            className="flex w-full min-h-11 items-center gap-3 text-left transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:hidden"
          >
            <TeamIdentity data={data} />
            <ChevronRight className="ml-auto h-4 w-4 text-ink-subtle" />
          </button>
          <Link
            href={teamHref}
            aria-label={`Open ${data.teamName} on the Teams tab. Chip filter will show only this team.`}
            className="hidden items-center gap-3 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:flex"
          >
            <TeamIdentity data={data} />
          </Link>
        </td>
        <PositionRankCell rank={data.positionRanks.QB} teamCount={teamCount} />
        <PositionRankCell rank={data.positionRanks.RB} teamCount={teamCount} />
        <PositionRankCell rank={data.positionRanks.WR} teamCount={teamCount} />
        <PositionRankCell rank={data.positionRanks.TE} teamCount={teamCount} />
        <PositionRankCell rank={data.positionRanks.PICKS} teamCount={teamCount} />
        <td
          className="hidden px-4 py-2 text-right font-mono font-semibold tabular-nums text-ink md:table-cell"
          aria-label={`Total value ${formatValue(data.totalValue)}`}
        >
          {formatValue(data.totalValue)}
        </td>
      </tr>
      {sheetOpen && (
        <TeamRankSheet
          data={data}
          teamCount={teamCount}
          teamHref={teamHref}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

function TeamIdentity({ data }: { data: PowerRankingsRowData }) {
  return (
    <>
      <SleeperAvatar
        avatarId={data.ownerAvatarId}
        initial={data.teamName.charAt(0)}
        title={data.teamName}
        size={36}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {data.teamName}
        </span>
        {data.ownerHandle && (
          <span className="block truncate text-[11px] text-ink-subtle">
            @{data.ownerHandle}
          </span>
        )}
      </span>
    </>
  );
}

function PositionRankCell({
  rank,
  teamCount,
}: {
  rank: number | null;
  teamCount: number;
}) {
  const tier = rankTier(rank, teamCount);
  const style =
    tier === "top"
      ? { color: "#22D3EE" }
      : tier === "bottom"
        ? { color: "#A855F7" }
        : { color: "#F4F4F8" };
  const ariaTier =
    tier === "top" ? " (top three)" : tier === "bottom" ? " (bottom three)" : "";
  const label = rank != null ? rankOrdinal(rank) : "—";
  return (
    <td
      className="hidden px-3 py-2 text-center font-mono font-semibold tabular-nums md:table-cell"
      style={style}
      aria-label={`Rank ${label}${ariaTier}`}
    >
      {label}
    </td>
  );
}

function TeamRankSheet({
  data,
  teamCount,
  teamHref,
  onClose,
}: {
  data: PowerRankingsRowData;
  teamCount: number;
  teamHref: string;
  onClose: () => void;
}) {
  const labelId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  // Two-phase open so the panel slides up from below instead of popping in.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && sheetRef.current) {
        const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  if (!mounted) return null;

  const record = `${data.record.wins}-${data.record.losses}${data.record.ties ? `-${data.record.ties}` : ""}`;

  const portal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      className="fixed inset-0 z-50 flex items-end justify-center md:hidden"
    >
      <button
        type="button"
        aria-label="Close team details"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 transition-opacity duration-200 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={sheetRef}
        className={`relative w-full max-w-2xl rounded-t-modal border-x border-t border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out ${
          entered ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          // Reserve space for the iOS home indicator / Android gesture bar.
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Beacon gradient indicator / drag handle. */}
        <div className="flex justify-center pt-2">
          <span
            aria-hidden="true"
            className="h-1.5 w-12 rounded-full bg-beacon opacity-60"
          />
        </div>

        <header className="flex items-start gap-3 px-5 pt-4">
          <SleeperAvatar
            avatarId={data.ownerAvatarId}
            initial={data.teamName.charAt(0)}
            title={data.teamName}
            size={48}
          />
          <div className="min-w-0 flex-1">
            <h2
              id={labelId}
              className="truncate text-lg font-semibold tracking-tight text-ink"
            >
              {data.teamName}
            </h2>
            {data.ownerHandle && (
              <p className="truncate text-xs text-ink-subtle">@{data.ownerHandle}</p>
            )}
            <p className="mt-1 font-mono text-xs tabular-nums text-ink-muted">
              Record {record}
              {data.overallRank != null && (
                <>
                  {" · "}
                  <span className="text-ink">
                    {rankOrdinal(data.overallRank)} overall
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close team details"
            className="-mr-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div
          className="mx-5 mt-4 flex items-center justify-between rounded-card border border-line bg-base px-4 py-3"
          aria-label={`Total team value ${formatValue(data.totalValue)}`}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            Total value
          </span>
          <span className="font-mono text-xl font-extrabold tabular-nums text-brand-cyan">
            {formatValue(data.totalValue)}
          </span>
        </div>

        <section
          aria-label="Position ranks"
          className="grid grid-cols-3 gap-2 px-5 pt-5"
        >
          <RankTile label="QB" rank={data.positionRanks.QB} teamCount={teamCount} />
          <RankTile label="RB" rank={data.positionRanks.RB} teamCount={teamCount} />
          <RankTile label="WR" rank={data.positionRanks.WR} teamCount={teamCount} />
          <RankTile label="TE" rank={data.positionRanks.TE} teamCount={teamCount} />
          <RankTile
            label="Picks"
            rank={data.positionRanks.PICKS}
            teamCount={teamCount}
          />
          <RankTile
            label="Overall"
            rank={data.overallRank}
            teamCount={teamCount}
            emphasize
          />
        </section>

        <div className="mt-5 flex flex-col gap-2 px-5">
          <Link
            href={teamHref}
            className="inline-flex min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            onClick={onClose}
          >
            View team →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}

function RankTile({
  label,
  rank,
  teamCount,
  emphasize = false,
}: {
  label: string;
  rank: number | null;
  teamCount: number;
  emphasize?: boolean;
}) {
  const tier = rankTier(rank, teamCount);
  const accent =
    tier === "top"
      ? { color: "#22D3EE", border: "rgba(34, 211, 238, 0.55)", glow: "rgba(34, 211, 238, 0.10)" }
      : tier === "bottom"
        ? { color: "#A855F7", border: "rgba(168, 85, 247, 0.55)", glow: "rgba(168, 85, 247, 0.10)" }
        : { color: "#F4F4F8", border: "#1F1F33", glow: "transparent" };
  const labelText = rank != null ? rankOrdinal(rank) : "—";
  const ariaTier =
    tier === "top"
      ? " (top three in league)"
      : tier === "bottom"
        ? " (bottom three in league)"
        : "";
  return (
    <div
      className={`flex flex-col items-center gap-0.5 rounded-card border px-2 py-3 text-center ${
        emphasize ? "shadow-[0_0_24px_-12px_rgba(34,211,238,0.6)]" : ""
      }`}
      style={{ borderColor: accent.border, backgroundColor: accent.glow }}
      aria-label={`${label} rank ${labelText}${ariaTier}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
        {label}
      </span>
      <span
        className="font-mono text-lg font-extrabold tabular-nums leading-none"
        style={{ color: accent.color }}
      >
        {labelText}
      </span>
      {teamCount > 0 && (
        <span className="text-[9px] tabular-nums text-ink-subtle">
          of {teamCount}
        </span>
      )}
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function rankTier(
  rank: number | null,
  teamCount: number,
): "top" | "bottom" | "mid" | "unknown" {
  if (rank == null || teamCount === 0) return "unknown";
  if (rank <= 3) return "top";
  if (rank > teamCount - 3) return "bottom";
  return "mid";
}

function formatValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(0);
}

function rankOrdinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}
