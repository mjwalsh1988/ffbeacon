"use client";

/**
 * Draft Command Bar: the control bar of the room. Visually prominent and built
 * like a broadcast control strip (it scrolls with the page, not pinned). Shows
 * league identity + status, a bold "on the clock" banner, format/values/pool
 * chips, the user's seat, and the Sync control.
 *
 * The player pool is INFERRED from the league and draft (no manual toggle): the
 * pool chip states what the room is showing, and the one-time PoolNotice modal
 * explains why. In snapshot mode (a completed draft rendered from its finalized
 * snapshot) the Sync control is replaced by a "results locked" note, because
 * nothing about a finished draft can change.
 *
 * Carries the ASSERTIVE "your turn" live region (sr-only role=alert); the polite
 * sync channel lives in the SyncButton. The on-the-clock pulse is decorative and
 * reduced-motion-safe.
 */

import { Users, Baby, Lock, Eye } from "lucide-react";
import { MASTHEAD_TITLE_SIZE } from "@/components/app-shell/masthead-card";
import type { ShapedDraftCache, PlayerPool } from "@/lib/on-the-clock/types";
import { SyncButton } from "./sync-button";

function Chip({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        accent ? "border-brand-cyan/40" : "border-line"
      }`}
    >
      <span className="text-ink-subtle">{label}</span>
      <span className={accent ? "font-semibold text-brand-cyan" : "text-ink"}>{value}</span>
    </span>
  );
}

export function CommandHeader({
  leagueName,
  viewLabel,
  draft,
  formatLabel,
  formatIsClosest,
  pool,
  onTheClockTeam,
  onTheClockPickLabel,
  isYourTurn,
  yourSeatLabel,
  sync,
  snapshotNotice = null,
}: {
  leagueName: string;
  /**
   * The view showing right now. It is named here because the switcher moved to
   * the site rail, which is collapsed to icons by default and hidden entirely
   * below lg, so without this there is nothing on the page that says which of
   * the eight views you are looking at.
   */
  viewLabel: string;
  draft: ShapedDraftCache["draft"];
  /** Auto-detected FF Beacon format label (locked; no selector). */
  formatLabel: string;
  /** True when a closest FF Beacon format was used (helper copy nuance). */
  formatIsClosest: boolean;
  /** Inferred player pool (no manual toggle; see PoolNotice for the why). */
  pool: PlayerPool;
  onTheClockTeam: string;
  onTheClockPickLabel: string;
  isYourTurn: boolean;
  yourSeatLabel: string;
  /** Controlled sync state, owned by the room. Null in snapshot mode. */
  sync: {
    syncing: boolean;
    cooldownRemaining: number;
    statusMessage: string;
    onSync: () => void;
  } | null;
  /**
   * Snapshot mode note (e.g. "Final results. Values locked as of ..."). When
   * set, the Sync control is hidden and this renders in its place.
   */
  snapshotNotice?: string | null;
}) {
  const snapshotMode = snapshotNotice !== null;
  const statusWord = snapshotMode
    ? "Draft complete"
    : draft.draftStatus === "drafting"
      ? "Drafting"
      : draft.draftStatus ?? "Unknown";
  const PoolIcon = pool === "rookies" ? Baby : Users;

  return (
    <div className="border-b border-line bg-base/95 backdrop-blur supports-[backdrop-filter]:bg-base/80">
      {/* Decorative beacon hairline along the top edge. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 25%, #22D3EE 75%, transparent 100%)",
        }}
      />

      {/* Assertive channel: only the "your turn" alert speaks here. */}
      <div role="alert" aria-live="assertive" className="sr-only">
        {isYourTurn ? "You are now on the clock." : ""}
      </div>

      {/* Gutters match the room's body below (px-4 sm:px-6) rather than capping
          at max-w-7xl. The room is the widest column on the site, and the page
          title sitting in here has to line up with the content under it. */}
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-cyan">
              On The Clock
            </p>
            {/* The page title, once you are inside a room. The hero above this
                is not rendered here (see app/tools/on-the-clock/page.tsx), so
                the league name is the h1 and takes the same treatment every
                other page title on the site gets. */}
            <h1
              className={`beacon-page-title mt-2 ${MASTHEAD_TITLE_SIZE}`}
            >
              {leagueName}
            </h1>
            <p className="mt-2 text-xs text-ink-muted">
              <span className="font-semibold text-ink">{statusWord}</span>
              <span className="mr-1.5 text-ink-subtle">,</span>
              <span>{yourSeatLabel}</span>
            </p>
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-1 text-xs font-semibold text-brand-cyan">
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">Showing view: </span>
              {viewLabel}
            </p>
          </div>

          {sync && !snapshotMode ? (
            <SyncButton
              syncing={sync.syncing}
              cooldownRemaining={sync.cooldownRemaining}
              statusMessage={sync.statusMessage}
              onSync={sync.onSync}
            />
          ) : null}
        </div>

        {/* On-the-clock banner (broadcast strip), or the snapshot lock note. */}
        {snapshotMode ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-card border border-brand-purple/40 bg-brand-purple/10 px-3 py-2">
            <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-purple" />
            <p className="text-sm text-ink">
              <span className="font-semibold">Final results.</span>{" "}
              <span className="text-ink-muted">{snapshotNotice}</span>
            </p>
          </div>
        ) : (
          <div
            className={`mt-3 flex items-center gap-2.5 rounded-card border px-3 py-2 ${
              isYourTurn ? "border-brand-cyan/60 bg-brand-cyan/10" : "border-line bg-surface/50"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                isYourTurn ? "bg-brand-cyan" : "bg-brand-purple"
              } animate-pulse motion-reduce:animate-none`}
            />
            <p className="text-sm">
              {isYourTurn ? (
                <span className="font-bold text-brand-cyan">You are on the clock. Make your pick.</span>
              ) : (
                <>
                  <span className="font-semibold text-ink">On the clock:</span>{" "}
                  <span className="text-ink-muted">
                    {onTheClockTeam} ({onTheClockPickLabel})
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {/* Locked status chips (no selectors): format is auto-detected from the
            Sleeper league; values always come from FF Beacon; the pool is
            inferred from the league type + draft rounds. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Chip label="Format" value={formatLabel} accent />
          <Chip label="Values" value="FF Beacon" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium">
            <PoolIcon aria-hidden="true" className="h-3.5 w-3.5 text-ink-subtle" />
            <span className="text-ink-subtle">Pool</span>
            <span className="text-ink">{pool === "rookies" ? "Rookies only" : "All players"}</span>
          </span>
        </div>

        {/* Helper: where the locked format/values/pool come from. */}
        <p className="mt-1.5 text-[11px] text-ink-subtle">
          Format and player pool detected from your Sleeper league. Values always come from FF
          Beacon.
          {formatIsClosest ? " Closest FF Beacon format used for this league." : ""}
        </p>
      </div>
    </div>
  );
}
