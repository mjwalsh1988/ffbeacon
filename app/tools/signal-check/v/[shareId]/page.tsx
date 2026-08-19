import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ScrollText, Trophy } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { SITE } from "@/lib/site";
import type { PublicSharePayload, SideKey } from "@/lib/signal-check/types";
import { TradeMarginGraph } from "../../trade-margin-graph";
import { AssetAvatar } from "../../asset-avatar";
import { ValueAdjustmentRow } from "@/components/value-adjustment-row";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead, type MastheadChip } from "@/components/app-shell/page-masthead";

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

function sideName(s: PublicSharePayload["sides"][number]): string {
  return s.teamLabel || `Side ${s.side.toUpperCase()}`;
}

export default async function SignalCheckSharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const payload = await loadPayload(shareId);
  if (!payload) notFound();

  const labelFor = (side: SideKey) =>
    payload.sides.find((s) => s.side === side)?.teamLabel || `Side ${side.toUpperCase()}`;

  // The chips the old hero carried, in the masthead's own chip row. Same three
  // readouts, same order, with the label folded into the chip text.
  const chips: MastheadChip[] = [{ label: `Format: ${payload.formatDisplay}`, tone: "cyan" }];
  if (payload.tradeShapeLabel) {
    chips.push({ label: `Trade shape: ${payload.tradeShapeLabel}` });
  }
  if (payload.confidenceLabel) {
    chips.push({ label: `Confidence: ${payload.confidenceLabel}` });
  }

  return (
    <main id="main">
      <PageBody>
        <PageMasthead
          eyebrow={`${payload.featureLabel}, ${payload.resultLabel}`}
          title={payload.verdictLabel}
          chips={chips}
          stats={
            payload.marginPct !== null
              ? [
                  {
                    label: payload.winnerSide ? "Value margin" : "Value spread",
                    value: `${payload.marginPct}%`,
                    accent: "cyan",
                  },
                ]
              : []
          }
        />

        <section aria-labelledby="verdict-detail">
          <div className="mx-auto mt-8 max-w-3xl">
            <h2 id="verdict-detail" className="sr-only">
              Verdict detail
            </h2>

            {payload.marginPct !== null && (
              <TradeMarginGraph
                marginPct={payload.marginPct}
                winnerSide={payload.winnerSide}
                isNeutral={payload.winnerSide === null}
                sideALabel={labelFor("a")}
                sideBLabel={labelFor("b")}
                totalA={payload.sides.find((s) => s.side === "a")?.total ?? null}
                totalB={payload.sides.find((s) => s.side === "b")?.total ?? null}
              />
            )}

            <div className="mt-6 rounded-card border border-line bg-surface/40 p-4 sm:p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ScrollText aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                What this means
              </p>
              <p className="mt-2 text-base leading-relaxed text-ink-muted">{payload.explanation}</p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {payload.sides.map((s) => {
                const isWinner = payload.winnerSide === s.side;
                return (
                  <div
                    key={s.side}
                    className={`rounded-card border p-4 ${
                      isWinner ? "border-brand-cyan/50 bg-brand-cyan/[0.04]" : "border-line bg-surface/40"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {sideName(s)}
                        {isWinner && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-cyan">
                            <Trophy aria-hidden="true" className="h-3 w-3" />
                            Winner
                          </span>
                        )}
                      </h3>
                      {s.total !== null && (
                        <span className="text-sm font-semibold tabular-nums text-ink-muted">
                          {s.total.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <ul role="list" className="mt-3 space-y-2">
                      {s.assets.map((a, i) => {
                        const kind: "player" | "pick" =
                          a.kind ??
                          (a.detail?.toLowerCase().startsWith("draft pick") ? "pick" : "player");
                        return (
                          <li key={i} className="flex items-center gap-2.5">
                            <AssetAvatar
                              kind={kind}
                              sleeperId={a.sleeperId ?? null}
                              round={a.round ?? null}
                              name={a.name}
                              size={36}
                              decorative
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-ink">
                                {a.name}
                              </span>
                              {a.detail && (
                                <span className="block truncate text-xs text-ink-subtle">{a.detail}</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                      {payload.adjustmentLabel && (
                        <ValueAdjustmentRow
                          label={payload.adjustmentLabel}
                          points={s.adjustment}
                          pct={s.adjustmentPct}
                        />
                      )}
                    </ul>
                  </div>
                );
              })}
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
      </PageBody>
    </main>
  );
}
