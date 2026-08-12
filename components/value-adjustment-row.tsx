import { Plus } from "lucide-react";

import { PLAYER_PHOTO_RADIUS } from "@/components/player-headshot";

/**
 * The consolidation credit, shown as its own line inside a side's asset list.
 *
 * A reader looking at a side with fewer points that still wins needs to see
 * where the difference came from, and a footnote somewhere else on the page is
 * not that. So it sits in the list, in the same row shape as a player, and the
 * side total above it is the sum of everything below including this.
 *
 * Points when the admin shows raw values, a share of the trade when they do not.
 * The percentage carries the same meaning without exposing the value scale, so
 * the line stays honest at either setting rather than disappearing at one.
 *
 * The badge takes PLAYER_PHOTO_RADIUS, the same corner as every headshot and
 * pick badge on the site, so the column of squares reads as one shape.
 *
 * No hooks, so the client builder and the server-rendered share page can both
 * use it.
 */
export function ValueAdjustmentRow({
  label,
  points,
  pct,
  size = 36,
}: {
  label: string;
  /** Credit in points. Null when raw values are hidden. */
  points: number | null | undefined;
  /** The same credit as a percent of the trade. Null when unavailable. */
  pct: number | null | undefined;
  /** Matches the asset avatar size in the surrounding list. */
  size?: number;
}) {
  // undefined, not just null: a share payload frozen before this feature existed
  // has no adjustment fields at all, and it must render as it always did.
  const hasPoints = typeof points === "number" && Number.isFinite(points);
  const hasPct = typeof pct === "number" && Number.isFinite(pct);
  if (!hasPoints && !hasPct) return null;
  const amount = hasPoints ? `+${points.toLocaleString()}` : `+${pct}%`;

  return (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center ${PLAYER_PHOTO_RADIUS} border border-dashed border-brand-cyan/50 bg-brand-cyan/[0.06] text-brand-cyan`}
        style={{ width: size, height: size }}
      >
        <Plus className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{label}</span>
        {/*
          Says only what is true on every trade that earns a credit. "Credit for
          holding the best asset" is the obvious wording and it is wrong: the
          favoured side is the one whose value is concentrated, which is usually
          but not always the side holding the single biggest piece.
        */}
        <span className="block text-xs text-ink-subtle">
          Consolidation credit, for value concentrated in stronger assets
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-brand-cyan">{amount}</span>
    </li>
  );
}
