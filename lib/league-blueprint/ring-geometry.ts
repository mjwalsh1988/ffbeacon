/**
 * Grade ring geometry, shared by the page (components/league-blueprint/
 * grade-rings.tsx) and both share images, so a ring can never read
 * differently in a picture than on the page. Pure.
 *
 * A ring is a proportion of 10: the filled arc is grade / 10 of the circle,
 * starting at twelve o'clock and running clockwise. Arcs only; the numeral is
 * real text beside or over the SVG wherever it is drawn.
 */

export type Ring = {
  size: number;
  cx: number;
  cy: number;
  r: number;
  stroke: number;
  circumference: number;
  /** stroke-dasharray for the filled arc: "<filled> <rest>". */
  dashArray: string;
  /** Rotation that moves the arc's start to twelve o'clock. */
  transform: string;
  fraction: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function ringGeometry(grade: number | null, size: number, stroke: number, max = 10): Ring {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = grade === null ? 0 : Math.min(1, Math.max(0, grade / max));
  const filled = circumference * fraction;
  return {
    size,
    cx: c,
    cy: c,
    r: r2(r),
    stroke,
    circumference: r2(circumference),
    dashArray: `${r2(filled)} ${r2(circumference - filled)}`,
    transform: `rotate(-90 ${c} ${c})`,
    fraction,
  };
}

export type RingRowOptions = {
  size: number;
  stroke: number;
  gap: number;
  trackColor: string;
  /** Gradient stops for the filled arc (the beacon gradient). */
  fromColor: string;
  toColor: string;
};

/** Six (or any number of) rings in one row as an SVG string, arcs only. */
export function ringRowSvg(grades: Array<number | null>, o: RingRowOptions): string {
  const width = grades.length * o.size + (grades.length - 1) * o.gap;
  const parts = grades.map((g, i) => {
    const ring = ringGeometry(g, o.size, o.stroke);
    const x = i * (o.size + o.gap);
    const fill =
      ring.fraction > 0
        ? `<circle cx="${ring.cx}" cy="${ring.cy}" r="${ring.r}" fill="none" stroke="url(#bp-ring)" stroke-width="${o.stroke}" stroke-linecap="round" stroke-dasharray="${ring.dashArray}" transform="${ring.transform}"/>`
        : "";
    return `<g transform="translate(${x} 0)"><circle cx="${ring.cx}" cy="${ring.cy}" r="${ring.r}" fill="none" stroke="${o.trackColor}" stroke-width="${o.stroke}"/>${fill}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${o.size}" viewBox="0 0 ${width} ${o.size}"><defs><linearGradient id="bp-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.fromColor}"/><stop offset="1" stop-color="${o.toColor}"/></linearGradient></defs>${parts.join("")}</svg>`;
}

export function ringRowWidth(count: number, size: number, gap: number): number {
  return count * size + (count - 1) * gap;
}
