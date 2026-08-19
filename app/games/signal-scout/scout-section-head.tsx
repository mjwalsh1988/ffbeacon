/**
 * The header every section of an active Signal Scout round opens with: an icon
 * chip, a small eyebrow naming the kind of section, and the title.
 *
 * The round used to be a stack of bare bold sentences ("Buy a hint", "Bad
 * Reads", "Make the call") at the same size as the body text around them, which
 * left no seams between one job and the next. One header shape for all of them
 * gives the round a rhythm, and the tone tells you at a glance whether a section
 * is something you read (cyan), something you spend on (purple), or something
 * that went wrong (danger).
 *
 * Presentational server component.
 */

import type { LucideIcon } from "lucide-react";

const TONES = {
  cyan: {
    chip: "border-brand-cyan/40 text-brand-cyan",
    eyebrow: "text-brand-cyan",
  },
  purple: {
    chip: "border-brand-purple/50 text-brand-purple",
    eyebrow: "text-brand-purple",
  },
  danger: {
    chip: "border-signal-danger/50 text-signal-danger",
    eyebrow: "text-signal-danger",
  },
} as const;

export function ScoutSectionHead({
  icon: Icon,
  eyebrow,
  title,
  id,
  tone = "cyan",
  action,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  /** id for the heading, referenced by the section's aria-labelledby. */
  id: string;
  tone?: keyof typeof TONES;
  /** Anything pinned to the right of the header, such as a count. */
  action?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border bg-base ${t.chip}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${t.eyebrow}`}
        >
          {eyebrow}
        </p>
        <h4 id={id} className="text-sm font-semibold tracking-tight text-ink sm:text-base">
          {title}
        </h4>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
