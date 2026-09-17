/**
 * The heading that starts every section of a guide, in one place so the two
 * published guides open a section the same way.
 *
 * A beacon rule marks where the section begins, a small coloured eyebrow says
 * what kind of section it is, and the heading follows. The rule is decorative.
 * The eyebrow is read: on the course-style guides it carries the lesson number,
 * which is worth hearing. The heading carries the meaning and is what the
 * section's aria-labelledby points at.
 *
 * The heading is set well below the masthead title on purpose. It was two steps
 * larger than its own h3s, which read as a second page title every time a
 * section started and left the level below it looking like body copy.
 *
 * Presentational server component.
 */

import type { LucideIcon } from "lucide-react";

const TONES = {
  cyan: "#22D3EE",
  purple: "#A855F7",
} as const;

export function GuideSectionHeader({
  id,
  eyebrow,
  heading,
  tone = "cyan",
  icon: Icon,
}: {
  id: string;
  /** Optional: a section that needs no label above it simply has none. */
  eyebrow?: string;
  heading: string;
  tone?: keyof typeof TONES;
  /** Decorative. Sits beside the eyebrow; the heading carries the meaning. */
  icon?: LucideIcon;
}) {
  const color = TONES[tone];
  return (
    <>
      <div
        aria-hidden="true"
        className="h-px w-full"
        style={{
          backgroundImage: `linear-gradient(90deg, ${color} 0%, ${color}33 45%, transparent 100%)`,
        }}
      />
      {/* The eyebrow is real text. It used to be aria-hidden as decoration,
          but on the course-style guides it says "Lesson 3 of 8", which is the
          one thing a reader moving through the page wants to hear before the
          heading. Visible text is not hidden from a screen reader. */}
      {eyebrow && (
        <p
          className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color }}
        >
          {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5" />}
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className={`scroll-mt-24 text-2xl font-semibold tracking-tight text-ink sm:text-3xl ${
          eyebrow ? "mt-1.5" : "mt-4"
        }`}
      >
        {heading}
      </h2>
    </>
  );
}

/** The heading one level down, so a guide's h3s agree with each other too. */
export function GuideSubheading({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      id={id}
      className={`scroll-mt-24 text-lg font-semibold tracking-tight text-ink sm:text-xl ${className}`}
    >
      {children}
    </h3>
  );
}
