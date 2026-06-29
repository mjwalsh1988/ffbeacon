"use client";

/**
 * Draft Command Bar: the control bar of the room. Visually prominent and built
 * like a broadcast control strip (it scrolls with the page, not pinned). Shows
 * league identity + status, a bold
 * "on the clock" banner, format/source chips, the player-pool toggle, the user's
 * seat, and the Sync control. Always visible at every breakpoint (counts live in
 * the Room status panel, so nothing critical hides on mobile).
 *
 * Carries the ASSERTIVE "your turn" live region (sr-only role=alert); the polite
 * sync channel lives in the SyncButton. The on-the-clock pulse is decorative and
 * reduced-motion-safe.
 */

import { Users, Baby } from "lucide-react";
import type { ShapedDraftCache, PlayerPool } from "@/lib/on-the-clock/types";
import { SyncButton } from "./sync-button";

const POOL_OPTIONS: Array<{ id: PlayerPool; label: string; hint: string; icon: typeof Users }> = [
  { id: "everyone", label: "Everyone", hint: "All ranked players", icon: Users },
  { id: "rookies", label: "Rookies only", hint: "This year's class", icon: Baby },
];

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
  draft,
  formatLabel,
  formatIsClosest,
  pool,
  onPoolChange,
  onTheClockTeam,
  onTheClockPickLabel,
  isYourTurn,
  yourSeatLabel,
  sync,
}: {
  leagueName: string;
  draft: ShapedDraftCache["draft"];
  /** Auto-detected FF Beacon format label (locked; no selector). */
  formatLabel: string;
  /** True when a closest FF Beacon format was used (helper copy nuance). */
  formatIsClosest: boolean;
  pool: PlayerPool;
  onPoolChange: (pool: PlayerPool) => void;
  onTheClockTeam: string;
  onTheClockPickLabel: string;
  isYourTurn: boolean;
  yourSeatLabel: string;
  /** Controlled sync state, owned by the room (real POST /draft/sync). */
  sync: {
    syncing: boolean;
    cooldownRemaining: number;
    statusMessage: string;
    onSync: () => void;
  };
}) {
  const statusWord = draft.draftStatus === "drafting" ? "Drafting" : draft.draftStatus ?? "Unknown";

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

      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-cyan">
              On The Clock
            </p>
            <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-ink sm:text-xl">
              {leagueName}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              <span className="font-semibold text-ink">{statusWord}</span>
              <span className="mx-1.5 text-ink-subtle">·</span>
              <span>{yourSeatLabel}</span>
            </p>
          </div>

          <SyncButton
            syncing={sync.syncing}
            cooldownRemaining={sync.cooldownRemaining}
            statusMessage={sync.statusMessage}
            onSync={sync.onSync}
          />
        </div>

        {/* On-the-clock banner (broadcast strip). */}
        <div
          className={`mt-3 flex items-center gap-2.5 rounded-card border px-3 py-2 ${
            isYourTurn
              ? "border-brand-cyan/60 bg-brand-cyan/10"
              : "border-line bg-surface/50"
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

        {/* Locked status chips (no selectors): format is auto-detected from the
            Sleeper league; values always come from FF Beacon. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Chip label="Format" value={formatLabel} accent />
          <Chip label="Values" value="FF Beacon" />

          <div role="group" aria-label="Player pool" className="ml-auto flex gap-2">
            {POOL_OPTIONS.map(({ id, label, hint, icon: Icon }) => {
              const active = pool === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPoolChange(id)}
                  className={`flex min-h-11 items-center gap-2 rounded-card border px-3 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    active
                      ? "border-brand-cyan/60 bg-brand-cyan/10"
                      : "border-line bg-base hover:border-line-accent"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-card border ${
                      active ? "border-brand-cyan/50 text-brand-cyan" : "border-line text-ink-subtle"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="leading-tight">
                    <span
                      className={`block text-xs font-semibold ${active ? "text-brand-cyan" : "text-ink"}`}
                    >
                      {label}
                    </span>
                    <span className="block text-[10px] text-ink-subtle">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Helper: where the locked format/values come from. */}
        <p className="mt-1.5 text-[11px] text-ink-subtle">
          Format detected from your Sleeper league. Values always come from FF Beacon.
          {formatIsClosest ? " Closest FF Beacon format used for this league." : ""}
        </p>
      </div>
    </div>
  );
}
