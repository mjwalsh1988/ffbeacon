import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { pageShareMetadata } from "@/lib/page-og";
import { SITE } from "@/lib/site";
import { loadRelayBySlug, loadRelayChain, loadRelayStatusBySlug } from "@/lib/relays/load";
import { RelayCard } from "@/components/relays/relay-card";
import { RelayChain } from "@/components/relays/relay-chain";
import { PageBody } from "@/components/app-shell/page-body";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * /brief/relay/[slug]: the permalink for one Relay.
 *
 * Exists for Discord, sharing and the Brief's inline links. Always noindex,
 * follow, not behind the master switch and never in a sitemap: a Relay is a
 * structured record of one report, and the page that earns an index entry is
 * the weekly Brief that covers it. Canonical is itself. The share image is the
 * generic Brief card; no per-Relay image route is built.
 *
 * A retracted Relay renders a one-line page saying the report was withdrawn,
 * at 200 and noindex. It is NOT a 410: an App Router page cannot set one (the
 * deviation and the reason are recorded in plan section 22), and the noindex
 * removes the URL from search just as a 410 would.
 */

/**
 * One load per request, shared by generateMetadata and the page.
 *
 * Next calls the two separately for a single request, and `loadRelayBySlug`
 * hydrates the card with four batched reads behind it, so an unmemoised load
 * doubled the whole cost of the page. The client is built inside, for the same
 * reason app/brief/[slug]/page.tsx builds its own: a cache() key is its
 * arguments, and a client instance is not one.
 */
const getRelay = cache(async (slug: string) => loadRelayBySlug(await createClient(), slug));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const relay = await getRelay(slug);
  const title = relay ? relay.headline : "Report";
  const description = relay
    ? `Reported by @${relay.sourceHandle.replace(/^@/, "")}. ${relay.facts.map((f) => `${f.label}: ${f.value}`).join(". ")}`.trim()
    : "A Beacon Brief report.";
  return {
    title: { absolute: `${title} | The Beacon Brief` },
    description: description.slice(0, 160),
    alternates: { canonical: `${SITE.url}/brief/relay/${slug}` },
    robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
    ...pageShareMetadata({ key: "brief", title, description: description.slice(0, 160), path: `/brief/relay/${slug}` }),
  };
}

export default async function RelayPermalinkPage({ params }: PageProps) {
  const { slug } = await params;
  if (!slug || slug.length > 120 || !/^[a-z0-9-]+$/.test(slug)) notFound();

  const supabase = await createClient();
  const relay = await getRelay(slug);

  if (!relay) {
    const status = await loadRelayStatusBySlug(createAdminClient(), slug);
    if (status === "retracted") {
      return (
        <main id="main">
          <PageBody>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">This report was retracted</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
              The original report was removed by its author, so it is no longer shown here.
            </p>
            <Link
              href="/brief"
              className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to The Beacon Brief
            </Link>
          </PageBody>
        </main>
      );
    }
    notFound();
  }

  const chain = await loadRelayChain(supabase, relay);

  return (
    <main id="main">
      <SetBreadcrumbLabel value={relay.headline} />
      <PageBody>
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            The Beacon Brief, one report
          </p>
          {/* The card headline IS the page title, so it is the h1 itself. An
              sr-only h1 after the card said the headline a second time and put
              the document's first heading below an h2. */}
          <RelayCard relay={relay} headingLevel={1} isPermalinkPage />
          <RelayChain earlier={chain.earlier} later={chain.later} />
          <div className="mt-10">
            <Link
              href="/brief"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              All reports
            </Link>
          </div>
        </div>
      </PageBody>
    </main>
  );
}
