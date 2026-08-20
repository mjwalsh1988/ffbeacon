"use client";

/**
 * Switching draft view on a phone.
 *
 * The eight views live in the site navigation rail, which is where they belong
 * and which is the whole point of the rail. But the rail only exists from lg up.
 * Below that the same rows are in the site navigation drawer, and reaching them
 * costs opening a modal from the header, finding the section, and pressing a
 * row. That is fine for browsing the site and wrong for a live draft, where the
 * clock is running and switching view is the thing you do most.
 *
 * So below lg the room carries its own switcher: one control naming the view you
 * are on, opening a sheet of all eight. It rides in the same docking bar as the
 * Quick info sheet (see sidebar-sheet.tsx), so it follows you down the page
 * rather than scrolling away, and there is one bar rather than two competing for
 * the same docked position.
 *
 * The rail rows remain the canonical switcher. This is the same eight actions
 * reached a shorter way, so nothing here is exclusive to the small layout.
 */

import { useCallback, useId, useState } from "react";
import { ChevronUp, X } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { navIcon } from "@/components/app-shell/nav-icons";
import type { DraftRailView } from "./draft-room-rail";

export function DraftViewSheet<Id extends string>({
  views,
  activeView,
  onSelect,
}: {
  views: ReadonlyArray<DraftRailView<Id>>;
  activeView: Id;
  onSelect: (id: Id) => void;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const close = useCallback(() => setOpen(false), []);

  const current = views.find((v) => v.id === activeView) ?? views[0];
  const CurrentIcon = navIcon(current.icon);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // aria-haspopup="dialog" and nothing else, matching the Quick info bar:
        // aria-expanded is a disclosure property and this opens a modal rather
        // than expanding in place.
        aria-haspopup="dialog"
        aria-label={`Draft view: ${current.label}. Change view.`}
        className="relative flex h-12 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-card border border-line-accent bg-surface-elevated px-4 text-left shadow-lg shadow-black/40 transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan lg:hidden"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 60%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 60%)",
        }}
      >
        {/* Beacon hairline, matching the room's other elevated surfaces. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <CurrentIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
        <span aria-hidden="true" className="min-w-0 flex-1 truncate">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
            View
          </span>
          <span className="block truncate text-sm font-semibold leading-tight text-ink">
            {current.label}
          </span>
        </span>
        <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
      </button>

      <BottomSheet
        open={open}
        onClose={close}
        label="Draft views"
        labelledBy={headingId}
        hideAboveClass="lg:hidden"
        showClose={false}
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
          <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
            Draft views
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close draft views"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Draft views" className="px-3 pb-4 pt-2">
          <ul className="space-y-2">
            {views.map((v) => {
              const Icon = navIcon(v.icon);
              const isActive = v.id === activeView;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(v.id);
                      close();
                    }}
                    // "true" rather than "page": a draft view is a state of this
                    // page rather than a page of its own.
                    aria-current={isActive ? "true" : undefined}
                    className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      isActive
                        ? "border-brand-cyan/40 bg-brand-cyan/10"
                        : "border-line bg-base/60 hover:border-line-accent"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${
                        isActive
                          ? "border-brand-cyan/40 text-brand-cyan"
                          : "border-line text-ink-muted"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm font-semibold ${
                          isActive ? "text-brand-cyan" : "text-ink"
                        }`}
                      >
                        {v.label}
                      </span>
                      <span className="block text-xs text-ink-muted">{v.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </BottomSheet>
    </>
  );
}
