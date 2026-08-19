/**
 * Bad Reads: the list of players the current round has already ruled out
 * via a wrong guess (ActiveRoundDto.badReads). Presentational only. Renders
 * nothing when the round has no bad reads yet so the active panel does not
 * show an empty section heading before the first wrong guess.
 */

import { X, OctagonX } from "lucide-react";
import type { BadRead } from "@/lib/signal-scout/round-engine";
import { ScoutSectionHead } from "./scout-section-head";

export interface BadReadsProps {
  badReads: BadRead[];
}

export function BadReads({ badReads }: BadReadsProps) {
  if (badReads.length === 0) return null;

  return (
    <section aria-labelledby="bad-reads-heading" className="mt-6">
      <ScoutSectionHead
        icon={OctagonX}
        eyebrow="Ruled out"
        title="Bad Reads"
        id="bad-reads-heading"
        tone="danger"
      />
      <ul role="list" className="mt-4 flex flex-wrap gap-2">
        {badReads.map((br) => (
          <li
            key={br.playerId}
            aria-label={`Ruled out: ${br.name} (${br.position}${br.team ? ", " + br.team : ""})`}
            className="flex items-center gap-1.5 rounded-full border border-signal-danger/40 bg-signal-danger/10 px-3 py-1 text-sm text-ink"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-signal-danger" />
            <span aria-hidden="true">
              {br.name} ({br.position}
              {br.team ? ", " + br.team : ""})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
