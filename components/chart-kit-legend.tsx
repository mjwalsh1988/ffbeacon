"use client";

/**
 * Toggleable legend for a many-series chart (Positional WAR's six curves).
 * Kept out of components/chart-kit.tsx on purpose: that module has no "use
 * client" directive and ChartFigure is rendered from server components
 * (the Beacon Breakdown tabs). Adding "use client" to the whole file to give
 * this one interactive legend a place to live would turn every existing
 * server usage of ChartFigure into a client component. This file carries its
 * own directive and imports the palette and marker geometry from chart-kit,
 * so chart-kit itself stays server-renderable.
 */

import { markerPath, type SeriesStyle } from "@/components/chart-kit";

export type SeriesToggleItem = {
  id: string;
  style: SeriesStyle;
  /** Visible legend text, readable with the chart entirely hidden. */
  label: string;
  /** Example: "QB, 0.65 wins at QB1, 12 start, replacement QB13". */
  headline: string;
  pressed: boolean;
};

/**
 * A row of real toggle buttons, one per series. Each button's accessible name
 * is its own text content (the headline), so the ranking each series carries
 * is readable from the legend alone, with the chart's <svg> never in play.
 */
export function SeriesToggleLegend({
  items,
  onToggle,
}: {
  items: SeriesToggleItem[];
  onToggle: (id: string) => void;
}) {
  return (
    <ul role="list" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            aria-pressed={item.pressed}
            onClick={() => onToggle(item.id)}
            className="flex min-h-11 min-w-11 items-center gap-2 rounded-card border border-line bg-base/40 px-3 py-2 text-left text-xs font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple aria-[pressed=false]:opacity-60"
          >
            {/* pointer-events-none so a hover lands on the button and a screen
                reader following the mouse reads the button's name. Without it
                the cursor sits on an aria-hidden swatch, which has no name to
                announce. */}
            <svg
              aria-hidden="true"
              width="20"
              height="12"
              viewBox="0 0 20 12"
              className="pointer-events-none shrink-0"
            >
              <line
                x1="0"
                y1="6"
                x2="20"
                y2="6"
                stroke={item.style.color}
                strokeWidth="2"
                strokeDasharray={item.style.dash ?? undefined}
              />
              <path d={markerPath(item.style.marker, 10, 6, 3)} fill={item.style.color} />
            </svg>
            <span>{item.headline}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
