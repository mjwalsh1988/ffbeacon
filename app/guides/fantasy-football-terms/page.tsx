import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Calculator,
  HeartPulse,
  ListOrdered,
  Sparkles,
  Tags,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc, type GuideTocItem } from "@/components/guides/guide-toc";
import {
  GuideSectionHeader,
  GuideSubheading,
} from "@/components/guides/guide-section-header";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import {
  ABBREVIATION_COUNT,
  ABBREVIATION_GROUPS,
  ALL_ABBREVIATIONS,
  ALL_TERMS,
  GLOSSARY_FAQS,
  GLOSSARY_SECTIONS,
  TERM_COUNT,
  buildGlossarySearchIndex,
  type AbbreviationGroup,
  type GlossaryAbbreviation,
  type GlossarySection,
  type GlossaryTerm,
} from "@/lib/guides/fantasy-football-terms";
import { findPublishedGuide } from "@/lib/guides/published";
import {
  FormatSpectrumFigure,
  LineupSlotsFigure,
  SeasonCalendarFigure,
  SnakeDraftFigure,
  TONE_CLASS,
  UsageBenchmarksFigure,
} from "./glossary-figures";
import { GlossaryFinder, ScoringSwitcher } from "./glossary-classroom";

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
 *  - What people actually search. Search Console (28 days to 2026-09-18) had
 *    this page at 2,605 impressions and 2 clicks. Almost every query was an
 *    abbreviation in the form "what does X mean in fantasy football", and most
 *    of those abbreviations were not on the page: BN, BE, Q, CEL, OPRK, PF, PA,
 *    W/R/T, FPTS. The best-placed query ("cel meaning fantasy football",
 *    position 6.7) was one the page could not answer. So the title and
 *    description now lead on abbreviations, an abbreviations section answers
 *    each one in its own words, and the FAQ carries the exact question forms.
 *  - Headings. One h1, an h2 per section, an h3 per term, figure or
 *    abbreviation group, no skipped levels. Every term and every abbreviation
 *    owns a stable id, so any single definition is directly linkable and a
 *    search engine can deep-link a result to the exact definition it quoted.
 *  - Structured data, four blocks:
 *      Article        the page itself, with a named Person author.
 *      BreadcrumbList home > guides > this page.
 *      DefinedTermSet one DefinedTerm per glossary entry, plus one per
 *                     abbreviation that has no full entry of its own (an
 *                     abbreviation that points at a term is that term's
 *                     alternate name, not a second definition).
 *      FAQPage        the visible question section, verbatim.
 *    All four are emitted through serializeJsonLd (FFB-SEC-006), never raw
 *    JSON.stringify.
 *  - Static. No data fetching in the body beyond the Discord membership check.
 *
 * VISUALS. The page used to promise "no images carrying meaning". It now has
 * diagrams, and the promise it keeps is the stronger one: every figure states
 * its point in a sentence first and carries its numbers in a real table, so it
 * reads the same by ear. The figures are in glossary-figures.tsx and the two
 * interactives (the finder and the scoring switcher) in glossary-classroom.tsx.
 *
 * The copy lives in lib/guides/fantasy-football-terms.ts. Everything visible here
 * is rendered from those arrays, which also feed the structured data, so the
 * schema cannot describe definitions the page does not show.
 */

const SLUG = "fantasy-football-terms";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

/**
 * Publication dates come from lib/guides/published.ts, the same register the
 * sitemap and llms.txt read, so the Article schema here and the lastModified in
 * sitemap.xml can never disagree.
 */
const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-08-01T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const ENTRY_COUNT = TERM_COUNT + ABBREVIATION_COUNT;

