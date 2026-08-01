import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ListTree } from "lucide-react";
import { SITE } from "@/lib/site";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { BriefBreadcrumb } from "@/components/beacon-brief/brief-breadcrumb";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import {
  GLOSSARY_FAQS,
  GLOSSARY_SECTIONS,
  TERM_COUNT,
  type GlossarySection,
  type GlossaryTerm,
} from "@/lib/guides/fantasy-football-terms";
import { findPublishedGuide } from "@/lib/guides/published";

/**
 * /guides/fantasy-football-terms
 *
 * The first published FF Beacon guide, and the site's glossary pillar page.
 *
 * SEO SHAPE, and why each piece is here.
 *
 *  - URL. `/guides/fantasy-football-terms` matches the phrase people actually
 *    type. It carries no year and no season, because a glossary does not expire
 *    and a dated URL would have to be redirected every August.
 *  - Headings. One h1, an h2 per section, an h3 per term, no skipped levels. Every
 *    term h3 owns a stable id, so any single definition is directly linkable and a
 *    search engine can deep-link a result to the exact definition it quoted.
 *  - Structured data, four blocks:
 *      Article        the page itself, with a named Person author.
 *      BreadcrumbList home > guides > this page.
 *      DefinedTermSet one DefinedTerm per glossary entry. This is the schema type
 *                     built for glossaries, and it is what lets an answer engine
 *                     lift a single definition with attribution rather than
 *                     scraping the whole page.
 *      FAQPage        the visible question section, verbatim. Google narrowed FAQ
 *                     rich results in 2023, but the markup is still read by other
 *                     engines and by LLM crawlers, and it costs nothing to be
 *                     precise about which text answers which question.
 *    All four are emitted through serializeJsonLd (FFB-SEC-006), never raw
 *    JSON.stringify.
 *  - Static. No data fetching in the body, so the whole page prerenders.
 *
 * The copy lives in lib/guides/fantasy-football-terms.ts. Everything visible here
 * is rendered from that array, which is also what feeds the DefinedTermSet, so the
 * structured data cannot describe definitions the page does not show.
 */

const SLUG = "fantasy-football-terms";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

/**
 * Publication dates come from lib/guides/published.ts, the same register the
 * sitemap and llms.txt read, so the Article schema here and the lastModified in
 * sitemap.xml can never disagree. They are hand-edited constants rather than a
 * build timestamp; see that file for why.
 */
const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-08-01T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Fantasy Football Terms: A Plain-English Glossary";
const DESCRIPTION = `What PPR, superflex, FAAB, ADP, and ${TERM_COUNT - 4} more fantasy football terms actually mean, defined in plain English by a manager of 20 seasons.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "fantasy football terms",
    "fantasy football glossary",
    "fantasy football abbreviations",
    "fantasy football lingo",
    "what does PPR mean",
    "superflex meaning",
    "FAAB meaning",
    "dynasty fantasy football terms",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
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

/** Flatten a term's paragraphs into the one-string description schema expects. */
function termDescription(term: GlossaryTerm): string {
  return term.body.join(" ");
}

export default async function FantasyFootballTermsGuide() {
  const isMember = await isDiscordMember();

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
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}/img/ff-beacon-logo.png`,
        },
      },
      image: [
        { "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 },
      ],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "Fantasy football" },
      keywords:
        "fantasy football terms, fantasy football glossary, fantasy football abbreviations, PPR, superflex, FAAB, ADP, dynasty",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        {
          "@type": "ListItem",
          position: 2,
          name: "Guides",
          item: `${SITE.url}/guides`,
        },
        { "@type": "ListItem", position: 3, name: TITLE, item: CANONICAL },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "DefinedTermSet",
      "@id": `${CANONICAL}#glossary`,
      name: "FF Beacon fantasy football glossary",
      description: `Definitions for ${TERM_COUNT} fantasy football terms, covering scoring, league formats, drafting, in-season management, trades, and analytics.`,
      url: CANONICAL,
      inLanguage: "en-US",
      hasDefinedTerm: GLOSSARY_SECTIONS.flatMap((section) =>
        section.terms.map((term) => ({
          "@type": "DefinedTerm",
          "@id": `${CANONICAL}#${term.id}`,
          name: term.term,
          ...(term.aka ? { alternateName: term.aka } : {}),
          description: termDescription(term),
          termCode: term.id,
          inDefinedTermSet: `${CANONICAL}#glossary`,
          url: `${CANONICAL}#${term.id}`,
        })),
      ),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: GLOSSARY_FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <BriefBreadcrumb
          crumbs={[
            { label: "FF Beacon", href: "/" },
            { label: "Guides", href: "/guides" },
            { label: "Fantasy football terms" },
          ]}
          className="mb-6"
        />

        <article>
          <GuideHeader />
          <TheShortVersion />
          <Intro />
          <JumpNav />

          <div className="text-[15px] sm:text-base">
            {GLOSSARY_SECTIONS.map((section) => (
              <TermSection key={section.id} section={section} />
            ))}
            <FaqSection />
            <Closing />
          </div>
        </article>
      </div>

      <DiscordCtaSection
        eyebrow="Still stuck on a word?"
        heading="Ask a real person, free."
        body="If something here still doesn't click, our Discord is full of fantasy players who will explain it without making you feel new. No paywall, no gatekeeping, no bad questions."
        isMember={isMember}
        memberHeading="You know the words. Go use them."
        memberBody="You're already in the crew, so you've got the community covered. Put the vocabulary to work: the rankings board, the trade analyzer, and the rest of the toolkit are free and live."
        memberCtaHref="/rankings"
        memberCtaLabel="Open the rankings board"
      />
    </main>
  );
}

