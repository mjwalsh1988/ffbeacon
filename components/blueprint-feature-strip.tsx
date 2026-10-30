/**
 * The homepage feature strip for the Team Blueprint (plan 20.2), under the
 * hero. One control, into League Pulse; a reader with a saved Sleeper handle
 * lands on their own leagues there. It reads nothing and renders the same for
 * everyone, so the homepage stays static. Switchable at /admin/site-layout.
 *
 * The preview beside the copy is DECORATIVE (aria-hidden): a picture of the
 * shape of the page, not a claim about any team, with no team, player or
 * league name in it. The text beside it says everything the picture does.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const PRIMARY =
  "inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** Ring geometry for the preview, inline: six fixed proportions of 10. */
function previewRing(cx: number, cy: number, r: number, grade: number) {
  const c = 2 * Math.PI * r;
  const filled = (c * grade) / 10;
  return { cx, cy, r, dash: `${filled.toFixed(2)} ${(c - filled).toFixed(2)}` };
}

function BlueprintPreview() {
  const grades = [8, 6, 7, 4, 5, 9];
  const codes = ["QB", "RB", "WR", "TE", "BN", "DC"];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 360 200"
      className="pointer-events-none h-auto w-full max-w-full lg:w-[360px]"
    >
      <defs>
        <linearGradient id="bp-strip-beacon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A855F7" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="359" height="199" rx="12" fill="#0F0F1A" stroke="#1F1F33" />
      <text x="24" y="44" fontSize="10" fontWeight="600" letterSpacing="2" fill="#22D3EE">
        OVERALL
      </text>
      <text x="22" y="100" fontSize="56" fontWeight="900" fontFamily="Geist Mono, monospace" fill="url(#bp-strip-beacon)">
        7.4
      </text>
      {grades.map((g, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const ring = previewRing(196 + col * 52, 48 + row * 62, 18, g);
        return (
          <g key={codes[i]}>
            <circle cx={ring.cx} cy={ring.cy} r={ring.r} fill="none" stroke="#1F1F33" strokeWidth="5" />
            <circle
              cx={ring.cx}
              cy={ring.cy}
              r={ring.r}
              fill="none"
              stroke="url(#bp-strip-beacon)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={ring.dash}
              transform={`rotate(-90 ${ring.cx} ${ring.cy})`}
            />
            <text x={ring.cx} y={ring.cy + 4} fontSize="12" fontWeight="900" textAnchor="middle" fill="#F4F4F8">
              {g}
            </text>
            <text x={ring.cx} y={ring.cy + 32} fontSize="8" fontWeight="700" textAnchor="middle" fill="#8A8A9C">
              {codes[i]}
            </text>
          </g>
        );
      })}
      <rect x="24" y="150" width="46" height="18" rx="5" fill="#F59E0B" fillOpacity="0.15" />
      <text x="47" y="163" fontSize="9" fontWeight="700" textAnchor="middle" letterSpacing="1" fill="#F59E0B">
        SELL
      </text>
      <rect x="78" y="150" width="52" height="18" rx="5" fill="#A855F7" fillOpacity="0.15" />
      <text x="104" y="163" fontSize="9" fontWeight="700" textAnchor="middle" letterSpacing="1" fill="#C084FC">
        BUILD
      </text>
    </svg>
  );
}

export function BlueprintFeatureStrip({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <section aria-labelledby="blueprint-strip-heading" className="relative overflow-hidden border-b border-line">
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="relative grid items-center gap-6 overflow-hidden rounded-modal border border-line-accent bg-surface/50 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage: "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <div>
            {eyebrow}
            <h2 id="blueprint-strip-heading" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Get your team&apos;s blueprint.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
              Pick any team in your Sleeper league and get a one-page plan: grades by position, who to buy and sell,
              three trade shapes with a grade on each, and the two managers most likely to deal. Share it as a picture.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href="/tools/league-pulse" className={PRIMARY}>
                Open League Pulse
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
              <span className="text-xs text-ink-subtle">Free. No signup. Works for every Sleeper league.</span>
            </div>
          </div>
          <BlueprintPreview />
        </div>
      </div>
    </section>
  );
}
