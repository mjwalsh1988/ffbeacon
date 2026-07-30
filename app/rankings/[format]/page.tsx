import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  createCachedReadClient,
  createClient,
} from "@/lib/supabase/server";
import { readPosition } from "@/lib/format";
import { getActiveFormats } from "@/lib/source";
import { resolveSourceSlug } from "@/lib/preferences";
import { rankingsSeoCopy, type RankingFormat } from "@/lib/rankings-formats";
import { RankingsView } from "@/components/rankings/rankings-view";

/**
 * Per-format rankings page, e.g. /rankings/dynasty-ppr-sflex.
 *
 * Why these exist as paths. /rankings previously served all twelve formats behind
 * `?format=`, holding one fixed h1 and one title across every combination. Google saw
 * twelve URLs it could only read as near-duplicates, so at best one of them ranked and
 * queries like "dynasty superflex rankings" had nothing aimed at them. Each format now
 * has its own path, h1, title, meta description, and canonical.
 *
 * Source stays a query param and canonicalizes back to this path. A data source is a
 * reader preference, not a search intent: nobody types a source name into Google
 * alongside a format, and indexing format x source would turn twelve real pages into
 * roughly fifty duplicates, which is the problem we are undoing.
 *
 * Position also canonicalizes back here. Position-specific ranking queries are real
 * demand and probably deserve their own pages later, but that is a separate decision
 * with its own copy to write, and shipping it as an indexable facet of this page would
 * just recreate the duplication.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ format: string }>;
  searchParams: Promise<{ position?: string; source?: string; format?: string }>;
};

/**
 * Look the requested slug up among active formats. Unknown or retired slugs 404.
 *
 * Uses the cookie-free read client: format_configs is public data, and this also runs
 * from generateStaticParams at build time where there is no request to read cookies
 * from. Reaching for the cookie-backed client here fails the build outright with
 * "cookies was called outside a request scope".
 */
async function activeFormat(slug: string): Promise<RankingFormat | null> {
  const formats = await getActiveFormats(createCachedReadClient());
  const match = formats.find((f) => f.slug === slug);
  if (!match) return null;
  return match as unknown as RankingFormat;
}

/**
 * Declare the twelve format paths.
 *
 * The route is force-dynamic (the board reads cookies for source preference and
 * Discord membership), so this prerenders nothing. It exists so the routes are known
 * at build time and appear in the build manifest.
 */
export async function generateStaticParams() {
  const formats = await getActiveFormats(createCachedReadClient());
  return formats.map((f) => ({ format: f.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { format: slug } = await params;
  const format = await activeFormat(slug);
  if (!format) return { title: "Rankings format not found" };

  const copy = rankingsSeoCopy(format);
  return {
    title: copy.title,
    description: copy.description,
    // Canonical drops every query param, so ?source= and ?position= variants
    // consolidate here instead of competing with this page.
    alternates: { canonical: `/rankings/${format.slug}` },
    openGraph: {
      title: copy.title,
      description: copy.description,
      url: `/rankings/${format.slug}`,
      type: "website",
    },
  };
}

export default async function FormatRankingsPage({
  params,
  searchParams,
}: PageProps) {
  const [{ format: slug }, query] = await Promise.all([params, searchParams]);

  // The header's format dropdown pushes `${pathname}?format=<slug>` (see
  // components/format-toggle.tsx), which on this route would put two formats in one
  // URL. Redirect to the path for the format the reader picked, so the dropdown keeps
  // working and a format never has two addresses. Position and source carry over.
  if (query.format && query.format !== slug) {
    const carry = new URLSearchParams();
    if (query.position) carry.set("position", query.position);
    if (query.source) carry.set("source", query.source);
    const suffix = carry.toString() ? `?${carry.toString()}` : "";
    redirect(`/rankings/${query.format}${suffix}`);
  }

  const format = await activeFormat(slug);
  if (!format) notFound();

  const supabase = await createClient();
  const sourceResolution = await resolveSourceSlug(supabase, query.source);
  const copy = rankingsSeoCopy(format);

  return (
    <RankingsView
      formatSlug={format.slug}
      requestedSourceSlug={sourceResolution.slug}
      position={readPosition(query.position)}
      basePath={`/rankings/${format.slug}`}
      hasActiveFilter={Boolean(query.position || query.source)}
      eyebrow="Rankings"
      headline={
        <>
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            {copy.headline}
          </span>
        </>
      }
      headlineLabel={copy.headline}
      intro={copy.intro}
    />
  );
}
