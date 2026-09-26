/**
 * The headline card: the layout the fixed pages, the guides and the Discord
 * invite all share. An eyebrow, a two-line headline (the second line in the
 * beacon gradient), a subhead, up to three pills and a footer.
 *
 * One template rather than three copies. The page, guide and join routes each
 * carried their own copy of this markup, and all three had drifted the same
 * way (a gradient square for a logo, system fonts, a short accent bar, and
 * descenders clipped off the gradient line).
 *
 * SERVER ONLY (imports ./brand, which reads the font and logo files).
 */

import { ImageResponse } from "next/og";
import { fitText, OG_COLORS as C, OG_GRADIENT, OG_ROOT_STYLE, OgAccentBar, OgBrandMark, ogResponseOptions } from "./brand";

export interface HeadlineCard {
  /** Small uppercase line above the headline. Says what kind of thing this is. */
  eyebrow: string;
  /** First headline line, in plain ink. */
  headlineTop: string;
  /** Second headline line, in the beacon gradient. */
  headlineBottom: string;
  /** The sentence under it: what you get, in the words a reader would use. */
  subhead: string;
  /** Up to three short pills. Reasons to click, not features. */
  facts?: string[];
  /** Printed bottom-left, e.g. "ffbeacon.com/tools/faab". */
  footerLeft: string;
  /** Short label printed bottom-right. */
  badge: string;
}

/** Content width inside the 64px side padding. */
const WIDTH = 1072;

export const HEADLINE_CARD_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export function renderHeadlineCard(card: HeadlineCard, cacheControl = HEADLINE_CARD_CACHE): ImageResponse {
  // Both headline lines share one size, so the pair reads as one headline:
  // the largest size at which BOTH fit on a single line each.
  const top = fitText(card.headlineTop, { width: WIDTH, maxSize: 68, minSize: 40, maxLines: 1 });
  const bottom = fitText(card.headlineBottom, { width: WIDTH, maxSize: 68, minSize: 40, maxLines: 1 });
  const size = Math.min(top.fontSize, bottom.fontSize);
  const subhead = fitText(card.subhead, { width: 1000, maxSize: 26, minSize: 20, maxLines: 2, weight: 500 });
  const facts = (card.facts ?? []).slice(0, 3);

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "52px 64px 40px 64px" }}>
        <OgAccentBar />
        {/* Corner glows, the same two the site paints behind its own panels. */}
        <div
          style={{
            position: "absolute",
            top: -140,
            left: -140,
            width: 520,
            height: 520,
            borderRadius: 260,
            background: "radial-gradient(circle, rgba(168,85,247,0.20) 0%, rgba(168,85,247,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -120,
            right: -160,
            width: 480,
            height: 480,
            borderRadius: 240,
            background: "radial-gradient(circle, rgba(34,211,238,0.16) 0%, rgba(34,211,238,0) 70%)",
          }}
        />

        <div style={{ display: "flex", flexShrink: 0 }}>
          <OgBrandMark />
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", minHeight: 0 }}>
          <p style={{ fontSize: 19, fontWeight: 900, color: C.cyan, margin: 0, textTransform: "uppercase", letterSpacing: 4 }}>
            {card.eyebrow}
          </p>
          <p style={{ fontSize: size, fontWeight: 900, letterSpacing: -1.5, margin: "14px 0 0 0", lineHeight: 1.1 }}>
            {top.text}
          </p>
          {/* A taller line box and bottom padding on the gradient line: with
              background-clip text, satori clips to the line box, which is what
              cut the descenders off g, j and y at the old 1.04 line height. */}
          <p
            style={{
              fontSize: size,
              fontWeight: 900,
              letterSpacing: -1.5,
              margin: 0,
              lineHeight: 1.22,
              paddingBottom: 6,
              background: OG_GRADIENT,
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
            }}
          >
            {bottom.text}
          </p>
          <p style={{ fontSize: subhead.fontSize, color: C.inkMuted, margin: "14px 0 0 0", lineHeight: 1.4, maxWidth: 1000 }}>
            {subhead.text}
          </p>
          {facts.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
              {facts.map((fact) => (
                <div
                  key={fact}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    border: `1px solid ${C.line}`,
                    borderRadius: 999,
                    padding: "8px 18px",
                    fontSize: 20,
                    color: C.inkMuted,
                    background: "rgba(15,15,26,0.7)",
                  }}
                >
                  {fact}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1px solid ${C.line}`,
            paddingTop: 16,
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: 20, color: C.inkSubtle, margin: 0 }}>{card.footerLeft}</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: C.inkMuted, margin: 0 }}>{card.badge}</p>
        </div>
      </div>
    ),
    ogResponseOptions(cacheControl),
  );
}
