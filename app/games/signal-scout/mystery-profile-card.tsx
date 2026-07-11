/**
 * Mystery profile card: the "unknown player" dossier anchor at the top of an
 * active Signal Scout round. Renders no round data at all, only the generic
 * silhouette and redaction bars standing in for the hidden name (plan
 * section 21). This is deliberate: nothing target-related may ever appear
 * here, pre-reveal or otherwise (see the anti-cheat note on ActiveRoundDto
 * in lib/signal-scout/round-engine.ts).
 */

import { UserRound } from "lucide-react";

export interface MysteryProfileCardProps {
  className?: string;
}

export function MysteryProfileCard({ className }: MysteryProfileCardProps) {
  return (
    <div className={`rounded-card border border-line bg-base/40 p-4 sm:p-5 ${className ?? ""}`}>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div
          aria-hidden="true"
          className="scout-scanline relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-surface sm:h-28 sm:w-28"
        >
          <UserRound className="h-14 w-14 text-ink-subtle sm:h-16 sm:w-16" />
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Classified scouting file
          </p>
          <h4 className="sr-only">Mystery player, identity classified</h4>
          <div aria-hidden="true" className="mt-2 flex flex-col gap-1.5">
            <span className="h-5 w-36 rounded bg-line/80" />
            <span className="h-5 w-24 rounded bg-line/80" />
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            Position unknown. Team unknown. Decode the clues below.
          </p>
        </div>
      </div>
    </div>
  );
}
