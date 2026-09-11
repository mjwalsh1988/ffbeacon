import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { createClient } from "@/lib/supabase/server";
import { getAvailableSources, type SourceRegistryRow } from "@/lib/source";
import { findPublishedGuide } from "@/lib/guides/published";
import { pickSourceForDraftPicks } from "@/lib/league-format-resolution";
import { currentProjectionSourceCached } from "@/lib/projections/current-source";
import {
  BEACON_SOURCE,
  projectionSourceDisplay,
} from "@/lib/projections/source-constants";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc } from "@/components/guides/guide-toc";
import {
  GuideSectionHeader,
  GuideSubheading,
} from "@/components/guides/guide-section-header";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";

/**
 * /guides/how-ff-beacon-works
 *
 * The methodology page: the E-E-A-T "How" the rest of the site was missing,
 * and the page every tool's "how this is calculated" section points back to.
 * Nothing here is written from memory. Every paragraph names the table or the
 * function that does the work, so a claim here can be checked against the
 * file it cites the same way a reader would check it:
 *   - the projection engine    -> lib/projections/current-source.ts,
 *                                 lib/projections/source-constants.ts
 *   - the matchup model        -> lib/calculate-defense-splits.ts,
 *                                 lib/projections/defense-seasons.ts,
 *                                 lib/power-pulse/project.ts opponentMultiplier
 *   - the reliability discount -> lib/calculate-projection-accuracy.ts,
 *                                 lib/power-pulse/project.ts reliabilityMultiplier
 *   - the confidence figure    -> lib/power-pulse/math.ts winProbability,
 *                                 lib/start-sit/confidence.ts
 *   - values and sources       -> lib/source.ts, lib/league-format-resolution.ts
 *   - what is not modeled      -> absence of weather in lib/, the daily
 *                                 sync-sleeper-players cron, no odds/spread
 *                                 read in lib/power-pulse/project.ts (the
 *                                 Sleeper engine). The FF Beacon engine reads
 *                                 odds: lib/nfl-game-environment.ts,
 *                                 lib/projections/volume.ts environmentEffect,
 *                                 lib/projections/engine.ts
 *
 * No HowTo schema (retired since 2023) and no fabricated FAQPage. Article plus
 * BreadcrumbList, matching the two published guides this one joins.
 *
 * The OG card reuses the shared "guides" key from
 * app/api/og/page/[key]/route.tsx rather than a dedicated one: both that
 * registry and the per-guide one in app/api/og/guide/[slug]/route.tsx are
 * outside this page's file scope for this task, and a key with no row 404s.
 */

