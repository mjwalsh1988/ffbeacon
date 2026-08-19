"use client";

import { ArrowDown } from "lucide-react";

/**
 * Mobile-only "Start drafting" shortcut. Smooth-scrolls past the hero feature
 * cards down to the Sleeper connect form. Respects prefers-reduced-motion by
 * falling back to an instant jump. Hidden from sm and up, where the form is
 * already close at hand.
 */
export function StartDraftingButton() {
  function scrollToForm() {
    const el = document.getElementById("otc-connect");
    if (!el) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      onClick={scrollToForm}
      className="inline-flex w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:hidden"
    >
      Start drafting
      <ArrowDown aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
