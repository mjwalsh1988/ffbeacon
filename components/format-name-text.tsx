import { Fragment } from "react";

/**
 * A format name as a sighted reader sees it ("Dynasty PPR SF") and as a
 * screen reader hears it ("Dynasty PPR SF (Superflex)"), in ONE text run.
 *
 * The header toggles abbreviate "Superflex" to fit a phone. The old markup
 * hid the abbreviation from assistive technology and put the full name in an
 * aria-label, which fails WCAG 2.5.3: a voice-control user who says "click SF"
 * was naming a word the accessible name did not contain. Here the visible
 * abbreviation stays in the name and only the expansion is sr-only, inside the
 * same element, so the name contains exactly what is on screen.
 */
export type FormatNamePart = { text: string; expansion: string | null };

export function splitFormatName(displayName: string): FormatNamePart[] {
  if (!displayName) return [];
  const parts: FormatNamePart[] = [];
  const pattern = /\bSuperflex\b/gi;
  let last = 0;
  for (const match of displayName.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: displayName.slice(last, start), expansion: null });
    parts.push({ text: "SF", expansion: match[0] });
    last = start + match[0].length;
  }
  if (last < displayName.length) {
    parts.push({ text: displayName.slice(last), expansion: null });
  }
  return parts;
}

/** The accessible name the rendered text produces, for places that need a string. */
export function accessibleFormatName(displayName: string): string {
  return splitFormatName(displayName)
    .map((p) => (p.expansion ? `${p.text} (${p.expansion})` : p.text))
    .join("");
}

export function FormatNameText({ displayName }: { displayName: string }) {
  return (
    <>
      {splitFormatName(displayName).map((part, i) => (
        <Fragment key={i}>
          {part.text}
          {part.expansion && <span className="sr-only"> ({part.expansion})</span>}
        </Fragment>
      ))}
    </>
  );
}
