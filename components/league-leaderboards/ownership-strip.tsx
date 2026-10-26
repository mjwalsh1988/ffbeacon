/**
 * One bar per settled week: how tall is what he scored, the color is who had
 * him. Purple is the team holding him today, cyan is a different team, a
 * dashed outline is a free agent week, and a dot is a week he did not play.
 *
 * A GRAPHIC, SO aria-hidden. Who held him each week is said in words beside
 * it (the owner tag and the history line), and the totals are printed. The
 * one thing only the picture shows is the size of each single week, which is
 * a summary of the totals rather than a figure anyone is asked to read off a
 * bar; a week's exact points are on the Best player games list and the
 * player's own profile.
 */

import type { OwnershipWeek } from "@/lib/league-leaderboards/types";

export function OwnershipStrip({
  ownership,
  currentRosterId,
  size = "sm",
}: {
  ownership: OwnershipWeek[];
  currentRosterId: number | null;
  /** "lg" fills the middle of a wide row; "sm" sits under the name. */
  size?: "sm" | "lg";
}) {
  if (ownership.length <= 1) return null;
  const max = Math.max(1, ...ownership.map((w) => w.points ?? 0));
  const bar = size === "lg" ? "w-2.5" : "w-1.5";
  return (
    <span aria-hidden="true" className={`flex items-end ${size === "lg" ? "h-9 gap-1" : "h-5 gap-[3px]"}`}>
      {ownership.map((w) => {
        if (w.points === null) {
          return <span key={w.week} className={`h-1 rounded-full bg-ink/15 ${bar}`} />;
        }
        const height = `${Math.max(14, Math.min(100, (Math.max(0, w.points) / max) * 100))}%`;
        const tone =
          w.rosterId === null
            ? "border border-dashed border-ink/45 bg-transparent"
            : w.rosterId === currentRosterId
              ? "bg-brand-purple"
              : "bg-brand-cyan";
        return <span key={w.week} className={`rounded-sm ${bar} ${tone}`} style={{ height }} />;
      })}
    </span>
  );
}

/** The key to the strip's colors, drawn once above a list that uses it. */
export function OwnershipLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-subtle">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-1.5 rounded-sm bg-brand-purple" />
        Weeks on today&apos;s team
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-1.5 rounded-sm bg-brand-cyan" />
        Weeks on another team
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-1.5 rounded-sm border border-dashed border-ink/45" />
        Free agent weeks
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-1 w-1.5 rounded-full bg-ink/30" />
        Did not play
      </span>
    </p>
  );
}
