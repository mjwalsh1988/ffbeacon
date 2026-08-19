/**
 * A guide's contents list: every section of the page, in order, as anchor links.
 *
 * It lives in the guide rail, so on a long page you can see the shape of what
 * you are reading and jump into it. The numbers are decorative; the count beside
 * a label is not, which is why it is inside the link text rather than pinned to
 * the side where it would read as a separate control.
 *
 * Presentational server component.
 */

import { ListTree } from "lucide-react";

export type GuideTocItem = {
  /** The id of the heading this points at. */
  id: string;
  label: string;
  /** How many entries the section holds, where that is worth knowing. */
  count?: number;
};

export function GuideToc({
  items,
  heading = "On this page",
  headingId = "guide-toc-heading",
}: {
  items: GuideTocItem[];
  heading?: string;
  headingId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/60 p-3 sm:p-4"
    >
      <h2
        id={headingId}
        className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
      >
        <ListTree aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        {heading}
      </h2>
      <ol role="list" className="mt-2 space-y-0.5">
        {items.map((item, index) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="flex min-h-11 items-center gap-2 rounded-card border border-l-2 border-transparent px-2 py-1.5 text-sm text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="font-mono text-xs tabular-nums text-ink-subtle"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                {item.label}
                {item.count != null && (
                  <span className="ml-1.5 text-xs text-ink-subtle">({item.count})</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
