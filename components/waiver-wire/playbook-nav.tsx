"use client";

/**
 * The playbook's contents, following the reader down the page.
 *
 * WHY. Eight lessons under a board is a long page, and a list of links at the
 * top of it is read once and scrolled away from. This stays in view: a sticky
 * chip bar on a phone, a sticky numbered list beside the lessons on a wide
 * screen, both marking the lesson currently on screen and how far through the
 * playbook the reader is.
 *
 * Plain in-page anchors, so it works with scripting off; the script only adds
 * the "you are here" marking. `aria-current="location"` is the semantic for
 * that, and the progress figure is text inside the nav, not only a bar.
 *
 * The chip bar scrolls sideways on a phone. It is navigation rather than data,
 * and every destination is also reachable by scrolling the page itself.
 */

import { useEffect, useRef, useState } from "react";

export type PlaybookItem = { id: string; title: string; short: string };

function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;

    // A section counts as current once its heading crosses the upper third of
    // the viewport, and stays current until the next one does.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // At a boundary two sections share the band; the lower one is the
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

export function PlaybookNav({
  items,
  variant,
  label = "Waiver wire playbook",
}: {
  items: PlaybookItem[];
  variant: "bar" | "rail";
  label?: string;
}) {
  const ids = items.map((i) => i.id);
  // Stable identity for the effect: the list never changes after render.
  const idsRef = useRef(ids);
  const active = useActiveSection(idsRef.current);
  const activeIndex = active ? ids.indexOf(active) : -1;
  const barRef = useRef<HTMLUListElement>(null);

  // Keep the current chip in view in the sideways bar.
  useEffect(() => {
    if (variant !== "bar" || !active || !barRef.current) return;
    const chip = barRef.current.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!chip) return;
    const bar = barRef.current;
    const left = chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bar.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
  }, [active, variant]);

  const progress = activeIndex >= 0 ? (activeIndex + 1) / items.length : 0;

  // The sticky bar sits under the sticky site header, so anything scrolled
  // into view by focus or an anchor needs to clear both (WCAG 2.4.11). Set on
  // the page's scroll container while the bar is mounted, restored after.
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
        <ul
          ref={barRef}
          role="list"
          className="beacon-scroll flex gap-1.5 overflow-x-auto pb-1"
        >
          {items.map((item, i) => {
            const current = item.id === active;
            return (
              <li key={item.id} data-id={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  aria-current={current ? "location" : undefined}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    current
                      ? "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
                      : "border-line bg-surface/70 text-ink-muted hover:text-ink"
                  }`}
                >
                  <span aria-hidden="true" className="font-mono text-[10px] opacity-70">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {item.short}
                </a>
              </li>
            );
          })}
        </ul>
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 block h-0.5 bg-transparent">
          <span
            className="block h-full transition-[width] duration-300 motion-reduce:transition-none"
            style={{
              width: `${progress * 100}%`,
              backgroundImage: "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)",
            }}
          />
        </span>
      </nav>
    );
  }

  return (
    <nav aria-label={label} className="rounded-3xl border border-line bg-surface/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        The playbook
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        {activeIndex >= 0
          ? `Section ${activeIndex + 1} of ${items.length}`
          : `${items.length} sections`}
      </p>
      <span aria-hidden="true" className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-ink/10">
        <span
          className="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{
            width: `${Math.max(4, progress * 100)}%`,
            backgroundImage: "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)",
          }}
        />
      </span>
      <ol role="list" className="mt-3 space-y-0.5">
        {items.map((item, i) => {
          const current = item.id === active;
          const done = activeIndex > i;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  current
                    ? "bg-brand-cyan/10 font-semibold text-ink"
                    : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                    current
                      ? "bg-brand-cyan text-[#07070D]"
                      : done
                        ? "bg-brand-purple/25 text-brand-purple-light"
                        : "bg-ink/[0.06] text-ink-subtle"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">{item.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
