/**
 * Burned Out banner: a persistent strip shown once activeRound.burned is
 * true (plan sections 13, 21, 26). role="alert" announces once on mount;
 * the caller (signal-scout-client.tsx) is responsible for only rendering
 * this component while the round is burned, and does not add any extra
 * announce() call for it.
 */

import { Flame } from "lucide-react";

export function BurnedBanner() {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3"
    >
      <Flame aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-danger" />
      <p className="text-sm">
        <span className="font-bold text-signal-danger">Signal burned out.</span>{" "}
        <span className="text-ink-muted">
          You can still name the player, but this round can no longer score. Hints are locked.
        </span>
      </p>
    </div>
  );
}