/* ---------- Header ---------- */

function GuideHeader() {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
          Guide
        </span>
        <time dateTime={PUBLISHED_AT} className="text-xs text-ink-subtle">
          {formatEasternDate(PUBLISHED_AT)}
        </time>
        <span className="text-xs text-ink-subtle">
          {TERM_COUNT} terms defined
        </span>
      </div>

      {/* aria-label collapses the gradient-split headline into one accessible
          name, matching the pattern used on the other hero headings. */}
      <h1
        aria-label="Fantasy football terms, explained in plain English"
        className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl"
      >
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
          }}
        >
          Fantasy football terms
        </span>
        , explained in plain English
      </h1>

      <p className="mt-3 text-xs text-ink-subtle">
        By{" "}
        <Link
          rel="author"
          href={SITE.author.bylineHref}
          className="font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {SITE.author.name}
        </Link>
      </p>
    </header>
  );
}

/* ---------- Summary card ---------- */

/** Gradient-bordered summary, mirroring the Beacon Brief "gist" card. */
function TheShortVersion() {
  return (
    <aside
      aria-label="Summary"
      className="mt-6 rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div
        className="rounded-card p-4 sm:p-5"
        style={{ background: "#16162A" }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#22D3EE" }}
        >
          The short version
        </p>
        <p
          className="mt-2 text-[15px] leading-relaxed sm:text-base"
          style={{ color: "#F4F4F8" }}
        >
          Fantasy football runs on roughly a hundred words that do real work,
          and nobody hands you the list. Here are all {TERM_COUNT} of them. Each
          one is defined in a single sentence first, then explained properly,
          and they are grouped by where you actually run into them: scoring,
          formats, your roster, the draft, the season, trades, and the analytics
          people quote at you.
        </p>
      </div>
    </aside>
  );
}

/* ---------- Intro ---------- */

function Intro() {
  return (
    <section aria-labelledby="intro-heading" className="mt-8">
      <h2
        id="intro-heading"
        className="scroll-mt-24 text-2xl font-semibold tracking-tight text-ink"
      >
        Why a glossary is the first guide we published
      </h2>
      <div className="text-[15px] sm:text-base">
        <p className="my-4 leading-relaxed text-ink-muted">
          I have played fantasy football since 2006, and in those first couple
          of seasons I spent a lot of time nodding along to words I could not
          have defined. Nobody in a league chat stops to explain what aDOT is.
          They just say it, and you either look it up later or you quietly stop
          reading that analyst.
        </p>
        <p className="my-4 leading-relaxed text-ink-muted">
          That gap is a real barrier, and it is worse if you are getting your
          fantasy information by ear. Half the explanations out there are a
          chart with no alt text or a screenshot of a spreadsheet. So the first
          thing I wanted on this site was a glossary that reads the same whether
          you see it or hear it: no images carrying meaning, no tables you have
          to navigate cell by cell, every definition a plain sentence.
        </p>
        <p className="my-4 leading-relaxed text-ink-muted">
          Two notes before you dive in. First, you do not need all of this. Learn
          your league&apos;s scoring and your lineup slots, and you can play a
          full season without the rest. Second, when a definition points at
          something on this site, the link goes straight to it, so you can see
          the term doing its job instead of taking my word for it.
        </p>
      </div>
    </section>
  );
}

/* ---------- Jump navigation ---------- */

function JumpNav() {
  return (
    <nav
      aria-labelledby="toc-heading"
      className="mt-8 rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <h2
        id="toc-heading"
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink"
      >
        <ListTree aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Jump to a section
      </h2>
      <ol role="list" className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {GLOSSARY_SECTIONS.map((section, i) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="flex min-h-11 items-center gap-2 text-[15px] text-ink-muted underline-offset-2 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="font-mono text-xs tabular-nums text-ink-subtle"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{section.navLabel}</span>
              <span className="text-xs text-ink-subtle">
                ({section.terms.length})
              </span>
            </a>
          </li>
        ))}
        <li>
          <a
            href="#faq"
            className="flex min-h-11 items-center gap-2 text-[15px] text-ink-muted underline-offset-2 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span
              aria-hidden="true"
              className="font-mono text-xs tabular-nums text-ink-subtle"
            >
              {String(GLOSSARY_SECTIONS.length + 1).padStart(2, "0")}
            </span>
            <span>Common questions</span>
            <span className="text-xs text-ink-subtle">
              ({GLOSSARY_FAQS.length})
            </span>
          </a>
        </li>
      </ol>
    </nav>
  );
}

