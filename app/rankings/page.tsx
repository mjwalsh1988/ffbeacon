import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveFormats } from "@/lib/source";
import { resolveFormatSlug } from "@/lib/preferences";
import { formatPhrase, type RankingFormat } from "@/lib/rankings-formats";
import { rankingsBoardQuery, wantsRankingsHub } from "@/lib/rankings-hub";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";

/**
 * /rankings, the hub.
 *
 * Owner decision, 2026-09-11 (docs/seo-audit/seo-audit-and-plan.md, finding D04):
 * this page is a directory for choosing a format, UNLESS the reader already has one
 * saved, in which case it takes them straight to that format's board. It used to
 * render the full board for the resolved format, which for every visitor without a
 * cookie (search engines included) was the same 500 rows /rankings/redraft-ppr-std
 * serves, so the two URLs competed for the same searches.
 *
 * "Saved" means the resolver found the format in the reader's account or in the
 * format cookie, the same chain every other page uses (lib/preferences.ts), so this
 * page and the rest of the site can never disagree about a reader's format. The
 * default format is not a choice and does not redirect. The redirect is a 307 from
 * redirect(): temporary, because it depends on who is asking. It is a real HTTP
 * redirect because this page has no loading.tsx above it; the board routes and their
 * loading boundary live in the (board) route group, which adds nothing to a URL. A
 * loading boundary here would flush a 200 first and turn the redirect into a meta
 * refresh (finding A04).
 *
 * `?view=formats` shows the hub even to a reader with a saved format
 * (lib/rankings-hub.ts), so the breadcrumb on a format page can lead back here.
 * `?format=` never reaches this page: middleware turns it into a 308 to the format's
 * own path (lib/rankings-format-redirect.ts). `?source=` and `?position=` are carried
 * onto the board, and onto every format link below.
 *
 * The title and h1 are unchanged: they changed on 2026-09-10 and the plan freezes
 * them until the 2026-09-25 checkpoint. The description is the one exception: the
 * old one promised a player list on this page, which stopped being true when the
 * page became a hub, and Google does not rank on descriptions.
 *
 * CACHING CONTRACT. The redirect depends on who is asking, so this page must never
 * be served from a shared cache to a reader with a saved format. The plan's static
 * twin work (finding A01) keeps any request carrying the format cookie or a session
 * cookie on this dynamic page; that list of cookies must keep including
 * `ffbeacon.format` (FORMAT_COOKIE in lib/preferences.ts) for as long as this
 * redirect lives here.
 */

const HUB_DESCRIPTION =
  "Fantasy football rankings for every format: redraft, dynasty, superflex, TE premium and best ball. Pick yours to see every player ranked, updated daily.";

export const metadata: Metadata = {
  alternates: { canonical: "/rankings" },
  title: "Fantasy Football Rankings",
  description: HUB_DESCRIPTION,
  ...pageShareMetadata({
    key: "rankings",
    title: "Fantasy Football Rankings",
    description: HUB_DESCRIPTION,
    path: "/rankings",
  }),
};

export const dynamic = "force-dynamic";

type HubSearchParams = {
  view?: string | string[];
  source?: string | string[];
  position?: string | string[];
};

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<HubSearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [formatResolution, activeFormats] = await Promise.all([
    // No URL argument: a ?format= never gets here (see above), and the question
    // is only whether the reader has a format saved.
    resolveFormatSlug(supabase, undefined),
    getActiveFormats(supabase),
  ]);
  const formats = activeFormats as unknown as RankingFormat[];

  const hasSavedFormat =
    formatResolution.origin === "db" || formatResolution.origin === "cookie";
  // Only an active format redirects. A saved slug for a format that has since been
  // retired leaves the reader on the hub rather than sending them to a 404.
  const savedFormat = hasSavedFormat
    ? (formats.find((f) => f.slug === formatResolution.slug) ?? null)
    : null;
  const boardQuery = rankingsBoardQuery(params);

  if (savedFormat && !wantsRankingsHub(params.view)) {
    redirect(`/rankings/${savedFormat.slug}${boardQuery}`);
  }

  return (
    <main id="main">
      <PageBody>
        <PageMasthead
          eyebrow="Rankings"
          title="Fantasy football player rankings for every format."
          description="Pick your league's format to see every player ranked for its scoring, with the seven-day move beside each one. Every format has its own board, rebuilt nightly."
        />
        <FormatDirectory
          formats={formats}
          currentSlug={savedFormat?.slug ?? null}
          linkQuery={boardQuery}
        />
        <ChoosingAFormat />
      </PageBody>
    </main>
  );
}