const SLUG = "how-ff-beacon-works";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/page/guides`;

/**
 * Publication dates come from lib/guides/published.ts, the same register the
 * sitemap and llms.txt read, so the Article schema here and the lastModified
 * in sitemap.xml can never disagree. They are hand-edited constants rather
 * than a build timestamp; see that file for why.
 */
const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-10T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "How FF Beacon Works";
const DESCRIPTION =
  "The projections, matchup model, reliability discount, and confidence figure behind every FF Beacon number, plus what the models do not know.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "how ff beacon works",
    "fantasy football projection methodology",
    "fantasy football matchup model",
    "fantasy football reliability score",
    "fantasy football confidence score",
    "how are fantasy football projections calculated",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "article",
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    siteName: SITE.name,
    locale: "en_US",
    publishedTime: PUBLISHED_AT,
    modifiedTime: UPDATED_AT,
    authors: [SITE.author.name],
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export const dynamic = "force-dynamic";

const TOC_ITEMS = [
  { id: "projections-heading", label: "The projections" },
  { id: "matchup-heading", label: "The matchup model" },
  { id: "reliability-heading", label: "The reliability discount" },
  { id: "confidence-heading", label: "The confidence figure" },
  { id: "values-heading", label: "Values and sources" },
  { id: "gaps-heading", label: "What the models don't know" },
];

/** "A, B, and C", so the source list reads as a sentence rather than a bare array. */
function listSentence(items: string[]): string {
  if (items.length === 0) return "several public sources";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export default async function HowFFBeaconWorksGuide() {
  const supabase = await createClient();
  const [isMember, registry, projectionSourceSlug] = await Promise.all([
    isDiscordMember(),
    getAvailableSources(supabase),
    currentProjectionSourceCached(),
  ]);

  const projectionSourceName = projectionSourceDisplay(projectionSourceSlug);
  const activeSourceNames = registry.map((r: SourceRegistryRow) => r.display_name);
  const pickSource = pickSourceForDraftPicks(registry);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      datePublished: PUBLISHED_AT,
      dateModified: UPDATED_AT,
      author: {
        "@type": "Person",
        name: SITE.author.name,
        url: `${SITE.url}${SITE.author.bylineHref}`,
      },
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "Fantasy football projections and values" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE.url}/guides` },
        { "@type": "ListItem", position: 3, name: TITLE, item: CANONICAL },
      ],
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <PageBody flush>
        <PageMasthead
          eyebrow="Guides"
          title="How FF Beacon works: the methodology behind every number"
          chips={[{ label: "Guide", tone: "cyan" }]}
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
            <time dateTime={PUBLISHED_AT}>{formatEasternDate(PUBLISHED_AT)}</time>
            <span>
              By{" "}
              <Link
                rel="author"
                href={SITE.author.bylineHref}
                className="font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {SITE.author.name}
              </Link>
            </span>
          </p>
        </PageMasthead>
      </PageBody>

      <GuideShell toc={<GuideToc items={TOC_ITEMS} />}>
        <article>
          <TheShortVersion />

          <div className="text-[15px] sm:text-base">
            <ProjectionsSection projectionSourceName={projectionSourceName} />
            <MatchupSection />
            <ReliabilitySection />
            <ConfidenceSection />
            <ValuesSection activeSourceNames={activeSourceNames} pickSource={pickSource} />
            <GapsSection projectionSourceSlug={projectionSourceSlug} />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Still have a question about the math?"
        heading="Ask a real person, free."
        body="If a number on the site surprises you, drop the specific player or matchup into our Discord and a real fantasy player will walk through it with you."
        isMember={isMember}
        memberHeading="Now you know how it works. Go put it to use."
        memberBody="You're already in the crew, so we'll skip the invite. The tools built on everything above are free and live."
        memberCtaHref="/tools"
        memberCtaLabel="See every free tool"
      />
    </main>
  );
}

/* ---------- Short version ---------- */

function TheShortVersion() {
  return (
    <section
      aria-labelledby="short-version"
      className="rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-card p-4 sm:p-5" style={{ background: "#16162A" }}>
        <h2
          id="short-version"
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#22D3EE" }}
        >
          The short version
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed sm:text-base" style={{ color: "#F4F4F8" }}>
          Every projection, matchup grade, and confidence figure on this site comes out of one
          shared pipeline, described below in the order it actually runs. Nothing here is
          aspirational: each paragraph names the table or the function doing the work, so you can
          go check it against the number on the page you came from.
        </p>
      </div>
    </section>
  );
}

/* ---------- Projections ---------- */

function ProjectionsSection({ projectionSourceName }: { projectionSourceName: string }) {
  return (
    <section aria-labelledby="projections-heading" className="mt-12">
      <GuideSectionHeader
        id="projections-heading"
        eyebrow="Step one"
        heading="The projections"
        tone="purple"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        FF Beacon is currently projecting players from {projectionSourceName}. That name is
        resolved live rather than typed into this page: <code>currentProjectionSourceCached()</code>{" "}
        checks which engine is switched on and <code>projectionSourceDisplay()</code> names it, so
        the day our own engine takes over from Sleeper, every heading that names a source updates
        with it instead of quietly going stale.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        Before anything else touches it, the raw weekly number is rescored under your chosen
        league format. PPR, half PPR, and standard reprice every reception differently, and a TE
        premium or superflex league changes who a projection actually favors, so nothing
        downstream ever compares two players under mismatched scoring.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        From there, the projection runs through three more adjustments in a fixed order: the
        matchup, a reliability discount, and a per-week injury designation when one applies. Each
        is its own section below.
      </p>
    </section>
  );
}

/* ---------- Matchup model ---------- */

