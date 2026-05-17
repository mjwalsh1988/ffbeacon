import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { POSITIONS } from "@/lib/site";
import {
  resolveSourceForFormat,
  getAvailableSources,
  describeSource,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Players",
  description: "Browse fantasy football player pages and breakdowns by position.",
};

export const dynamic = "force-dynamic";

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; source?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const formatResolution = await resolveFormatSlug(supabase, params.format);
  const sourceResolution = await resolveSourceSlug(supabase, params.source);
  const formatSlug = formatResolution.slug;
  const requestedSourceSlug = sourceResolution.slug;
  const { data: format } = await supabase
    .from("format_configs")
    .select("id, slug, display_name")
    .eq("slug", formatSlug)
    .maybeSingle();

  const topByPosition: Record<string, Array<{ slug: string; name: string }>> = {};
  let fallbackBanner: { requested: string; actual: string } | null = null;
  if (format) {
    const registry = await getAvailableSources(supabase);
    const rankingsResolution = resolveSourceForFormat(
      registry,
      "rankings",
      format.slug,
      requestedSourceSlug,
    );
    if (rankingsResolution.fellBack && rankingsResolution.source) {
      fallbackBanner = {
        requested: describeSource(registry, rankingsResolution.requested),
        actual: describeSource(registry, rankingsResolution.source),
      };
    }
    if (rankingsResolution.source) {
      // Single fetch for the format+source; bucket by position in memory.
      // Previously we issued one SELECT per POSITION (6 round-trips).
      // The full table is ≤500 rows per (format, source) so this is well
      // bounded.
      const { data } = await supabase
        .from("rankings")
        .select("overall_rank, players!inner(slug, first_name, last_name, position)")
        .eq("format_config_id", format.id)
        .eq("source", rankingsResolution.source)
        .order("overall_rank")
        .limit(600);

      for (const position of POSITIONS) topByPosition[position] = [];
      for (const row of data ?? []) {
        const p = (row as unknown as {
          players: { slug: string; first_name: string; last_name: string; position: string };
        }).players;
        const bucket = topByPosition[p.position];
        if (bucket && bucket.length < 12) {
          bucket.push({ slug: p.slug, name: `${p.first_name} ${p.last_name}` });
        }
      }
    }
  }

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
          {fallbackBanner && (
            <p
              role="status"
              className="mb-6 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
            >
              <span className="font-medium text-ink">Heads up:</span> No{" "}
              {fallbackBanner.requested} data available for{" "}
              {format?.display_name ?? "this format"}. Showing {fallbackBanner.actual} data instead.
            </p>
          )}
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Players
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Player breakdowns</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Position-by-position deep dives for the top fantasy assets. Tap a player for outlook,
            rankings across formats, and recent stats.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6 lg:px-8">
        {POSITIONS.map((position) => {
          const players = topByPosition[position] ?? [];
          return (
            <section key={position} aria-labelledby={`position-${position}`}>
              <div className="mb-4 flex items-end justify-between">
                <h2
                  id={`position-${position}`}
                  className="text-2xl font-semibold tracking-tight"
                >
                  {position}
                </h2>
                <Link
                  href={`/rankings?position=${position}`}
                  className="text-sm text-brand-cyan hover:underline"
                >
                  All {position} rankings
                  <span aria-hidden="true"> →</span>
                </Link>
              </div>
              {players.length === 0 ? (
                <p className="text-sm text-ink-muted">No data yet for this position.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {players.map((p) => (
                    <li key={p.slug}>
                      <Link
                        href={`/players/${p.slug}`}
                        className="block rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink-muted hover:border-brand-purple hover:text-ink"
                      >
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
