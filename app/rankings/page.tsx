import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { readPosition } from "@/lib/format";
import { getActiveFormats } from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { formatPhrase, type RankingFormat } from "@/lib/rankings-formats";
import { RankingsView } from "@/components/rankings/rankings-view";

/**
 * /rankings, the hub.
 *
 * Renders the board for whichever format the reader prefers (URL, then DB, then
 * cookie, then default) and links out to every per-format page below it. The
 * format-specific copy and titles live on /rankings/[format]; this page keeps the
 * broad "rankings for every format" framing and acts as the internal link source that
 * makes those twelve pages reachable in one hop.
 *
 * The board itself moved to components/rankings/rankings-view.tsx so this route and
 * the format routes render identical data with different copy.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/rankings" },
  title: "Fantasy Football Rankings",
  description:
    "Sortable, filterable fantasy football rankings across redraft, dynasty, superflex, and TE premium formats. Updated daily with 7-day value trends.",
};

export const dynamic = "force-dynamic";

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    format?: string;
    position?: string;
    source?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [formatResolution, sourceResolution, allFormats] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
    getActiveFormats(supabase),
  ]);

  return (
    <RankingsView
      formatSlug={formatResolution.slug}
      requestedSourceSlug={sourceResolution.slug}
      position={readPosition(params.position)}
      basePath="/rankings"
      hasActiveFilter={Boolean(
        params.position || params.format || params.source,
      )}
      title="Fantasy football player rankings for every format."
      intro="Every player worth knowing, every major league type, in plain English. Sort, filter, and switch your data source on the fly without losing your place."
      footerSlot={
        <FormatDirectory
          formats={allFormats as unknown as RankingFormat[]}
          currentSlug={formatResolution.slug}
        />
      }
    />
  );
}

/**
 * Browse-by-format grid.
 *
 * This is the internal linking that makes the per-format pages reachable. Without it
 * they would exist only in the sitemap, which is the same discovery problem the Brief
 * had. Every active format gets a real link carrying the format name as anchor text.
 */
function FormatDirectory({
  formats,
  currentSlug,
}: {
  formats: RankingFormat[];
  currentSlug: string;
}) {
  if (formats.length === 0) return null;

  const dynasty = formats.filter((f) => f.league_type === "dynasty");
  const redraft = formats.filter((f) => f.league_type !== "dynasty");

  return (
    <section
      aria-labelledby="format-directory-heading"
      className="mt-10 border-t border-line pt-10"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        Every format
      </p>
      <h2
        id="format-directory-heading"
        className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
      >
        Rankings built for your exact league.
      </h2>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
        Quarterback rules and scoring move the board more than anything else.
        Each format below has its own page, with values priced for those rules.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <FormatGroup
          title="Dynasty and keeper"
          formats={dynasty}
          currentSlug={currentSlug}
        />
        <FormatGroup
          title="Redraft and best ball"
          formats={redraft}
          currentSlug={currentSlug}
        />
      </div>
    </section>
  );
}

function FormatGroup({
  title,
  formats,
  currentSlug,
}: {
  title: string;
  formats: RankingFormat[];
  currentSlug: string;
}) {
  if (formats.length === 0) return null;
  const headingId = `format-group-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <h3
        id={headingId}
        className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        {title}
      </h3>
      <ul
        aria-labelledby={headingId}
        role="list"
        className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
      >
        {formats.map((format) => (
          <li key={format.slug}>
            <Link
              href={`/rankings/${format.slug}`}
              aria-current={format.slug === currentSlug ? "true" : undefined}
              className="flex min-h-11 items-center justify-between gap-4 px-4 py-3 text-sm text-ink-muted transition-colors hover:bg-base hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span className="font-medium">
                {formatPhrase(format)} rankings
              </span>
              <ArrowRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-brand-cyan"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