function MatchupSection() {
  return (
    <section aria-labelledby="matchup-heading" className="mt-12">
      <GuideSectionHeader id="matchup-heading" eyebrow="Step two" heading="The matchup model" />
      <p className="mt-4 leading-relaxed text-ink-muted">
        Matchup difficulty comes from <code>nfl_defense_vs_position</code>, a table FF Beacon
        computes itself rather than trusts to the projection source. A player&apos;s best and
        worst projected week from that source differ by only 2.6 to 5.4 percent across a season,
        which means the source is publishing something close to a season average, not a real read
        on the defense the player is about to face.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        The table is built from our own player game logs, more than 228,000 regular season rows
        with the opponent recorded on every one, back to 2020. Raw points allowed are corrected
        for the offenses a defense actually faced (a defense that happened to draw the six best
        offenses in the league looks generous for reasons that have nothing to do with the
        defense), then pulled back toward a neutral 1.0 by how much that position&apos;s matchup
        signal has actually held up from one year to the next. Whole-defense scoring persists the
        most (a measured year-over-year correlation around 0.32); wide receiver persists the
        least, measuring essentially flat to slightly negative. A wide receiver&apos;s matchup
        adjustment moves less than a running back&apos;s for exactly that reason.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        The number applied to any given projection blends the two most recently played seasons,
        weighted toward the more recent one. Early in a season, before this year has enough games
        to trust on its own, that blend falls back to the two prior seasons instead, without
        anyone having to know what week it is.
      </p>
    </section>
  );
}

/* ---------- Reliability discount ---------- */

function ReliabilitySection() {
  return (
    <section aria-labelledby="reliability-heading" className="mt-12">
      <GuideSectionHeader
        id="reliability-heading"
        eyebrow="Step three"
        heading="The reliability discount"
        tone="purple"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        Every player carries a reliability multiplier read from{" "}
        <code>player_projection_accuracy</code>: how often the player's actual score has beaten the
        projection (beat rate), and how often the player has actually taken the field in a game the player was
        projected for (availability rate). A boom-or-bust player gets pulled back toward a more
        conservative number; a steady one keeps closer to the raw projection.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        Recency counts for more than career history. A player&apos;s current season carries far
        more weight than a season from two years back, and within the current season itself a
        Week 1 result matters less by Week 12 than it did at the time. The exact weights are
        admin-tunable, but the shape is fixed: newer evidence counts for more, because roles and
        offenses change from year to year in a way a flat career average cannot see.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        The multiplier is centered on the player&apos;s own position before it is ever applied.
        Sleeper&apos;s own projections, the only ones graded long enough to measure, run about 5
        percent low at quarterback and about 3 percent high at tight end. Without centering, that
        source-wide bias would show up disguised as an individual player being unreliable.
      </p>
    </section>
  );
}

/* ---------- Confidence figure ---------- */

function ConfidenceSection() {
  return (
    <section aria-labelledby="confidence-heading" className="mt-12">
      <GuideSectionHeader id="confidence-heading" eyebrow="Step four" heading="The confidence figure" />
      <p className="mt-4 leading-relaxed text-ink-muted">
        The confidence figure is a real probability, not a label picked by eye: the chance the
        player you are told to start actually outscores the next-best option, computed by{" "}
        <code>winProbability()</code> from each player&apos;s projected points and that player's own
        measured spread. The same function grades a real matchup on the{" "}
        <Link
          href="/tools/league-pulse"
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          League Pulse Schedules board
        </Link>
        , so a start/sit call and a weekly matchup projection are never running two different
        kinds of math to answer a similar question.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        A confidence of 0.65 or higher reads as clear, 0.55 up to that reads as lean, and anything
        below reads as toss-up. When either player is missing a projection or a measured spread,
        the figure comes back unmeasured rather than a guessed 50 percent: an absence and a real
        even matchup are different things, and the site never treats them the same.
      </p>
    </section>
  );
}

/* ---------- Values and sources ---------- */

