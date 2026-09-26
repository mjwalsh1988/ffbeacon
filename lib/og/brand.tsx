/**
 * The brand furniture every 1200x630 share card draws, in one place: the
 * colours, the logo lockup, the accent bar along the top edge, and the one
 * helper that sizes a headline so it cannot run into whatever sits under it.
 *
 * WHY THIS EXISTS. Twelve of the seventeen cards each carried their own copy
 * of the header, and every copy had drifted the same two ways: a purple-to-cyan
 * square standing in for the logo, and no fonts passed to ImageResponse, so
 * satori fell back to a system face and faked the 600 and 700 weights. The five
 * cards that used ./assets.ts looked like the site; the twelve did not.
 *
 * SERVER ONLY. It imports ./assets.ts, which reads files at module load.
 */

import type { ReactElement } from "react";
import { OG_FONT_FAMILY, OG_FONTS, OG_LOGO_DATA_URI, OG_WORDMARK } from "./assets";

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** FF Beacon brand colours (CLAUDE.md). No DPC gold or violet, no #0c0c18. */
export const OG_COLORS = {
  bg: "#0F0F1A",
  bgBase: "#07070D",
  ink: "#F4F4F8",
  inkMuted: "#A8A8B8",
  inkSubtle: "#8A8A9C",
  purple: "#A855F7",
  cyan: "#22D3EE",
  line: "#1F1F33",
} as const;

export const OG_GRADIENT = `linear-gradient(90deg, ${OG_COLORS.purple} 0%, ${OG_COLORS.cyan} 100%)`;

/** The ImageResponse options every card passes: size, Geist, and a cache policy. */
export function ogResponseOptions(cacheControl: string, extra: { status?: number } = {}) {
  return {
    ...OG_SIZE,
    fonts: OG_FONTS,
    ...extra,
    headers: { "Cache-Control": cacheControl },
  };
}

/** Root style shared by every card, so the font family is set once. */
export const OG_ROOT_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  color: OG_COLORS.ink,
  fontFamily: OG_FONT_FAMILY,
  fontWeight: 500,
  background: `linear-gradient(135deg, ${OG_COLORS.bgBase} 0%, ${OG_COLORS.bg} 60%, ${OG_COLORS.bgBase} 100%)`,
} as const;

/**
 * The accent bar across the top edge.
 *
 * Pinned with left AND right rather than `width: 100%`. Inside a padded root,
 * satori resolves a percentage width against the content box, which is why the
 * bar on most cards stopped about a hundred pixels short of the right edge.
 */
export function OgAccentBar(): ReactElement {
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: OG_GRADIENT }} />
  );
}

/** The logo and wordmark, the same lockup the five on-brand cards already used. */
export function OgBrandMark({ size = 40 }: { size?: number }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.3), flexShrink: 0 }}>
      {/* Satori draws this into a PNG; next/image has nothing to optimise here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={OG_LOGO_DATA_URI} alt="" width={size} height={size} style={{ width: size, height: size }} />
      <p style={{ fontSize: Math.round(size * 0.72), fontWeight: 900, letterSpacing: -0.5, margin: 0 }}>{OG_WORDMARK}</p>
    </div>
  );
}

/**
 * Average advance of one character as a fraction of the font size, measured
 * for Geist at the two weights the cards load. Black is wider than Medium.
 * Deliberately a little generous: overestimating a title's width costs a few
 * points of font size, underestimating it costs an overlap.
 */
const CHAR_WIDTH = { 900: 0.62, 500: 0.55 } as const;

export interface FittedText {
  /** The text to draw: the original, or clipped with "..." when even minSize will not hold it. */
  text: string;
  fontSize: number;
  /** How many lines the text is expected to take at that size. */
  lines: number;
}

/**
 * The largest font size, stepping down from `maxSize` to `minSize`, at which
 * `text` fits inside `maxLines` lines of `width` pixels; clipped at a word
 * boundary when nothing in the range fits.
 *
 * Word wrapping is simulated rather than estimated from total length, because
 * a line breaks at a space and "Dominion Division (VBP's Redraft Bracket - SD)"
 * wastes most of a line when one long word does not fit on the end of it.
 * The caller reserves `lines * fontSize * lineHeight` pixels, which is what
 * keeps the next element from being drawn on top of the title.
 */
export function fitText(
  raw: string,
  opts: { width: number; maxSize: number; minSize: number; maxLines: number; weight?: 500 | 900 },
): FittedText {
  const text = raw.replace(/\s+/g, " ").trim();
  const perChar = CHAR_WIDTH[opts.weight ?? 900];
  for (let size = opts.maxSize; size >= opts.minSize; size -= 2) {
    const lines = wrapCount(text, Math.floor(opts.width / (size * perChar)));
    if (lines <= opts.maxLines) return { text, fontSize: size, lines };
  }
  const size = opts.minSize;
  const perLine = Math.floor(opts.width / (size * perChar));
  return { text: clipToLines(text, perLine, opts.maxLines), fontSize: size, lines: opts.maxLines };
}

/** How many lines `text` wraps to at `perLine` characters, breaking at spaces. */
function wrapCount(text: string, perLine: number): number {
  if (perLine <= 0) return Number.POSITIVE_INFINITY;
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ")) {
    const len = [...word].length;
    if (len > perLine) return Number.POSITIVE_INFINITY;
    if (used === 0) used = len;
    else if (used + 1 + len <= perLine) used += 1 + len;
    else {
      lines += 1;
      used = len;
    }
  }
  return lines;
}

/** The longest word-boundary prefix that fits `maxLines` lines, with "..." appended. */
function clipToLines(text: string, perLine: number, maxLines: number): string {
  const words = text.split(" ");
  let kept = "";
  for (const word of words) {
    const next = kept ? `${kept} ${word}` : word;
    if (wrapCount(`${next}...`, perLine) > maxLines) break;
    kept = next;
  }
  if (!kept) return `${[...text].slice(0, Math.max(1, perLine - 3)).join("")}...`;
  return `${kept.replace(/[\s,.;:-]+$/, "")}...`;
}
