/**
 * Trade activity gauge geometry: a half circle from nine o'clock to three
 * o'clock, filled to score / 100. Shared by the page gauge and the portrait
 * share card. Pure. The band word and the number are real text beside it;
 * the arc is decoration of a value that is already said in words.
 */

export type Gauge = {
  width: number;
  height: number;
  /** Path for the full track. */
  track: string;
  /** Path for the filled part; empty at 0. */
  fill: string;
  /** Tick marks at the band boundaries. */
  ticks: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  stroke: number;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function point(cx: number, cy: number, r: number, t: number): [number, number] {
  // t in [0, 1] from the left end (180 degrees) to the right end (0 degrees).
  const angle = Math.PI * (1 - t);
  return [r2(cx + r * Math.cos(angle)), r2(cy - r * Math.sin(angle))];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = point(cx, cy, r, from);
  const [x2, y2] = point(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r2(r)} ${r2(r)} 0 0 1 ${x2} ${y2}`;
}

export function gaugeGeometry(
  score: number,
  opts: { width: number; stroke: number; bands?: [number, number] },
): Gauge {
  const { width, stroke } = opts;
  const r = (width - stroke) / 2;
  const cx = width / 2;
  const cy = r + stroke / 2;
  const t = Math.min(1, Math.max(0, score / 100));
  const [low, high] = opts.bands ?? [34, 66];
  const ticks = [low, high].map((b) => {
    const [x1, y1] = point(cx, cy, r - stroke / 2 - 2, b / 100);
    const [x2, y2] = point(cx, cy, r + stroke / 2 + 2, b / 100);
    return { x1, y1, x2, y2 };
  });
  return {
    width,
    height: r2(cy + stroke / 2),
    track: arc(cx, cy, r, 0, 1),
    fill: t > 0 ? arc(cx, cy, r, 0, t) : "",
    ticks,
    stroke,
  };
}

/** The gauge as an SVG string for the share image. */
export function gaugeSvg(
  score: number,
  opts: { width: number; stroke: number; trackColor: string; fromColor: string; toColor: string; tickColor: string },
): string {
  const g = gaugeGeometry(score, opts);
  const fill = g.fill
    ? `<path d="${g.fill}" fill="none" stroke="url(#bp-gauge)" stroke-width="${g.stroke}" stroke-linecap="round"/>`
    : "";
  const ticks = g.ticks
    .map((k) => `<line x1="${k.x1}" y1="${k.y1}" x2="${k.x2}" y2="${k.y2}" stroke="${opts.tickColor}" stroke-width="2"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}"><defs><linearGradient id="bp-gauge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${opts.fromColor}"/><stop offset="1" stop-color="${opts.toColor}"/></linearGradient></defs><path d="${g.track}" fill="none" stroke="${opts.trackColor}" stroke-width="${g.stroke}" stroke-linecap="round"/>${fill}${ticks}</svg>`;
}