const TITLE = "Fantasy Football Terms and Abbreviations, Explained";
const DESCRIPTION = `What BN, Q, OPRK, TEP, PPR, FAAB and ${ENTRY_COUNT - 6} more fantasy football terms and abbreviations mean, each answered in one plain sentence.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "fantasy football terms",
    "fantasy football abbreviations",
    "fantasy football glossary",
    "fantasy football acronyms",
    "fantasy football terminology",
    "fantasy football lingo",
    "what does BN mean in fantasy football",
    "what does BE mean in fantasy football",
    "what does Q mean in fantasy football",
    "what does OPRK mean in fantasy football",
    "what does TEP mean in fantasy football",
    "what does CEL mean in fantasy football",
    "what does PPR mean",
    "superflex meaning",
    "FAAB meaning",
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

/** Term names by id, so an abbreviation can name the entry it points at. */
const TERM_NAME = new Map(ALL_TERMS.map((t) => [t.id, t.term]));

/** Decorative icon beside each section's eyebrow. The heading carries the meaning. */
const SECTION_ICON: Record<string, LucideIcon> = {
  scoring: Calculator,
  formats: Trophy,
  roster: Users,
  drafting: ListOrdered,
  "in-season": CalendarDays,
  trades: ArrowLeftRight,
  analytics: BarChart3,
  status: HeartPulse,
  "ff-beacon": Sparkles,
};

/** The diagram or interactive that opens a section, where one earns its place. */
const SECTION_FIGURE: Record<string, React.ReactNode> = {
  scoring: <ScoringSwitcher />,
  formats: <FormatSpectrumFigure />,
  roster: <LineupSlotsFigure />,
  drafting: <SnakeDraftFigure />,
  "in-season": <SeasonCalendarFigure />,
  analytics: <UsageBenchmarksFigure />,
};

/**
 * The rail's contents list, built from the data, so a section added to the
 * glossary appears here without anyone remembering to add it.
 */
const TOC_ITEMS: GuideTocItem[] = [
  { id: "finder-heading", label: "Find a term" },
  { id: "abbreviations", label: "Abbreviations", count: ABBREVIATION_COUNT },
  ...GLOSSARY_SECTIONS.map((section) => ({
    id: section.id,
    label: section.navLabel,
    count: section.terms.length,
  })),
  { id: "faq", label: "Common questions", count: GLOSSARY_FAQS.length },
  { id: "closing", label: "Where to put this to work" },
];

export default async function FantasyFootballTermsGuide() {
  const isMember = await isDiscordMember();
  const searchIndex = buildGlossarySearchIndex();

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
      author: authorJsonLd(),
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
        "fantasy football terms, fantasy football abbreviations, fantasy football glossary, BN, BE, Q, OPRK, TEP, PPR, superflex, FAAB, ADP, dynasty",
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
      description: `Definitions for ${TERM_COUNT} fantasy football terms and ${ABBREVIATION_COUNT} abbreviations, covering scoring, league formats, lineups, drafting, in-season management, trades, analytics and player status.`,
      url: CANONICAL,
      inLanguage: "en-US",
      hasDefinedTerm: [
        ...GLOSSARY_SECTIONS.flatMap((section) =>
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
        ...ALL_ABBREVIATIONS.filter((a) => !a.termId).map((a) => ({
          "@type": "DefinedTerm",
          "@id": `${CANONICAL}#${a.id}`,
          name: a.abbr,
          alternateName: a.stands,
          description: [a.meaning, a.more].filter(Boolean).join(" "),
          termCode: a.id,
          inDefinedTermSet: `${CANONICAL}#glossary`,
          url: `${CANONICAL}#${a.id}`,
        })),
      ],
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

      {/* The masthead spans the shell, the way every other page's does. */}
      <PageBody flush>
        <GuideHeader />
      </PageBody>

      <GuideShell toc={<GuideToc items={TOC_ITEMS} />}>
        <article>
          <TheShortVersion />

          <section aria-labelledby="finder-heading" className="mt-8">
            <h2
              id="finder-heading"
              className="scroll-mt-24 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
            >
              Find a term
            </h2>
            <div className="mt-3">
              <GlossaryFinder entries={searchIndex} />
            </div>
          </section>

          <Intro />

          <div className="text-[15px] sm:text-base">
            <AbbreviationsSection />
            {GLOSSARY_SECTIONS.map((section) => (
              <TermSection key={section.id} section={section} />
            ))}
            <FaqSection />
            <Closing />
          </div>
        </article>
      </GuideShell>

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
  const updated = UPDATED_AT !== PUBLISHED_AT;
  return (
    <PageMasthead
      eyebrow="Guides"
      title="Fantasy football terms and abbreviations, explained in plain English"
      chips={[
        { label: "Guide", tone: "cyan" },
        { label: "Glossary", tone: "purple" },
      ]}
      stats={[
        { label: "Terms defined", value: String(TERM_COUNT), accent: "cyan" },
        { label: "Abbreviations decoded", value: String(ABBREVIATION_COUNT), accent: "purple" },
      ]}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
        <time dateTime={PUBLISHED_AT}>{formatEasternDate(PUBLISHED_AT)}</time>
        {updated && (
          <span>
            Updated <time dateTime={UPDATED_AT}>{formatEasternDate(UPDATED_AT)}</time>
          </span>
        )}
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
  );
}

