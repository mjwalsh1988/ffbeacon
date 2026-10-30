/**
 * Standing (plan 9.3). The overall grade lives in the letterhead's grade
 * box; this section is the reading of it: the Power Pulse status in words
 * with its reason, then the value archetype, the roster archetype and the
 * outlook as three labeled readouts. Every null renders its sentence.
 */

import type { BlueprintView } from "@/lib/league-blueprint/types";
import { SECONDARY_LABEL } from "./bits";
import { SheetSection } from "./sheet";

function Readout({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="min-w-0 border-t border-line pt-3">
      <dt className={SECONDARY_LABEL}>{label}</dt>
      <dd className="mt-1">
        <span className="block text-base font-bold text-ink">{value}</span>
        {note && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{note}</span>}
      </dd>
    </div>
  );
}

export function StandingPanel({ view, number }: { view: BlueprintView; number: string }) {
  const s = view.standing;
  return (
    <SheetSection id="bp-standing" number={number} title="Standing" helper="Where this team stands in its own league right now.">
      {s.status ? (
        <div>
          <p className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{s.status.label}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{s.status.reason}</p>
        </div>
      ) : (
        <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{s.standingNote}</p>
      )}
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <Readout
          label="Value archetype"
          value={s.valueArchetype ?? "Not computed yet"}
          note={s.valueArchetype ? null : s.standingNote}
        />
        <Readout label="Roster archetype" value={s.rosterArchetype} />
        <Readout
          label="Outlook"
          value={s.outlook ? s.outlook.text : view.header.isDynasty ? "Not computed yet" : "One season"}
          note={s.outlook ? s.outlook.reason : s.outlookNote}
        />
      </dl>
    </SheetSection>
  );
}