/* ---------- Sections and terms ---------- */

function TermSection({ section }: { section: GlossarySection }) {
  return (
    <section aria-labelledby={section.id} className="mt-12 first:mt-10">
      <h2
        id={section.id}
        className="scroll-mt-24 text-2xl font-semibold tracking-tight text-ink"
      >
        {section.title}
      </h2>
      <p className="mt-2 leading-relaxed text-ink-muted">{section.intro}</p>
      {/* A hairline under the section intro, so the eye (and a magnified view)
          can tell where one group of terms ends and the next begins. */}
      <span
        aria-hidden="true"
        className="mt-4 block h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, #A855F7 0%, #22D3EE 45%, transparent 100%)",
        }}
      />
      {section.terms.map((term) => (
        <TermEntry key={term.id} term={term} />
      ))}
    </section>
  );
}

function TermEntry({ term }: { term: GlossaryTerm }) {
  return (
    <div className="mt-6">
      <h3
        id={term.id}
        className="scroll-mt-24 text-xl font-semibold tracking-tight text-ink"
      >
        {term.term}
        {term.aka && (
          <span className="ml-2 text-sm font-normal text-ink-subtle">
            ({term.aka})
          </span>
        )}
      </h3>
      {term.body.map((paragraph, i) => (
        <p key={i} className="my-3 leading-relaxed text-ink-muted">
          {paragraph}
        </p>
      ))}
      {term.link && (
        <p className="my-3">
          <Link
            href={term.link.href}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {term.link.label}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </p>
      )}
    </div>
  );
}

/* ---------- FAQ ---------- */

function FaqSection() {
  return (
    <section aria-labelledby="faq" className="mt-12">
      <h2
        id="faq"
        className="scroll-mt-24 text-2xl font-semibold tracking-tight text-ink"
      >
        Common questions
      </h2>
      <p className="mt-2 leading-relaxed text-ink-muted">
        The questions that come up most often in our Discord, answered in full.
      </p>
      {GLOSSARY_FAQS.map((faq) => (
        <div key={faq.question} className="mt-6">
          <h3 className="scroll-mt-24 text-xl font-semibold tracking-tight text-ink">
            {faq.question}
          </h3>
          <p className="my-3 leading-relaxed text-ink-muted">{faq.answer}</p>
        </div>
      ))}
    </section>
  );
}

/* ---------- Closing ---------- */

function Closing() {
  return (
    <section aria-labelledby="closing" className="mt-12">
      <h2
        id="closing"
        className="scroll-mt-24 text-2xl font-semibold tracking-tight text-ink"
      >
        Where to put this to work
      </h2>
      <p className="my-4 leading-relaxed text-ink-muted">
        A glossary is only useful when you go use the words. The rankings board
        shows tiers, positional ranks, and seven-day movement for whichever
        format you play. Signal Check grades a trade and tells you its
        confidence. League Pulse reads your actual Sleeper league and scores
        every team in it. All free, all built to work by keyboard and by screen
        reader.
      </p>
      <ul role="list" className="my-4 space-y-2">
        <ClosingLink
          href="/rankings"
          label="Rankings board"
          detail="Values, tiers, and trends for every format we support"
        />
        <ClosingLink
          href="/tools/signal-check"
          label="Signal Check"
          detail="Grade a trade and get the Beacon Verdict"
        />
        <ClosingLink
          href="/tools/league-pulse"
          label="Sleeper League Pulse"
          detail="Sync a league and read every roster in it"
        />
        <ClosingLink
          href="/brief"
          label="The Beacon Brief"
          detail="NFL news with the roster impact stated plainly"
        />
      </ul>
      <p className="my-4 leading-relaxed text-ink-muted">
        Spotted a term we missed, or a definition that reads wrong to you? The
        Signal Guide panel on any page takes questions, and they land in front
        of a human. That is how this list grows.
      </p>
    </section>
  );
}

function ClosingLink({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">
            {label}
          </span>
          <span className="block text-sm text-ink-muted">{detail}</span>
        </span>
        <ArrowRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-brand-cyan transition-transform motion-safe:group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}
