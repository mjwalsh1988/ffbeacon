"use client";

/**
 * The contents of a Season Pulse page, following the reader down it.
 *
 * The hub is a long page of a dozen sections, and a list of links at the top
 * is read once and scrolled away from. This stays in view: a sticky chip bar
 * below the site header on a phone and a tablet, a list in the right-hand rail
 * on a wide screen, both marking the section currently on screen.
 *
 * Plain in-page anchors, so it works with scripting off; the script only adds
 * the "you are here" marking, with aria-current="location". Same mechanism as
 * components/waiver-wire/playbook-nav.tsx, without the lesson numbering that
 * component is built around.
 *
 * The chip bar scrolls sideways. It is navigation rather than data, and every
 * destination is also reachable by scrolling the page.
 */

import { useEffect, useRef, useState } from "react";

export type SectionNavItem = { id: string; title: string; short: string };

function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Two sections can share the band at a boundary; the lower one is the
        // one the reader has just arrived at.
        const current = [...ids].reverse().find((id) => visible.has(id));
        if (current) setActive(current);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

export function SectionNav({
  items,
  variant,
  label,
}: {
  items: SectionNavItem[];
  variant: "bar" | "rail";
  /** Names the landmark, e.g. "Season Pulse sections". */
  label: string;
}) {
  const ids = items.map((i) => i.id);
  // Stable identity for the effect: the list never changes after render.
  const idsRef = useRef(ids);
  const active = useActiveSection(idsRef.current);
  const barRef = useRef<HTMLUListElement>(null);

  // Keep the current chip in view in the sideways bar.
  useEffect(() => {
    if (variant !== "bar" || !active || !barRef.current) return;
    const chip = barRef.current.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!chip) return;
    const bar = barRef.current;
    const left = chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2;
    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bar.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [active, variant]);

  // The sticky bar sits under the sticky site header, so an anchor target has
  // to clear both (WCAG 2.4.11). Set while the bar is mounted, restored after.
  useEffect(() => {
    if (variant !== "bar") return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = "8.5rem";
    return () => {
      root.style.scrollPaddingTop = previous;
    };
  }, [variant]);

  if (variant === "bar") {
    return (
      <nav
        aria-label={label}
        className="sticky top-[4.5rem] z-20 -mx-4 border-b border-line bg-base/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:hidden"
      >
        <ul ref={barRef} role="list" className="beacon-scroll flex gap-1.5 overflow-x-auto pb-1">
          {items.map((item) => {
            const current = item.id === active;
            return (
              <li key={item.id} data-id={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  aria-current={current ? "location" : undefined}
                  className={`flex min-h-11 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    current
                      ? "border-brand-cyan bg-brand-cyan/15 text-brand-cyan underline decoration-2 underline-offset-4"
                      : "border-line bg-surface/70 text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.short}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label={label} className="hidden rounded-modal border border-line bg-surface/50 p-4 xl:block">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">On this page</p>
      <ol role="list" className="mt-2 space-y-0.5">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  current ? "bg-brand-cyan/10 font-semibold text-ink" : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${current ? "bg-brand-cyan" : "bg-ink/20"}`}
                />
                <span className="min-w-0">{item.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
