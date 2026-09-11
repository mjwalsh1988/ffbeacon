/**
 * The floor-to-ceiling strip under a Who Should I Start card's projected
 * points: a band from floor to ceiling, with a dot at the projection.
 *
 * EVERY CARD ON ONE BOARD DRAWS AGAINST THE SAME SCALE. The board works out
 * scaleMax once from every card's ceiling and hands it down, so a strip that
 * reaches further right really does reach a higher ceiling than the one
 * beside it, and a narrow band really is a steadier player. Scaled per card,
 * every strip would fill its own track and the comparison the drawing exists
 * for would be gone. The board says so in one visible sentence under the
 * card row.
 *
 * THE DRAWING IS aria-hidden AND EVERY NUMBER IN IT IS TEXT ON THE CARD. The
 * projection is the large figure above it and the floor and ceiling are
 * printed under it as plain text, so a screen reader and a pointer reader
 * both land on real words. This is the pattern components/chart-kit.tsx uses
 * for a drawing whose values are already stated.
 *
 * Presentational server component.
 */

const GRID_LINES = [25, 50, 75];

export function ProjectionRange({
  floor,
  points,
  ceiling,
  scaleMax,
  emphasis,
}: {
  floor: number;
  points: number;
  ceiling: number;
  /** The shared top of the scale for every card on the board, in points. */
  scaleMax: number;
  emphasis: "start" | "sit";
}) {
  const max = scaleMax > 0 ? scaleMax : Math.max(ceiling, 1);
  const pct = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));
  const left = pct(floor);
  const right = pct(ceiling);
  const dot = pct(points);

  const band =
    emphasis === "start"
      ? "bg-gradient-to-r from-signal-success/45 to-emerald-300/85"
      : "bg-ink-subtle/45";
  const dotFill = emphasis === "start" ? "bg-white" : "bg-ink-muted";

  return (
    <div className="mt-4">
      <div aria-hidden="true" className="pointer-events-none relative h-2.5">
        <span className="absolute inset-0 rounded-full border border-line bg-base" />
        {GRID_LINES.map((t) => (
          <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${t}%` }} />
        ))}
        <span
          className={`absolute inset-y-0 rounded-full ${band}`}
          style={{ left: `${left}%`, width: `${Math.max(right - left, 1.5)}%` }}
        />
        <span
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface ${dotFill}`}
          style={{ left: `${dot}%` }}
        />
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span>
          Floor <span className="font-mono tabular-nums text-ink">{floor.toFixed(1)}</span>
          <span className="sr-only">,</span>
        </span>
        <span>
          Ceiling <span className="font-mono tabular-nums text-ink">{ceiling.toFixed(1)}</span>
        </span>
      </p>
    </div>
  );
}
