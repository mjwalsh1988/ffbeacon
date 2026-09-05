/**
 * What a Manager Pulse report actually contains, listed on the entry page.
 *
 * The page asks for a Sleeper handle and, before this, said nothing about what
 * it would do with one beyond a single line of masthead copy. A reader typing
 * a stranger's handle into a box deserves to know what comes back.
 *
 * Reads MANAGER_NAV_ITEMS, the same list the report's own navigation rail is
 * built from, so this can never promise a section the report does not have.
 *
 * Presentational server component.
 */

import { MANAGER_NAV_ITEMS } from "@/components/manager-shell/nav-items";
import { navIcon } from "@/components/app-shell/nav-icons";

export function WhatYouGet() {
  return (
    <section
      aria-labelledby="mp-what-heading"
      className="rounded-modal border border-line bg-surface/50 p-4 sm:p-5"
    >
      <h2 id="mp-what-heading" className="text-sm font-semibold text-ink">
        What the report reads
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Several seasons of their public Sleeper history, in eight sections.
      </p>
      <ul className="mt-3 space-y-2.5">
        {MANAGER_NAV_ITEMS.map((item) => {
          const Icon = navIcon(item.icon);
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <Icon
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-ink">{item.label}</span>
                <span className="block text-[11px] leading-relaxed text-ink-muted">
                  {item.hint}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