/* ---------- Summary card ---------- */

/** Gradient-bordered summary, mirroring the Beacon Brief "gist" card. */
function TheShortVersion() {
  return (
    <aside
      aria-label="Summary"
      // No top margin: the shell's own padding is the gap under the masthead.
      className="rounded-card p-px"
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
          Fantasy football runs on about a hundred words that do real work, plus
          a wall of letters on every lineup screen, and nobody hands you the
          list. Here are {TERM_COUNT} terms and {ABBREVIATION_COUNT}{" "}
          abbreviations. Each one is defined in a single sentence first, then
          explained properly. Looking for one word? Type it in the box below and
          jump straight to it.
        </p>
      </div>
    </aside>
  );
}

/* ---------- Intro ---------- */

function Intro() {
  return (
    <section aria-labelledby="intro-heading" className="mt-12">
      <GuideSectionHeader
        id="intro-heading"
        eyebrow="Why this exists"
        heading="Why a glossary is the first guide we published"
        tone="purple"
      />
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
          chart with no alt text or a screenshot of a spreadsheet. So this
          glossary reads the same whether you see it or hear it. Every
          definition is a plain sentence. The diagrams are there for the eye,
          and each one says its point in words first and keeps its numbers in a
          table you can open underneath it.
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

/* ---------- Abbreviations ---------- */

function AbbreviationsSection() {
  return (
    <section aria-labelledby="abbreviations" className="mt-12">
      <GuideSectionHeader
        id="abbreviations"
        eyebrow={`Decoder, ${ABBREVIATION_COUNT} abbreviations`}
        heading="Abbreviations on your league screen"
        icon={Tags}
      />
      <p className="mt-3 leading-relaxed text-ink-muted">
        This is the fast lane. Every app crams the same ideas into two or three
        letters, and most of the questions people ask about fantasy football
        are really about one of these. Where an abbreviation has a full entry
        further down, the link takes you to it.
      </p>
      {ABBREVIATION_GROUPS.map((group) => (
        <AbbreviationGroupBlock key={group.id} group={group} />
      ))}
    </section>
  );
}

function AbbreviationGroupBlock({ group }: { group: AbbreviationGroup }) {
  return (
    <div className="mt-8">
      <GuideSubheading id={group.id}>{group.title}</GuideSubheading>
      <p className="my-3 leading-relaxed text-ink-muted">{group.intro}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {group.items.map((item) => (
          <AbbreviationCard key={item.id} item={item} />
        ))}
      </dl>
    </div>
  );
}

function AbbreviationCard({ item }: { item: GlossaryAbbreviation }) {
  const tone = TONE_CLASS[item.tone ?? "muted"];
  const target = item.termId ? TERM_NAME.get(item.termId) : undefined;
  return (
    <div
      id={item.id}
      className="scroll-mt-24 flex flex-col rounded-card border border-line bg-surface/40 p-3 target:border-brand-cyan"
    >
      <dt className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex min-w-9 items-center justify-center rounded-md border px-2 py-0.5 font-mono text-sm font-bold ${tone}`}
        >
          {item.abbr}
        </span>
        {/* A spoken pause between the letters and what they stand for. */}
        <span className="sr-only">: </span>
        <span className="text-sm font-semibold text-ink">{item.stands}</span>
      </dt>
      <dd className="mt-2 text-sm leading-relaxed text-ink-muted">
        <span className="text-ink">{item.meaning}</span>
        {item.more && <> {item.more}</>}
        {item.termId && target && (
          <a
            href={`#${item.termId}`}
            className="mt-1 flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Full entry: {target}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        )}
      </dd>
    </div>
  );
}

/* ---------- Sections and terms ---------- */

function TermSection({ section }: { section: GlossarySection }) {
  const figure = SECTION_FIGURE[section.id];
  return (
    <section aria-labelledby={section.id} className="mt-12">
      {/* The beacon rule marks where a group of terms STARTS. */}
      <GuideSectionHeader
        id={section.id}
        eyebrow={`Glossary, ${section.terms.length} terms`}
        heading={section.title}
        icon={SECTION_ICON[section.id]}
      />
      <p className="mt-3 leading-relaxed text-ink-muted">{section.intro}</p>
      {figure && <div className="mt-6">{figure}</div>}
      {section.terms.map((term) => (
        <TermEntry key={term.id} term={term} />
      ))}
    </section>
  );
}

function TermEntry({ term }: { term: GlossaryTerm }) {
  const [definition, ...rest] = term.body;
  return (
    <div className="mt-8 border-l-2 border-line pl-4 sm:pl-5">
      <GuideSubheading id={term.id}>
        {term.term}
        {term.aka && (
          <span className="ml-2 text-sm font-normal text-ink-subtle">
            ({term.aka})
          </span>
        )}
      </GuideSubheading>
      {/* The first paragraph opens with the standalone definition, so it is
          set brighter than the explanation that follows it. */}
      <p className="my-3 leading-relaxed text-ink">{definition}</p>
      {rest.map((paragraph, i) => (
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
      <GuideSectionHeader
        id="faq"
        eyebrow="Questions"
        heading="Common questions"
        tone="purple"
      />
      <p className="mt-3 leading-relaxed text-ink-muted">
        The questions that come up most often, in the words people ask them,
        answered in full.
      </p>
      {GLOSSARY_FAQS.map((faq) => (
        <div key={faq.question} className="mt-6">
          <GuideSubheading>{faq.question}</GuideSubheading>
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
      <GuideSectionHeader
        id="closing"
        eyebrow="Next"
        heading="Where to put this to work"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        A glossary is only useful when you go use the words. The rankings board
        shows tiers, positional ranks, and seven-day movement for whichever
        format you play. The Signal Check trade calculator grades a trade and
        tells you its confidence. The FAAB calculator tells you what to bid on a
        waiver claim and when to walk away. League Pulse reads your actual
        Sleeper league and scores every team in it. All free, all built to work
        by keyboard and by screen reader.
      </p>
      <ul role="list" className="my-4 grid gap-2 sm:grid-cols-2">
        <ClosingLink
          href="/rankings"
          label="Rankings board"
          detail="Values, tiers, and trends for every format we support"
        />
        <ClosingLink
          href="/tools/trade-calculator"
          label="Signal Check Trade Calculator"
          detail="Grade a trade and get the Beacon Verdict"
        />
        <ClosingLink
          href="/tools/faab"
          label="FAAB Calculator"
          detail="What to bid on a waiver claim, and when to walk away"
        />
        <ClosingLink
          href="/tools/league-pulse"
          label="Sleeper League Pulse"
          detail="Sync a league and read every roster in it"
        />
      </ul>
      <p className="mt-6 leading-relaxed text-ink-muted">
        Know the words and want the strategy behind them? These guides pick up
        where the definitions stop.
      </p>
      <ul role="list" className="my-4 grid gap-2 sm:grid-cols-2">
        <ClosingLink
          href="/guides/faab-strategy"
          label="FAAB strategy"
          detail="How much to bid on the waiver wire, and when to spend it all"
        />
        <ClosingLink
          href="/guides/fantasy-football-trade-guide"
          label="Fantasy football trade guide"
          detail="How to judge any trade before you send it"
        />
        <ClosingLink
          href="/guides/superflex-strategy"
          label="Superflex strategy"
          detail="How to draft, roster and trade quarterbacks"
        />
        <ClosingLink
          href="/guides/dynasty-strategy"
          label="Dynasty strategy"
          detail="When to contend and when to rebuild"
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
        className="group flex h-full min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-4 py-3 transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
