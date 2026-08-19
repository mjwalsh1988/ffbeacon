/**
 * Mystery profile card: the classified dossier at the top of an active Signal
 * Scout round. Renders no round data at all, only the generic silhouette and
 * the redaction bars standing in for the hidden fields (plan section 21). This
 * is deliberate: nothing target-related may ever appear here, pre-reveal or
 * otherwise (see the anti-cheat note on ActiveRoundDto in
 * lib/signal-scout/round-engine.ts).
 *
 * It is drawn as an actual file rather than another panel in the stack: a
 * header strip with a CLASSIFIED stamp, the silhouette under a scanline, and
 * three labelled fields whose values are blacked out. Every redaction is
 * aria-hidden, and the one line a screen reader gets says the same thing the
 * blackout says to everyone else.
 */

import { Lock, UserRound } from "lucide-react";

export interface MysteryProfileCardProps {
  className?: string;
  /** id for the heading, referenced by the section's aria-labelledby. */
  headingId?: string;
}

/** The fields a scouting file would list, with the value withheld. Widths vary
 *  so the blackouts read as redacted text rather than as a progress bar. */
const REDACTED_FIELDS: { label: string; width: string }[] = [
  { label: "Name", width: "w-40 sm:w-52" },
  { label: "Position", width: "w-16" },
  { label: "Team", width: "w-24" },
];

export function MysteryProfileCard({
  className,
  headingId = "signal-scout-file-heading",
}: MysteryProfileCardProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={`relative overflow-hidden rounded-modal border-2 border-brand-cyan/35 bg-base/60 shadow-[0_0_80px_-46px_rgba(34,211,238,0.9)] ${className ?? ""}`}
    >
      {/* Header strip: what this document is, and that it is sealed. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-cyan/25 bg-surface/60 px-4 py-2.5">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-cyan">
          <Lock aria-hidden="true" className="h-3.5 w-3.5" />
          Scouting file
        </p>
        <span className="rounded-full border border-signal-warning/60 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-signal-warning">
          Classified
        </span>
      </div>

      <div className="flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <div
          aria-hidden="true"
          className="scout-scanline relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-card border border-brand-cyan/30 bg-surface sm:h-28 sm:w-28"
        >
          <UserRound className="h-14 w-14 text-ink-subtle sm:h-16 sm:w-16" />
        </div>

        <div className="min-w-0 flex-1">
          <h4 id={headingId} className="text-base font-semibold tracking-tight text-ink">
            Identity withheld
          </h4>

          <dl aria-hidden="true" className="mt-3 space-y-2">
            {REDACTED_FIELDS.map((field) => (
              <div key={field.label} className="flex items-center gap-3">
                <dt className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
                  {field.label}
                </dt>
                <dd
                  className={`h-4 rounded-sm bg-line/90 ${field.width}`}
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(244,244,248,0.06) 0px, rgba(244,244,248,0.06) 6px, transparent 6px, transparent 12px)",
                  }}
                />
              </div>
            ))}
          </dl>

          {/* The one line that carries the same meaning to a screen reader as
              three blacked-out fields carry to everyone else. */}
          <p className="mt-3 text-sm text-ink-muted">
            Name, position, and team are redacted. Buy signals to declassify them,
            then make the call.
          </p>
        </div>
      </div>
    </section>
  );
}
