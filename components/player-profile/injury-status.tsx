/**
 * Injury report card (overview). Surfaces everything Sleeper gives us about a
 * player's injury: status, body part, practice participation, start date, and
 * the free-text note. Tone (amber vs red vs green) tracks the severity of the
 * status. Returns null when the player has no injury_status, so the parent
 * simply omits the whole section rather than showing an empty card. Server
 * component.
 */

import { HeartPulse } from "lucide-react";
import { sleeperMeta, type PlayerRow } from "@/lib/player-profile";

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sleeper injury_start_date is a plain YYYY-MM-DD; format it with no timezone
 *  math (a bare date has no zone) and fall back to the raw string otherwise. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parts = value.slice(0, 10).split("-").map((p) => parseInt(p, 10));
  if (parts.length === 3 && parts.every((p) => Number.isFinite(p))) {
    const [y, m, d] = parts;
    if (m >= 1 && m <= 12) return `${MONTHS[m - 1]} ${d}, ${y}`;
  }
  return value;
}

type Tone = "danger" | "warning" | "success";

function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (["out", "ir", "pup", "nfi", "doubtful", "suspend", "reserve"].some((k) => s.includes(k))) {
    return "danger";
  }
  if (["probable", "active", "full", "cleared"].some((k) => s.includes(k))) return "success";
  return "warning";
}

const TONE: Record<
  Tone,
  { border: string; glow: string; badge: string; icon: string }
> = {
  danger: {
    border: "border-signal-danger/40",
    glow: "0 0 80px -52px rgba(239, 68, 68, 0.6)",
    badge: "bg-signal-danger/15 text-signal-danger",
    icon: "border-signal-danger/50 text-signal-danger",
  },
  warning: {
    border: "border-signal-warning/40",
    glow: "0 0 80px -52px rgba(245, 158, 11, 0.55)",
    badge: "bg-signal-warning/15 text-signal-warning",
    icon: "border-signal-warning/50 text-signal-warning",
  },
  success: {
    border: "border-signal-success/40",
    glow: "0 0 80px -52px rgba(16, 185, 129, 0.5)",
    badge: "bg-signal-success/15 text-signal-success",
    icon: "border-signal-success/50 text-signal-success",
  },
};

export function InjuryStatus({ player, playerName }: { player: PlayerRow; playerName: string }) {
  const meta = sleeperMeta(player);
  const status = str(meta.injury_status);
  if (!status) return null;

  const bodyPart = str(meta.injury_body_part);
  const practice = str(meta.practice_participation);
  const practiceDesc = str(meta.practice_description);
  const since = formatDate(str(meta.injury_start_date));
  const notes = str(meta.injury_notes);

  const tone = TONE[statusTone(status)];

  const facts: { label: string; value: string }[] = [
    ...(bodyPart ? [{ label: "Injury", value: bodyPart }] : []),
    ...(practice
      ? [{ label: "Practice", value: practiceDesc ? `${practice} (${practiceDesc})` : practice }]
      : []),
    ...(since ? [{ label: "Since", value: since }] : []),
  ];

  return (
    <section
      aria-labelledby="injury-title"
      className={`relative overflow-hidden rounded-modal border ${tone.border} bg-surface/60 p-5`}
      style={{ boxShadow: tone.glow }}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card border bg-base ${tone.icon}`}
        >
          <HeartPulse className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              id="injury-title"
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle"
            >
              Injury report
              <span className="sr-only"> for {playerName}</span>
            </p>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone.badge}`}
            >
              {status}
            </span>
          </div>

          {facts.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {facts.map((f) => (
                <div key={f.label} className="rounded-card border border-line bg-base/50 px-3 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                    {f.label}
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {notes && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{notes}</p>}
        </div>
      </div>
    </section>
  );
}
