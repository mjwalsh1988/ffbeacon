/**
 * The building blocks of the waiver wire playbook: the lesson card, the key
 * idea callout, the "try it" prompt, and the icon tile grid that replaces a
 * bulleted list wherever the list is really four or five parallel ideas.
 *
 * WHY CARDS AND TILES. The lessons used to be a narrow column of headings and
 * paragraphs under a full-width board, so the page changed width halfway down
 * and then became an unbroken run of text. Each lesson is now a card at the
 * board's own width, opened by a numbered icon badge, and the parallel lists
 * are tiles a reader can take in at a glance. The words are unchanged; the
 * reading line inside each card is still held to a comfortable measure.
 *
 * Every icon here is decoration beside a heading or a label that says the same
 * thing, so each one is aria-hidden.
 *
 * Presentational server components.
 */

import Link from "next/link";
import { ArrowRight, Lightbulb, type LucideIcon } from "lucide-react";

const TONE = {
  cyan: { hex: "#22D3EE", text: "text-brand-cyan", soft: "bg-brand-cyan/10" },
  purple: { hex: "#A855F7", text: "text-brand-purple", soft: "bg-brand-purple/15" },
} as const;

export type Tone = keyof typeof TONE;

/**
 * One lesson. The section carries the anchor the contents nav points at; the
 * heading carries the accessible name.
 */
export function LessonCard({
  id,
  headingId,
  number,
  total,
  heading,
  takeaway,
  icon: Icon,
  tone = "cyan",
  children,
}: {
  id: string;
  headingId: string;
  number: number;
  total: number;
  heading: string;
  takeaway: string;
  icon: LucideIcon;
  tone?: Tone;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="relative scroll-mt-32 overflow-hidden rounded-3xl border border-line bg-surface/40 p-4 sm:p-7 xl:scroll-mt-28"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: `linear-gradient(90deg, ${t.hex} 0%, ${t.hex}40 40%, transparent 100%)`,
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-[0.12] blur-3xl"
        style={{ background: t.hex }}
      />

      <div className="relative flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-14 sm:w-14"
          style={{
            backgroundImage: `linear-gradient(140deg, ${t.hex}40 0%, ${t.hex}10 100%)`,
            boxShadow: `inset 0 0 0 1px ${t.hex}55`,
          }}
        >
          <Icon className={`h-5 w-5 sm:h-6 sm:w-6 ${t.text}`} />
          <span className="absolute -bottom-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-base bg-surface-elevated px-1 font-mono text-[10px] font-bold text-ink">
            {number}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${t.text}`}>
            Lesson {number} of {total}
          </p>
          <h2
            id={headingId}
            className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-[26px] sm:leading-tight"
          >
            {heading}
          </h2>
          <p className="mt-1.5 inline-flex rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-xs font-medium text-ink-muted">
            {takeaway}
          </p>
        </div>
      </div>

      <div className="relative mt-5 text-[15px] sm:text-base">{children}</div>
    </section>
  );
}

/** A paragraph at a readable measure, even inside a full-width card. */
export function Para({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-3xl leading-relaxed text-ink-muted first:mt-0">{children}</p>;
}

/** The one sentence a lesson exists to leave behind. */
export function KeyIdea({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-6 rounded-2xl p-px"
      style={{ backgroundImage: "linear-gradient(120deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="flex gap-3 rounded-[calc(1rem-1px)] bg-[#12121F] p-4 sm:p-5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-purple/15 text-brand-purple"
        >
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
            Key idea
          </p>
          <p className="mt-1 text-[15px] font-medium leading-relaxed text-ink sm:text-base">
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}

/** A prompt to go and do the lesson with a real tool. */
export function TryIt({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-brand-cyan/30 bg-brand-cyan/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="text-sm leading-relaxed text-ink-muted">
        <span className="font-semibold text-brand-cyan">Try it. </span>
        {children}
      </p>
      <Link
        href={href}
        className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
      >
        {label}
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export type Tile = {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
  tone?: Tone | "success" | "danger" | "amber";
};

const TILE_TONE: Record<NonNullable<Tile["tone"]>, string> = {
  cyan: "bg-brand-cyan/10 text-brand-cyan",
  purple: "bg-brand-purple/15 text-brand-purple",
  success: "bg-signal-success/10 text-signal-success",
  danger: "bg-signal-danger/10 text-signal-danger",
  amber: "bg-position-te/10 text-position-te",
};

/**
 * Parallel ideas as tiles: an icon, a short title, a sentence or two. A real
 * list, so a screen reader hears how many there are. `numbered` adds a step
 * number for sequences where the order matters.
 */
export function TileGrid({
  tiles,
  columns = "sm:grid-cols-2",
  numbered = false,
  headingLevel = 3,
}: {
  tiles: Tile[];
  columns?: string;
  numbered?: boolean;
  headingLevel?: 3 | 4;
}) {
  const Title = headingLevel === 3 ? "h3" : "h4";
  const List = numbered ? "ol" : "ul";
  return (
    <List role="list" className={`mt-5 grid gap-3 ${columns}`}>
      {tiles.map((tile, i) => {
        const Icon = tile.icon;
        return (
          <li
            key={tile.title}
            className="relative flex min-w-0 gap-3 rounded-2xl border border-line/80 bg-base/50 p-4 transition-colors hover:border-line-accent"
          >
            <span
              aria-hidden="true"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TILE_TONE[tile.tone ?? "cyan"]}`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <Title className="text-[15px] font-semibold leading-snug text-ink">
                {numbered && (
                  <span className="mr-1.5 font-mono text-xs text-ink-subtle">
                    {i + 1}
                    <span className="sr-only">.</span>
                  </span>
                )}
                {tile.title}
              </Title>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{tile.body}</p>
            </div>
          </li>
        );
      })}
    </List>
  );
}
