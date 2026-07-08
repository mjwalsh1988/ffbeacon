"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * "Include draft picks in power rankings" switch, rendered on dynasty league
 * views (overview + teams). Default ON: team totals and the league ranking
 * count draft pick values. Turning it OFF ranks teams by their players only
 * and hides the picks column / tile.
 *
 * State lives in the URL (`?picks=off`; absent means on) so it's shareable and
 * survives a reload, matching how the league view already carries `?source=`.
 * The server reads the param, recomputes totals players-only, and re-renders.
 *
 * Not shown for redraft leagues: those have no draft pick values, so picks
 * never appear and there is nothing to toggle.
 */
export function PicksToggle({ includePicks }: { includePicks: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (includePicks) params.set("picks", "off");
    else params.delete("picks");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={includePicks}
      onClick={toggle}
      disabled={pending}
      aria-label={
        includePicks
          ? "Include draft picks in power rankings is on. Team totals and rankings count draft pick values. Activate to rank by players only, excluding draft picks."
          : "Include draft picks in power rankings is off. Team totals and rankings count players only. Activate to include draft pick values."
      }
      className="inline-flex min-h-11 items-center gap-2.5 rounded-card border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-70"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          includePicks ? "bg-brand-cyan" : "bg-line-accent"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            includePicks ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>Include draft picks</span>
    </button>
  );
}
