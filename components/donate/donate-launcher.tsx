"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { DonateForm } from "@/components/donate/donate-form";

/**
 * The Donate control in the site header, and the panel it opens.
 *
 * It sits to the RIGHT of search and Ask BEAM, at the far end of the control
 * cluster, because it is the one control there that is not part of using the
 * product. A reader reaching for search should hit search.
 *
 * THE LABEL IS VISIBLE FROM `sm` UP AND IS AN ICON BELOW IT. Every other
 * control in that row is a 36px square, and a fourth square with a heart in it
 * is a guess rather than a label. Where there is room, the word "Donate" is on
 * screen; where there is not, the icon carries the same accessible name it
 * always had, so nothing is hidden from anybody at any width, only drawn
 * differently.
 *
 * The panel is the house dialog: up from the bottom edge on a phone, in from
 * the right on a desktop, with the focus trap, the Escape handler and the
 * scroll lock that come with it. Unlike the BEAM panel it is UNMOUNTED on close
 * rather than kept alive, because a half-typed donation amount is not a
 * conversation worth preserving, and a fresh panel is a fresh, correct default.
 */
export function DonateLauncher({
  /** Resolved on the server from the Stripe key. See DonateForm. */
  cardEnabled = true,
}: {
  cardEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const pathname = usePathname();
  const lastPathname = useRef(pathname);

  const close = useCallback(() => setOpen(false), []);

  // A completed route change closes the panel. The header lives in the root
  // layout and is not remounted between routes, so a panel opened on one page
  // would otherwise outlive it, holding body scroll locked over a page the
  // reader has already moved on from.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Donate to FF Beacon"
        // The visible control is 36px tall to sit level with search and Ask BEAM,
        // and the `before` pseudo-element extends the TOUCH TARGET to the 44px
        // the project's mobile rule requires. WCAG measures the target, not the
        // paint, so this satisfies the rule without making one button in the
        // cluster taller than the other three.
        className="relative inline-flex h-9 min-h-9 items-center justify-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-2 text-sm font-semibold text-ink transition-colors before:absolute before:left-0 before:top-1/2 before:h-11 before:w-full before:-translate-y-1/2 before:content-[''] hover:border-brand-cyan hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:px-3"
      >
        <Heart aria-hidden="true" className="h-[18px] w-[18px] text-brand-cyan" />
        {/* Not aria-hidden. The aria-label already supersedes this text for a
            screen reader, and hiding it as well would leave a control whose
            visible word and accessible name are maintained in two places with
            nothing tying them together. */}
        <span className="hidden sm:inline">Donate</span>
      </button>

      <SlideUpDialog
        open={open}
        onClose={close}
        label="Donate to FF Beacon"
        labelledBy={headingId}
        closeLabel="Close the donation panel"
      >
        <div className="px-5 pb-6 pt-1">
          {/* A div, not a header. An HTML `header` maps to the banner landmark
              unless it descends from article, aside, main, nav or section, and a
              role="dialog" div is none of those, so this panel would publish a
              second banner alongside the site header. */}
          <div className="border-b border-line pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              Support the work
            </p>
            <h2 id={headingId} className="mt-0.5 text-lg font-bold tracking-tight text-ink">
              Donate to FF Beacon
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              Every tool here is free and stays free. The servers, the data feeds and
              the domain are paid for out of one pocket, and a donation puts something
              back in it.
            </p>
          </div>

          <DonateForm surface="header_modal" cardEnabled={cardEnabled} className="mt-5" />
        </div>
      </SlideUpDialog>
    </>
  );
}
