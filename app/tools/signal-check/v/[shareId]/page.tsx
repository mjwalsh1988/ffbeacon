import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { SITE } from "@/lib/site";
import type { PublicSharePayload } from "@/lib/signal-check/types";

export const dynamic = "force-dynamic";

/**
 * Public Signal Check share page. Reads ONLY the public_payload of a PUBLIC
 * analysis, server-side via the service role. Private columns (user_id,
 * sleeper_context, raw/adjusted values, rule trace) are never queried or
 * rendered here.
 */
async function loadPayload(shareId: string): Promise<PublicSharePayload | null> {
  if (!shareId || shareId.length > 64) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("signal_check_analyses")
    .select("public_payload, is_public")
    .eq("public_share_id", shareId)
    .maybeSingle();
  if (!data || !data.is_public || !data.public_payload) return null;
  return data.public_payload as unknown as PublicSharePayload;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const payload = await loadPayload(shareId);
  if (!payload) {
    return { title: "Signal Check", robots: { index: false } };
  }
  const title = `${payload.verdictLabel} | ${payload.featureLabel}`;
  const description = payload.explanation.slice(0, 200);
  const ogUrl = `${SITE.url}/api/og/signal-check/${shareId}`;
  return {
    title,
    description,
    robots: { index: false },
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogUrl] },
  };
}

export default async function SignalCheckSharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const payload = await loadPayload(shareId);
  if (!payload) notFound();

  return (
    <main id="main">
      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            {payload.featureLabel} · {payload.resultLabel}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
            {payload.verdictLabel}
          </h1>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-ink-subtle">Format</dt>
              <dd className="font-medium text-ink">{payload.formatDisplay}</dd>
            </div>
            {payload.tradeShapeLabel && (
              <div>
                <dt className="text-ink-subtle">Trade shape</dt>
                <dd className="font-medium text-ink">{payload.tradeShapeLabel}</dd>
              </div>
            )}
            {payload.confidenceLabel && (
              <div>
                <dt className="text-ink-subtle">Confidence</dt>
                <dd className="font-medium text-ink">{payload.confidenceLabel}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <section aria-labelledby="verdict-detail" className="border-b border-line">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <h2 id="verdict-detail" className="sr-only">
            Verdict detail
          </h2>

          <p className="text-base leading-relaxed text-ink-muted">{payload.explanation}</p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {payload.sides.map((s) => (
              <div key={s.side} className="rounded-card border border-line bg-surface/40 p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-ink">
                    {s.teamLabel || `Side ${s.side.toUpperCase()}`}
                    {payload.winnerSide === s.side && (
                      <span className="ml-2 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-cyan">
                        Winner
                      </span>
                    )}
                  </h3>
                  {s.total !== null && (
                    <span className="text-sm font-medium text-ink-muted">{s.total}</span>
                  )}
                </div>
                <ul role="list" className="mt-2 space-y-1">
                  {s.assets.map((a, i) => (
                    <li key={i} className="text-sm text-ink">
                      {a.name}
                      {a.detail && <span className="ml-2 text-xs text-ink-subtle">{a.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs text-ink-subtle">
            {payload.valueSnapshotLabel ? `${payload.valueSnapshotLabel}. ` : ""}
            Created {formatEastern(payload.createdAtIso)}.
          </p>

          <div className="mt-8">
            <Link
              href="/tools/signal-check"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Analyze your own trade
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