/**
 * Browse-by-format grid, now the page's main content.
 *
 * This is the internal linking that makes the per-format pages reachable in one hop.
 * Every active format gets a real link carrying the format name as its anchor text.
 * The reader's saved format, when they asked for the hub anyway, is marked current.
 */
function FormatDirectory({
  formats,
  currentSlug,
  linkQuery,
}: {
  formats: RankingFormat[];
  currentSlug: string | null;
  linkQuery: string;
}) {
  if (formats.length === 0) return null;

  const dynasty = formats.filter((f) => f.league_type === "dynasty");
  const redraft = formats.filter((f) => f.league_type !== "dynasty");

  return (
    <section
      aria-labelledby="format-directory-heading"
      className="mt-10 border-t border-line pt-10"
    >
      <h2
        id="format-directory-heading"
        className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
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
          linkQuery={linkQuery}
        />
        <FormatGroup
          title="Redraft and best ball"
          formats={redraft}
          currentSlug={currentSlug}
          linkQuery={linkQuery}
        />
      </div>
    </section>
  );
}

function FormatGroup({
  title,
  formats,
  currentSlug,
  linkQuery,
}: {
  title: string;
  formats: RankingFormat[];
  currentSlug: string | null;
  linkQuery: string;
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
              href={`/rankings/${format.slug}${linkQuery}`}
              aria-current={format.slug === currentSlug ? "true" : undefined}
              className="flex min-h-11 items-center justify-between gap-4 px-4 py-3 text-sm text-ink-muted transition-colors hover:bg-base hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span className="font-medium">
                {formatPhrase(format)} rankings
                {format.slug === currentSlug ? (
                  <span className="ml-2 text-xs text-brand-cyan">
                    (your format)
                  </span>
                ) : null}
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

/**
 * Plain-English help for a reader who is not sure which format their league is.
 * Definitions only: nothing here claims how the rankings are computed, which is the
 * methodology guide's job, and it is linked rather than restated.
 */
function ChoosingAFormat() {
  return (
    <section
      aria-labelledby="choosing-a-format-heading"
      className="mt-12 max-w-3xl border-t border-line pt-10"
    >
      <h2
        id="choosing-a-format-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Which format is my league?
      </h2>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-ink-muted">
        <p>
          <strong className="font-semibold text-ink">Redraft, dynasty or best ball.</strong>{" "}
          A redraft league drafts a new team every season. A dynasty league keeps
          its rosters from one season to the next. In best ball there are no
          weekly lineups to set: your highest scorers count automatically.
        </p>
        <p>
          <strong className="font-semibold text-ink">1QB or superflex.</strong>{" "}
          A superflex league has one lineup spot that can take a quarterback, so
          most teams start two, and quarterbacks are worth far more.
        </p>
        <p>
          <strong className="font-semibold text-ink">PPR and TE premium.</strong>{" "}
          PPR gives a point for every catch. TE premium adds extra points for
          catches by tight ends.
        </p>
        <p>
          If you have picked a format before, Rankings opens straight on that
          board. This page stays here whenever you want to switch. For how the
          values and ranks are worked out, read{" "}
          <Link
            href="/guides/how-ff-beacon-works"
            className="font-semibold text-ink underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            how FF Beacon works
          </Link>
          , and for any term you do not know, the{" "}
          <Link
            href="/guides/fantasy-football-terms"
            className="font-semibold text-ink underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            fantasy football terms guide
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
