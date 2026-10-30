/**
 * Standing (plan 9.3). The one hero figure is the overall grade; beside it the
 * Power Pulse status in words, then three secondary readouts: value
 * archetype, roster archetype, outlook. Every null renders its sentence.
 */

import { Panel } from "@/components/dashboard-panel";
import { StatTile } from "@/components/manager-pulse/stat-tile";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { SECONDARY_LABEL } from "./bits";

function Readout({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-card border border-line bg-base/40 px-3 py-2.5">
      <dt className={SECONDARY_LABEL}>{label}</dt>
      <dd className="mt-1">
        <span className="block text-base font-bold text-ink">{value}</span>
        {note && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{note}</span>}
      </dd>
    </div>
  );
}

export function StandingPanel({ view }: { view: BlueprintView }) {
  const s = view.standing;
  return (
    <Panel id="bp-standing" eyebrow="Where this team stands" title="Standing" glow>
      <div className="grid items-start gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="sm:w-48">
          <StatTile label="Overall grade" value={s.overall.toFixed(1)} sub="of 10" size="hero" />
        </div>
        <div className="min-w-0 space-y-3">
          {s.status ? (
            <div>
              <p className="text-lg font-bold text-ink">{s.status.label}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{s.status.reason}</p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-ink-muted">{s.standingNote}</p>
          )}
          <dl className="grid gap-2 sm:grid-cols-3">
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
        </div>
      </div>
    </Panel>
  );
}
