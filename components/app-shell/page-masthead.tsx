/**
 * PageMasthead: the header card that opens every page, so a tool, a ranking
 * board, an article index, and a league all announce themselves the same way.
 *
 * It is the League Pulse masthead generalised. Same anatomy: a small cyan
 * eyebrow naming the area, the page title set large and uppercase against the
 * beacon gradient, a plain sentence saying what the page is for, a row of
 * chips, and an optional strip of stat readouts on the right.
 *
 * The title is the page's h1. A page that renders this must not render a second
 * one; sub-sections step down to h2.
 *
 * Presentational server component. Every coloured element is paired with text,
 * so nothing here is colour-only, and the stat strip keeps every readout at
 * every width (two columns on a phone, four from sm up) rather than dropping
 * any of them on the small layout.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MastheadCard, MASTHEAD_TITLE_SIZE } from "./masthead-card";

export type MastheadStat = {
  label: string;
  value: string;
  /** One short line under the value, when the number needs context. */
  detail?: string;
  accent?: "cyan" | "purple" | "plain";
};

export type MastheadChip = {
  label: string;
  icon?: LucideIcon;
  tone?: "plain" | "cyan" | "purple" | "success" | "warning";
};

export function PageMasthead({
  eyebrow,
  title,
  description,
  chips = [],
  stats = [],
  actions,
  children,
  titleId = "page-masthead-title",
  headingLevel = "h1",
}: {
  /** The area this page belongs to, e.g. "Tools" or "The Beacon Brief". */
  eyebrow: string;
  title: string;
  description?: ReactNode;
  chips?: MastheadChip[];
  stats?: MastheadStat[];
  /** Buttons or links pinned to the masthead, under the description. */
  actions?: ReactNode;
  /** Anything extra that belongs inside the card, below everything else. */
  children?: ReactNode;
  titleId?: string;
  /** Drop to h2 only where the page's h1 is genuinely somewhere else. */
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;

  return (
    <MastheadCard labelledBy={titleId}>
      <div className="p-5 sm:p-6 lg:p-7">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-8">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-cyan">
              {eyebrow}
            </p>
            <Heading
              id={titleId}
              className={`beacon-page-title mt-2 ${MASTHEAD_TITLE_SIZE}`}
            >
              {title}
            </Heading>
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {chips.map((chip) => (
                  <Chip key={chip.label} {...chip} />
                ))}
              </div>
            )}
            {description && (
              <div className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
                {description}
              </div>
            )}
            {actions && <div className="mt-5 flex flex-wrap gap-3">{actions}</div>}
          </div>

          {stats.length > 0 && (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
              {stats.map((stat) => (
                <StatTile key={stat.label} {...stat} />
              ))}
            </dl>
          )}
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </MastheadCard>
  );
}

const CHIP_TONES: Record<NonNullable<MastheadChip["tone"]>, string> = {
  plain: "border-line text-ink-muted",
  cyan: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan",
  purple: "border-brand-purple/40 bg-brand-purple/10 text-brand-purple",
  success: "border-signal-success/40 bg-signal-success/10 text-signal-success",
  warning: "border-signal-warning/40 bg-signal-warning/10 text-signal-warning",
};

function Chip({ label, icon: Icon, tone = "plain" }: MastheadChip) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-base/50 px-2.5 py-1 text-xs font-semibold ${CHIP_TONES[tone]}`}
    >
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

const STAT_ACCENTS: Record<NonNullable<MastheadStat["accent"]>, string> = {
  cyan: "text-brand-cyan",
  purple: "text-brand-purple",
  plain: "text-ink",
};

function StatTile({ label, value, detail, accent = "plain" }: MastheadStat) {
  return (
    <div className="min-w-[6.5rem] rounded-card border border-line bg-base/60 px-3 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-xl font-bold tabular-nums ${STAT_ACCENTS[accent]}`}
      >
        {value}
      </dd>
      {detail && <p className="mt-0.5 text-[11px] leading-tight text-ink-subtle">{detail}</p>}
    </div>
  );
}
