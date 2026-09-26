import { ImageResponse } from "next/og";
import { formatEastern } from "@/lib/datetime";
import { loadRelayBySlug } from "@/lib/relays/load";
import { RELAY_KIND_LABELS } from "@/lib/relays/types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { renderHeadlineCard } from "@/lib/og/headline-card";
import { fitText, OG_COLORS as C, OG_ROOT_STYLE, OgAccentBar, OgBrandMark, ogResponseOptions } from "@/lib/og/brand";

export const runtime = "nodejs";

// Short on purpose: a Relay can be retracted, and a long stale window would
// keep its card circulating from the CDN for a day after the permalink stopped
// showing it.
const CACHE = "public, max-age=300, s-maxage=1800, stale-while-revalidate=1800";
const WIDTH = 1072;
const HEADLINE_LINE_HEIGHT = 1.12;

/**
 * GET /api/og/relay/[slug]
 *
 * The share card for one Relay, the short report that reads like a social
 * post. Every Relay permalink used to share the generic Brief card, so a link
 * to "Giants rule out Jaxson Dart" previewed as "The news that changes your
 * lineup" and said nothing about the news.
 *
 * Published Relays only, through the same public read path the permalink uses
 * (loadRelayBySlug filters on status), so a retracted or hidden Relay can
 * never be drawn. Anything else gets the generic Brief card.
 *
 * Every figure on it is the Relay's own: the headline, up to three of its
 * facts, who reported it and when, in Eastern time (CLAUDE.md, Time Display).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug || slug.length > 120 || !/^[a-z0-9-]+$/.test(slug)) return briefCard();

  const relay = await loadRelayBySlug(createCachedReadClient(), slug);
  if (!relay) return briefCard();

  const headline = fitText(relay.headline, { width: WIDTH, maxSize: 58, minSize: 34, maxLines: 3 });
  const facts = relay.facts.slice(0, 3).map((f) => ({
    label: f.label,
    value: fitText(f.value, { width: Math.floor((WIDTH - 2 * 14) / 3) - 40, maxSize: 22, minSize: 17, maxLines: 2, weight: 500 }),
  }));
  const source = `Reported by @${relay.sourceHandle.replace(/^@/, "")}, ${formatEastern(relay.sourcePostedAt)}`;

  return new ImageResponse(
    (
      <div style={{ ...OG_ROOT_STYLE, padding: "52px 64px 40px 64px" }}>
        <OgAccentBar />
        <div
          style={{
            position: "absolute",
            top: -140,
            right: -140,
            width: 520,
            height: 520,
            borderRadius: 260,
            background: "radial-gradient(circle, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0) 70%)",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <OgBrandMark />
          <p style={{ fontSize: 20, fontWeight: 900, color: C.cyan, margin: 0, letterSpacing: 4, textTransform: "uppercase" }}>
            {RELAY_KIND_LABELS[relay.kind] ?? "News"}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", minHeight: 0 }}>
          <p style={{ fontSize: 19, fontWeight: 900, color: C.purple, margin: 0, letterSpacing: 4, textTransform: "uppercase" }}>
            The Beacon Brief
          </p>
          <p
            style={{
              fontSize: headline.fontSize,
              fontWeight: 900,
              letterSpacing: -1,
              lineHeight: HEADLINE_LINE_HEIGHT,
              margin: "14px 0 0 0",
              height: Math.ceil(headline.lines * headline.fontSize * HEADLINE_LINE_HEIGHT),
              flexShrink: 0,
            }}
          >
            {headline.text}
          </p>
          {facts.length > 0 && (
            <div style={{ display: "flex", gap: 14, marginTop: 26, flexShrink: 0 }}>
              {facts.map((f, i) => (
                <div
                  key={`${f.label}-${i}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    padding: "12px 20px",
                    borderRadius: 14,
                    border: `1px solid ${i % 2 === 0 ? C.purple : C.cyan}55`,
                    background: "rgba(15,15,26,0.8)",
                  }}
                >
                  <p style={{ fontSize: 14, fontWeight: 900, color: C.inkSubtle, margin: 0, letterSpacing: 1.5, textTransform: "uppercase" }}>
                    {fitText(f.label, { width: 280, maxSize: 14, minSize: 12, maxLines: 1 }).text}
                  </p>
                  <p style={{ fontSize: f.value.fontSize, color: C.ink, margin: "6px 0 0 0", lineHeight: 1.25 }}>{f.value.text}</p>
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
          <p style={{ fontSize: 19, color: C.inkSubtle, margin: 0 }}>{fitText(source, { width: 760, maxSize: 19, minSize: 15, maxLines: 1, weight: 500 }).text}</p>
          <p style={{ fontSize: 20, fontWeight: 900, color: C.inkMuted, margin: 0 }}>ffbeacon.com/brief</p>
        </div>
      </div>
    ),
    ogResponseOptions(CACHE),
  );
}

/** A slug that names no published Relay: the Brief's own card. */
function briefCard(): ImageResponse {
  return renderHeadlineCard(
    {
      eyebrow: "The Beacon Brief",
      headlineTop: "The news that",
      headlineBottom: "changes your lineup",
      subhead:
        "Injuries, snap counts, trades, and depth chart moves, written plainly and tied to the players you actually roster.",
      facts: ["Updated all day", "Free to read"],
      footerLeft: "ffbeacon.com/brief",
      badge: "The Beacon Brief",
    },
    CACHE,
  );
}