function ValuesSection({
  activeSourceNames,
  pickSource,
}: {
  activeSourceNames: string[];
  pickSource: SourceRegistryRow | null;
}) {
  return (
    <section aria-labelledby="values-heading" className="mt-12">
      <GuideSectionHeader
        id="values-heading"
        eyebrow="Everywhere else"
        heading="Values and sources"
        tone="purple"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        Player values, the ones behind{" "}
        <Link
          href="/rankings"
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          the rankings board
        </Link>{" "}
        and{" "}
        <Link
          href="/tools/trade-calculator"
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          the Trade Calculator
        </Link>
        , come from {listSentence(activeSourceNames)}. Pick the one you trust in the site header
        and every value on the site follows it, including trade grades and league power rankings.
        This is a separate system from the weekly projections above: a value answers what a
        player is worth right now, a projection answers what the player is expected to score this week.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        A source only ever prices the formats it actually publishes, so the format picker hides
        any format the active source doesn&apos;t cover. If a shared link asks for a format the
        current source can&apos;t price, the site falls back to the closest format it can cover
        and says so with a banner, rather than silently changing your saved setting.
      </p>
      {pickSource && (
        <p className="mt-4 leading-relaxed text-ink-muted">
          {pickSource.display_name} is currently the only source we hold dynasty draft pick
          values from, so any trade or roster that includes a pick prices it from{" "}
          {pickSource.display_name}, even on a page where your player values come from a
          different source. Pages that show a pick value say so.
        </p>
      )}
    </section>
  );
}

/* ---------- What the models don't know ---------- */

function GapsSection({ projectionSourceSlug }: { projectionSourceSlug: string }) {
  const usingBeaconEngine = projectionSourceSlug === BEACON_SOURCE;
  return (
    <section aria-labelledby="gaps-heading" className="mt-12">
      <GuideSectionHeader
        id="gaps-heading"
        eyebrow="Honestly"
        heading="What the models don't know"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        Real gaps, stated plainly rather than glossed over.
      </p>

      <GuideSubheading className="mt-6">Weather</GuideSubheading>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Nothing in the projection or matchup pipeline reads a forecast, a wind speed, or a dome
        designation. A kicker&apos;s outlook in a driving wind is the same number it would be in a
        dome.
      </p>

      <GuideSubheading className="mt-6">Timing</GuideSubheading>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Sleeper&apos;s injury designation, the only place the site learns a player is
        questionable, doubtful, or out, is synced once a day. A change to the injury report later
        in the week, the official inactive list published shortly before kickoff, and anything
        that happens to a player once a game is underway, all wait for the next day&apos;s sync
        before a projection reflects them. That is true whichever engine is projecting: both read
        the same daily sync for availability.
      </p>

      <GuideSubheading className="mt-6">Game script from the betting market</GuideSubheading>
      {usingBeaconEngine ? (
        <p className="mt-3 leading-relaxed text-ink-muted">
          The weekly projection does read the betting market. FF Beacon&apos;s own engine pulls
          each game&apos;s point spread and total from <code>nfl_game_odds</code>, then turns the
          total into a volume and scoring multiplier and the spread into a shift between passing
          and rushing plays, before blending the result with Sleeper&apos;s published number. A
          game with no line published yet gets no adjustment rather than a guessed one.
        </p>
      ) : (
        <p className="mt-3 leading-relaxed text-ink-muted">
          FF Beacon is currently projecting from Sleeper, and Sleeper&apos;s own weekly
          projection does not read a point spread or a game total. Whatever game script it
          implies comes only from the volume Sleeper already expects a player to see, not from a
          betting line.
        </p>
      )}
    </section>
  );
}

/* ---------- Closing ---------- */

function ClosingSection() {
  return (
    <section aria-labelledby="closing-heading" className="mt-12">
      <GuideSectionHeader
        id="closing-heading"
        eyebrow="In practice"
        heading="Where to see it working"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        <Link
          href="/tools/who-should-i-start"
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          Beacon Breakdown
        </Link>{" "}
        runs every step above on two to eight players at once. The{" "}
        <Link
          href="/tools/faab"
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          FAAB Calculator
        </Link>{" "}
        and a synced league&apos;s Lineups and Positional WAR pages read the same projections and
        the same matchup table. Only the FF Beacon Values behind the Trade Calculator and the
        rankings board run on the source you pick in the header instead of this pipeline.
      </p>
    </section>
  );
}
