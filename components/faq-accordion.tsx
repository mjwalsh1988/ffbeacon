/**
 * The question-and-answer list used under a tool page's "questions,
 * answered" heading.
 *
 * Native <details> and <summary>, so opening one needs no JavaScript and
 * the expanded state is announced by the browser itself. Each question is a
 * real h3 inside its summary, which keeps the page outline intact for a
 * reader navigating by heading, and matches the FAQPage JSON-LD built from
 * the same strings.
 *
 * The number tile and the plus sign are decorative (aria-hidden). The plus
 * turns into a cross when the item is open, and the open item takes a cyan
 * border, so the state reads without colour as well as with it.
 *
 * Presentational server component.
 */

import { Plus } from "lucide-react";

export type FaqAccordionItem = {
  question: string;
  answer: string;
};

export function FaqAccordion({ items }: { items: FaqAccordionItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <details
          key={item.question}
          className="group rounded-card border border-line bg-surface/40 transition-colors hover:border-line-accent open:border-brand-cyan/40 open:bg-surface/70"
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-card px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-accent bg-base font-mono text-[11px] font-bold text-ink-subtle transition-colors group-open:border-brand-cyan/50 group-open:text-brand-cyan"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink sm:text-base">
              {item.question}
            </h3>
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-base text-ink-subtle transition-transform group-open:rotate-45 group-open:border-brand-cyan/50 group-open:text-brand-cyan motion-reduce:transition-none"
            >
              <Plus className="h-4 w-4" />
            </span>
          </summary>
          <div className="px-4 pb-4 sm:pl-[3.75rem]">
            <p className="leading-relaxed text-ink-muted">{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
