/**
 * ToolExplainer: the plain-English section under a tool or a game.
 *
 * WHY IT EXISTS
 *
 * A tool page is a form and a result, and to a crawler (or to a reader who
 * arrived from a search and has not pressed anything yet) that is about fifty
 * words. Google AdSense declined the site on 2026-09-14 for "low value
 * content", and the pages with the least text were exactly the ones a reviewer
 * lands on from the navigation. The trade calculator and the start/sit tool
 * already carried a written method and FAQ (their own written-sections.tsx
 * files); this component gives the other six pages the same thing in one shape.
 *
 * WHAT IT RENDERS
 *
 *   1. The explainer: one h2 with an intro, then "How it works" as an ordered
 *      list of numbered cards (h3 for the list heading, h4 per step), then an
 *      optional "Good to know" list of callouts.
 *   2. The FAQ: its own h2, native details/summary through FaqAccordion (h3
 *      per question), and a FAQPage JSON-LD script BUILT FROM THE SAME ARRAY,
 *      so the structured data can never claim an answer the page does not show.
 *   3. Where to go next: an h2 over LinkTiles.
 *
 * RULES IT IS WRITTEN TO
 *
 *   - Server component. The words must ship in the initial HTML, because the
 *     crawlers that matter here do not run JavaScript.
 *   - The page's h1 belongs to PageMasthead, so nothing here is above h2.
 *   - Every icon and number badge is decorative and aria-hidden; the ordered
 *     list carries the step numbers for a screen reader, and the eyebrow text
 *     is real visible text rather than an aria-label.
 *   - Colour is never the only signal: the numbered tile, the accent rails and
 *     the gradient wash decorate cards whose meaning is entirely in their text.
 *   - Nothing here is hidden at any breakpoint. The grids wrap.
 *   - Any number that an admin can change (a cost, a limit) is passed IN by the
 *     page from live settings, never typed into the copy.
 */

import type { ReactNode } from "react";
import { MessageCircleQuestion, type LucideIcon } from "lucide-react";
import {
  FeatureIconTile,
  FeatureSectionHeader,
  type FeatureTone,
} from "@/components/feature-section-header";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { LinkTile } from "@/components/link-tile";
import { serializeJsonLd } from "@/lib/json-ld";

export type ExplainerStep = {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
};

export type ExplainerNote = {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  tone?: FeatureTone;
};

export type ExplainerLink = {
  href: string;
  icon: LucideIcon;
  title: string;
  body: string;
  accent?: "cyan" | "purple";
};

export type ToolExplainerProps = {
  /** Prefix for every id in the section. Unique per page. */
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  intro: ReactNode;
  tone?: FeatureTone;
  steps: ExplainerStep[];
  stepsHeading?: string;
  notes?: ExplainerNote[];
  notesHeading?: string;
  faq?: FaqAccordionItem[];
  faqEyebrow?: string;
  faqTitle?: string;
  next?: ExplainerLink[];
  nextHeading?: string;
};

/** Build the FAQPage schema from the same items the accordion renders. */
export function faqPageJsonLd(items: FaqAccordionItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function ToolExplainer({
  id,
  icon,
  eyebrow,
  title,
  intro,
  tone = "cyan",
  steps,
  stepsHeading = "How it works",
  notes,
  notesHeading = "Good to know",
  faq,
  faqEyebrow = "FAQ",
  faqTitle = "Questions, answered",
  next,
  nextHeading = "Where to go next",
}: ToolExplainerProps) {
  const headingId = `${id}-heading`;
  const faqHeadingId = `${id}-faq-heading`;
  const nextHeadingId = `${id}-next-heading`;

  return (
    // No width of its own. It fills the column its page is in, which is what
    // keeps its left edge on the same line as the tool above it. It used to cap
    // itself at max-w-5xl and centre, which put it 5rem inside a 90rem tool on
    // one page and 8rem inside a 96rem one on another, for no reason a reader
    // could see. Nothing in here is a long line of prose: the steps, notes and
    // next-steps are card grids, and the intro paragraph sets its own measure.
    <div className="mt-20 space-y-16 sm:space-y-20">
      <section
        aria-labelledby={headingId}
        className="relative overflow-hidden rounded-modal border border-line bg-surface/40 p-5 sm:p-8"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 100% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 50%), radial-gradient(ellipse at 0% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 50%)",
        }}
      >
        {/* Beacon hairline across the top. Decorative, and pointer-events-none
            so a screen reader following the mouse never lands on it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />

        <div className="relative">
          <FeatureSectionHeader
            id={headingId}
            icon={icon}
            eyebrow={eyebrow}
            title={title}
            intro={intro}
            tone={tone}
          />

          <h3 className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle">
            {stepsHeading}
          </h3>
          <ol role="list" className="mt-4 grid gap-4 md:grid-cols-2">
            {steps.map((step, index) => (
              <StepCard key={step.title} step={step} index={index} />
            ))}
          </ol>

          {notes && notes.length > 0 && (
            <>
              <h3 className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle">
                {notesHeading}
              </h3>
              <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {notes.map((note) => (
                  <NoteCard key={note.title} note={note} />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {faq && faq.length > 0 && (
        <section
          aria-labelledby={faqHeadingId}
          className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]"
        >
          <script
            type="application/ld+json"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqPageJsonLd(faq)) }}
          />
          <div className="lg:sticky lg:top-24 lg:self-start">
            <FeatureSectionHeader
              id={faqHeadingId}
              icon={MessageCircleQuestion}
              eyebrow={faqEyebrow}
              title={faqTitle}
              tone="purple"
              layout="stacked"
            />
          </div>
          <FaqAccordion items={faq} />
        </section>
      )}

      {next && next.length > 0 && (
        <section aria-labelledby={nextHeadingId}>
          <h2
            id={nextHeadingId}
            className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle"
          >
            {nextHeading}
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {next.map((link) => (
              <LinkTile
                key={link.href}
                href={link.href}
                icon={link.icon}
                title={link.title}
                body={link.body}
                accent={link.accent}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- Cards ---------- */

function StepCard({ step, index }: { step: ExplainerStep; index: number }) {
  return (
    <li className="relative flex gap-4 rounded-modal border border-line bg-base/60 p-5">
      {/* The step number is real text, not an aria-hidden decoration: a screen
          reader following the pointer must find something when it lands on the
          tile. The sr-only word turns "1" into "Step 1" in linear reading. */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-beacon font-mono text-sm font-bold text-black">
        <span className="sr-only">Step </span>
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <FeatureIconTile icon={step.icon} tone="cyan" size="sm" />
          <h4 className="text-base font-semibold leading-tight text-ink">{step.title}</h4>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-[15px]">
          {step.body}
        </p>
      </div>
    </li>
  );
}

function NoteCard({ note }: { note: ExplainerNote }) {
  const tone = note.tone ?? "purple";
  const color = tone === "purple" ? "#A855F7" : tone === "success" ? "#10B981" : "#22D3EE";
  return (
    <li className="relative overflow-hidden rounded-card border border-line bg-base/60 p-4">
      {/* Left accent rail. Decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage: `linear-gradient(180deg, transparent 0%, ${color} 30%, ${color}66 70%, transparent 100%)`,
        }}
      />
      <div className="flex items-center gap-2.5">
        <FeatureIconTile icon={note.icon} tone={tone} size="sm" />
        <h4 className="text-sm font-semibold leading-tight text-ink">{note.title}</h4>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{note.body}</p>
    </li>
  );
}
