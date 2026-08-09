"use client";

/**
 * "Which side does this go on?"
 *
 * Opened by clicking a cell on the draft board while the trade builder is open.
 * It shows what that slot actually resolves to before anything is added, because
 * a slot is not an asset until you know who is in it: a made pick is the player
 * taken, and an unmade one is whoever the market would take there.
 *
 * The sides are labelled with real team names rather than A and B. In a draft
 * room "Side A" is meaningless until you remember which side you assigned
 * yourself to, and a three-way conversation about picks makes it worse.
 *
 * Focus: the dialog traps focus while open, Escape closes, and focus returns to
 * the board cell that opened it, so a keyboard user lands back where they were
 * instead of at the top of a 200-cell table.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ResolvedAsset } from "@/lib/on-the-clock/trade-assets";

export function AddAssetDialog({
  open,
  asset,
  sideALabel,
  sideBLabel,
  onPick,
  onClose,
}: {
  open: boolean;
  asset: ResolvedAsset | null;
  sideALabel: string;
  sideBLabel: string;
  onPick: (side: "a" | "b") => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // The side buttons are not rendered when the asset cannot be priced, so
    // focusing them would be a no-op and focus would stay on the board cell
    // BEHIND the overlay. The Tab handler below only wraps when focus is already
    // inside, so that would also leak the trap straight out into the page.
    const target = firstButtonRef.current ?? closeButtonRef.current ?? dialogRef.current;
    target?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open || !asset) return null;

  const unresolvable = asset.signalCheck === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      // Clicking the backdrop closes, matching the rest of the site's dialogs.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        // Focusable as a last resort, so the trap always has somewhere to land.
        tabIndex={-1}
        aria-labelledby="otc-add-asset-title"
        aria-describedby="otc-add-asset-desc"
        className="relative w-full max-w-md overflow-hidden rounded-modal border border-brand-purple/40 bg-surface p-5"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 50% -15%, rgba(168, 85, 247, 0.18) 0%, transparent 60%)",
        }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              Add to trade
            </p>
            <h2 id="otc-add-asset-title" className="mt-0.5 text-lg font-bold tracking-tight text-ink">
              {asset.label}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close without adding anything"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <p id="otc-add-asset-desc" className="mt-2 text-sm text-ink-muted">
          {asset.detail}
        </p>

        {asset.simulated && (
          <p className="mt-3 rounded-card border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            This pick has not been made yet, so we are treating it as the player Sleeper ADP says
            would go there. The report will say which assets were estimated this way.
          </p>
        )}

        {unresolvable ? (
          <p className="mt-4 rounded-card border border-line bg-base/50 px-3 py-2 text-sm text-ink-muted">
            We cannot price this slot. There is no FF Beacon value for the player behind it, so
            adding it would leave a hole in the totals rather than a number.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm">
              <span className="text-ink-subtle">FF Beacon value: </span>
              <span className="font-mono font-bold tabular-nums text-brand-purple">
                {asset.value.toLocaleString()}
              </span>
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                ref={firstButtonRef}
                type="button"
                onClick={() => onPick("a")}
                className="inline-flex min-h-11 items-center justify-center rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-3 py-2 text-sm font-semibold text-brand-cyan hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Add to {sideALabel}
              </button>
              <button
                type="button"
                onClick={() => onPick("b")}
                className="inline-flex min-h-11 items-center justify-center rounded-card border border-brand-purple/50 bg-brand-purple/10 px-3 py-2 text-sm font-semibold text-brand-purple hover:bg-brand-purple/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Add to {sideBLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
