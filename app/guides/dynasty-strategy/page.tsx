import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
import { createClient } from "@/lib/supabase/server";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  AGE_MARKET_VETERAN_AGE,
  loadDynastyAgeMarket,
  type DynastyAgeMarket,
} from "@/lib/guides/dynasty-age-market";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc } from "@/components/guides/guide-toc";
import {
  GuideSectionHeader,
  GuideSubheading,
} from "@/components/guides/guide-section-header";
import {
  FaqAccordion,
  type FaqAccordionItem,
} from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import {
  AgeMarketFigure,
  ContenderDiscountFigure,
  DynastyYearFigure,
  HitRateFigure,
  ProductionCurveFigure,
  RebuildTimelineFigure,
  StatusBandsFigure,
  ThreePathsFigure,
} from "./dynasty-figures";
import {
  AgeClock,
  DeadlineChecklist,
  LaneQuiz,
  WhichLane,
} from "./dynasty-classroom";

/**
 * /guides/dynasty-strategy
 *
 * How to run a dynasty roster over several seasons, written in Michael's first
 * person for a reader who has just realised their team is neither good enough
 * to win this year nor bad enough to get a top pick.
 *
 * WHY THIS PAGE. Search Console (90 days to 2026-09-18) shows 46 different
 * queries containing "dynasty" reaching this site, more than any other
 * non-brand cluster outside the FAAB calculator, almost all at position 30 to
 * 55, and a long tail of them are player-level "dynasty outlook" and "dynasty
 * value" searches: readers trying to decide what a player is worth to a roster
 * over several years. No page here answered the general question. The trade
 * guide grades one offer and the superflex guide covers quarterbacks; this one
 * covers the roster's whole life cycle and links to both rather than repeating
 * them. It lands in September, when the contend-or-rebuild call gets made
 * before the trade deadline. No year in the URL, because the method does not
 * expire.
 *
 * THE MECHANICAL CLAIMS ARE CHECKED AGAINST THE ENGINES. The Contender, Loaded,
 * Bubble and Rebuilder bands, their cut lines and their reasons come from
 * lib/league-team-status.ts, called directly by both the figure and the
 * interactive box rather than restated. Pick pricing by season, round and
 * early, mid or late slot is lib/signal-check/values.ts, as the trade guide
 * already says.
 *
 * THREE KINDS OF NUMBER, EACH LABELLED WHERE IT APPEARS. One figure is LIVE
 * (lib/guides/dynasty-age-market.ts, in the reader's resolved source and a
 * dynasty format matched to theirs). Some are PUBLISHED, quoted from named
 * studies that the Sources section links: 4for4 and ESPN on age curves,
 * Fantasy Life on receivers, PFF on quarterbacks, Dynasty Nerds on rookie pick
 * hit rates, Footballguys on pick timing, and Sleeper's own help centre on taxi
 * squads. Each was read at the source before it was quoted. EVERY OTHER NUMBER
 * IS INVENTED AND SAYS SO.
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders.
 */

const SLUG = "dynasty-strategy";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-18T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE =
  "Dynasty Fantasy Football Strategy: When to Contend, When to Rebuild";
const DESCRIPTION =
  "Dynasty fantasy football strategy in plain English: when to contend or rebuild, age curves, rookie pick odds, the dynasty calendar, startups and taxi squads.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "dynasty fantasy football strategy",
    "dynasty strategy",
    "dynasty rebuild",
    "contend or rebuild dynasty",
    "when to rebuild in dynasty",
    "dynasty rebuild strategy",
    "dynasty contender strategy",
    "dynasty age curve",
    "dynasty rookie draft strategy",
    "rookie pick hit rate",
    "dynasty startup strategy",
    "dynasty taxi squad",
    "dynasty trade calendar",
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

export const dynamic = "force-dynamic";

const TOC_ITEMS = [
  { id: "lane-heading", label: "Pick a lane" },
  { id: "middle-heading", label: "The middle is the trap" },
  { id: "age-heading", label: "Age is a price" },
  { id: "picks-heading", label: "Rookie picks and their odds" },
  { id: "calendar-heading", label: "The dynasty year" },
  { id: "contend-heading", label: "How to contend" },
  { id: "rebuild-heading", label: "How to rebuild" },
  { id: "roster-heading", label: "Startups, taxi and bench" },
  { id: "mistakes-heading", label: "Mistakes I see every year" },
  { id: "example-heading", label: "A worked example" },
  { id: "checklist-heading", label: "Before the deadline" },
  { id: "faq-heading", label: "Questions, answered" },
  { id: "sources-heading", label: "Sources" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "How do I know if I should rebuild in dynasty?",
    answer:
      "Look at where you rank by projected wins, not by record, and count how many of your starters would start for the best team in your league. If you are outside the range of your league's playoff field and two or fewer of your starters would start for the top team, rebuild, and do it before the trade deadline while contenders are still paying. If you are inside the playoff picture, you are not a rebuilder, whatever last week felt like.",
  },
  {
    question: "What is the worst position to be in a dynasty league?",
    answer:
      "The middle. A team that finishes sixth or seventh every year never has a real shot at the title and never picks near the top of the rookie draft, where the odds of landing a real player are far better. Picks one through four hit about 70 to 83 percent of the time in the Dynasty Nerds study of 2018 to 2023 rookie drafts; the rest of round one was closer to a coin flip. Pick a direction and commit to it.",
  },
  {
    question: "At what age should I sell a running back in dynasty?",
    answer:
      "Before he turns 27 if you are not contending, and no later than the offseason he turns 28 if you are. The studies agree running back production holds to about 28 and falls from 29, where ESPN measured a 25 percent drop in PPR points per game in a single year. The dynasty market marks backs down well before that, so the price you get at 26 is far better than the one you get at 28, even if the player is scoring the same.",
  },
  {
    question: "How long does a dynasty rebuild take?",
    answer:
      "Plan for one full season and set a date for the second. Sell the veterans at this trade deadline, use the offseason to buy young receivers and tight ends before their second-year jump, and judge the roster at next year's deadline. If five of your starters would start for the best team by then, stop collecting picks and start buying. A rebuild with no end date is just a team that has stopped trying.",
  },
  {
    question: "When are rookie picks worth the most?",
    answer:
      "Around the NFL draft and the rookie drafts in late April and May, when every manager has a name attached to every slot. Footballguys' study of KeepTradeCut prices found the best time to buy a pick is the start of the regular season in September and the best time to sell is right after the NFL draft. Picks tend to drift lower through the summer months.",
  },
  {
    question: "How do taxi squads work on Sleeper?",
    answer:
      "The commissioner sets between 0 and 10 taxi spots per team, and taxi players do not count against the roster limit. Eligibility runs by years of experience, from 1 to 4 or no maximum, with an option to allow non-rookies. A player has to be added to your bench before he can move to taxi, you can promote a player off taxi whenever you like, and after the league's taxi deadline nobody can move onto it. Sleeper does not allow other teams to poach your taxi squad.",
  },
  {
    question: "What should I do in a dynasty startup draft?",
    answer:
      "Decide your window before the first pick. If you want to contend in year one, take proven producers the room is discounting for age and build around them. If you want a younger core, take receivers and quarterbacks in their early twenties and wait on running backs, who break out early and fade early. In superflex, secure two starting quarterbacks early. Either way, draft a core whose best years overlap, rather than a mix that peaks in three different seasons.",
  },
];

export default async function DynastyGuide({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; source?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [formatResolution, sourceResolution, isMember] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
    isDiscordMember(),
  ]);
  const market = await loadDynastyAgeMarket(
    supabase,
    formatResolution.slug,
    sourceResolution.slug,
  );

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
      about: { "@type": "Thing", name: "Dynasty fantasy football strategy" },
    },
    faqPageJsonLd(FAQ),
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
          title="Dynasty strategy: when to contend, when to rebuild, and how to stop living in the middle"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Dynasty", tone: "purple" },
            { label: "8 lessons", tone: "cyan" },
          ]}
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
            <time dateTime={PUBLISHED_AT}>
              {formatEasternDate(PUBLISHED_AT)}
            </time>
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
          <Syllabus />

          <div className="text-[15px] sm:text-base">
            <LaneSection />
            <MiddleSection />
            <AgeSection market={market} />
            <PicksSection />
            <CalendarSection />
            <ContendSection />
            <RebuildSection />
            <RosterSection />
            <MistakesSection />
            <ExampleSection />
            <ChecklistSection />
            <FaqSection />
            <SourcesSection />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Stuck in the middle"
        heading="Not sure which lane you are in? Ask people who play dynasty."
        body="Post your roster in our Discord and real dynasty players will tell you whether they would push in or sell off, free. I am in there too, and I will tell you if I think you are rounding your team up."
        isMember={isMember}
        memberHeading="You know the lanes. Now find yours."
        memberBody="You're already in the crew, so we'll skip the invite. League Pulse tags every team in a synced Sleeper league as a Contender, Loaded, Bubble or Rebuilder, with the reason spelled out."
        memberCtaHref="/tools/league-pulse"
        memberCtaLabel="Open League Pulse"
      />
    </main>
  );
}

/* ---------- Shared bits ---------- */

const LINK_CLASS =
  "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

function Para({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-ink-muted">{children}</p>;
}

function BulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul
      role="list"
      className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-ink-muted"
    >
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * A boxed idea: the one sentence a lesson exists to leave behind. The label is
 * decorative; the sentence is real text.
 */
function KeyIdea({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-card border-l-4 border-brand-purple bg-surface p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Key idea
      </p>
      <p className="mt-1 text-base font-medium leading-relaxed text-ink">
        {children}
      </p>
    </div>
  );
}

/** A pointer at the tool that runs the lesson's arithmetic. */
function TryIt({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-card border border-brand-cyan/40 bg-brand-cyan/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="text-sm leading-relaxed text-ink-muted">
        <span className="font-semibold text-brand-cyan">Try it. </span>
        {children}
      </p>
      <Link
        href={href}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {label}
      </Link>
    </div>
  );
}

/** A small table with a caption that says what the numbers are. */
function GuideTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    // Focusable and named, as ChartFigure does: Chrome does not make a scroll
    // container reachable by keyboard on its own, so a table that scrolls at a
    // narrow width would otherwise hide its right-hand column from a keyboard.
    <div
      className="mt-5 overflow-x-auto rounded-card border border-line bg-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full text-sm">
        <caption className="px-4 py-3 text-left text-xs text-ink-subtle">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[0]}
              className="border-b border-line/60 last:border-0 align-top"
            >
              {row.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={cell}
                    scope="row"
                    className="px-4 py-2.5 text-left font-semibold text-ink"
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={`${row[0]}-${i}`}
                    className="px-4 py-2.5 text-ink-muted"
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Short version ---------- */

function TheShortVersion() {
  return (
    <section
      aria-labelledby="short-version"
      className="rounded-card p-px"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      <div
        className="rounded-card p-4 sm:p-5"
        style={{ background: "#16162A" }}
      >
        <h2
          id="short-version"
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#22D3EE" }}
        >
          The short version
        </h2>
        <p
          className="mt-2 text-[15px] leading-relaxed sm:text-base"
          style={{ color: "#F4F4F8" }}
        >
          Every dynasty team is either playing for this season or for a later
          one, and the worst teams are the ones that never decide. Find your
          lane from your projected wins, because your record carries too much
          luck. Treat age as a price the market charges years before production
          falls. Remember that most rookie picks miss. Buy picks in September and sell them in May.
          If you contend, pay with the future you will not need. If you
          rebuild, sell before the deadline and set a date for it to end.
        </p>
      </div>
    </section>
  );
}

/* ---------- Syllabus ---------- */

const LESSONS: { n: string; title: string; href: string; takeaway: string }[] =
  [
    {
      n: "01",
      title: "Pick a lane",
      href: "#lane-heading",
      takeaway: "Contender, Loaded, Bubble or Rebuilder.",
    },
    {
      n: "02",
      title: "The middle is the trap",
      href: "#middle-heading",
      takeaway: "No title shot and no top pick.",
    },
    {
      n: "03",
      title: "Age is a price",
      href: "#age-heading",
      takeaway: "The market sells before production falls.",
    },
    {
      n: "04",
      title: "Rookie picks and their odds",
      href: "#picks-heading",
      takeaway: "Past the top four, a coin flip.",
    },
    {
      n: "05",
      title: "The dynasty year",
      href: "#calendar-heading",
      takeaway: "Buy picks in September, sell in May.",
    },
    {
      n: "06",
      title: "How to contend",
      href: "#contend-heading",
      takeaway: "Pay with the future you will not need.",
    },
    {
      n: "07",
      title: "How to rebuild",
      href: "#rebuild-heading",
      takeaway: "Sell early, and set an end date.",
    },
    {
      n: "08",
      title: "Startups, taxi and bench",
      href: "#roster-heading",
      takeaway: "Every roster spot is a bet on a window.",
    },
  ];

function Syllabus() {
  return (
    <section aria-labelledby="syllabus-heading" className="mt-8">
      <h2
        id="syllabus-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        The eight lessons
      </h2>
      <ol role="list" className="mt-3 grid gap-2 sm:grid-cols-2">
        {LESSONS.map((l) => (
          <li key={l.n}>
            <a
              href={l.href}
              className="flex min-h-11 items-start gap-3 rounded-card border border-line bg-surface/60 p-3 transition-colors hover:border-line-accent hover:bg-ink/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="font-mono text-sm font-semibold tabular-nums text-brand-cyan"
              >
                {l.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  <span className="sr-only">Lesson {Number(l.n)}: </span>
                  {l.title}
                </span>
                <span className="block text-xs text-ink-muted">
                  {l.takeaway}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Lesson 1: pick a lane ---------- */

function LaneSection() {
  return (
    <section aria-labelledby="lane-heading" className="mt-12">
      <GuideSectionHeader
        id="lane-heading"
        eyebrow="Lesson 1 of 8"
        heading="Pick a lane: contend, rebuild, or know why you are in between"
        tone="purple"
      />
      <Para>
        Redraft asks one question every week: who do I start? Dynasty adds a
        second question underneath it, and it matters more. Which season am I
        playing for? A trade, a waiver claim, a rookie pick and a startup
        selection all have a right answer, and it is a different answer for a
        team trying to win in December than for a team trying to win two years
        from now. Most bad dynasty moves are good moves made by the wrong kind
        of team.
      </Para>
      <Para>
        So the first job is to be honest about which team you are. Your record
        is the worst guide to it, because four games of results carry{" "}
        <Link
          href="/guides/fantasy-football-playoffs#luck-heading"
          className={LINK_CLASS}
        >
          a lot of luck
        </Link>
        . The better guide is where your roster ranks on projected wins for
        the rest of the season, set against where it ranks on value, meaning
        what the market would pay for everything you own, picks included.
        League Pulse puts those two ranks side by side for every team in a
        synced Sleeper league and turns them into one word:
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">Contender.</strong> Inside the band
            that should take most of your league&apos;s playoff spots. Your
            roster is built to win now, whatever it is worth.
          </>,
          <>
            <strong className="text-ink">Loaded.</strong> Still in the playoff
            picture, and holding a lot more value than its projected wins show.
            Usually a young team a year early.
          </>,
          <>
            <strong className="text-ink">Bubble.</strong> In the pack on both
            counts and still within range of the bracket. This is the band
            that has to make a decision.
          </>,
          <>
            <strong className="text-ink">Rebuilder.</strong> Below every team
            still within range of the playoff field. The season is no longer
            the thing to play for.
          </>,
        ]}
      />
      <Para>
        The lines move with your league. They are drawn from your own playoff
        field rather than a fixed percentage: most of the teams that make the
        bracket are Contenders, the Bubble runs two places past the cut line,
        and everyone below that is rebuilding. A league that sends eight of ten
        teams to the playoffs has almost no Rebuilders, and that is correct.
      </Para>
      <StatusBandsFigure />
      <Para>
        Put your own league into the box below. It runs the same code League
        Pulse runs, so the word it gives you is the word your team gets there.
      </Para>
      <div className="mt-6">
        <WhichLane />
      </div>
      <KeyIdea>
        Decide which season you are playing for before you make any move, and
        decide it from projected wins and roster value, not from your record.
        Every other lesson here depends on the answer.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        Sync your Sleeper league and every team gets its lane beside its name,
        with the reason written out: its rank by projected wins, its rank by
        value, and where your league&apos;s playoff line falls.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 2: the middle ---------- */

function MiddleSection() {
  return (
    <section aria-labelledby="middle-heading" className="mt-12">
      <GuideSectionHeader
        id="middle-heading"
        eyebrow="Lesson 2 of 8"
        heading="The middle is the trap: no title shot, and no top pick"
      />
      <Para>
        Every dynasty league has a team that finishes seventh. It happens to
        be the same team most years. It is never bad enough to land a top rookie
        pick and never good enough to win a title, so it spends every season
        buying a little and selling a little and ends up exactly where it
        started. I have been that team. It feels sensible from the inside,
        because every single move is defensible. Taken together they add up to
        nothing.
      </Para>
      <Para>
        The arithmetic behind the trap is in the rookie draft. A team that
        finishes seventh picks somewhere around sixth, and the odds on a sixth
        pick are not the odds on a first. In the Dynasty Nerds study of 2018 to
        2023 rookie drafts, the 1.01 turned into a real player 83 percent of
        the time and picks two through four did it 71 percent of the time.
        Picks five through eight hit 38 percent of the time. Lesson 4 has the
        full table. The middle team pays for its seventh-place finish twice:
        once in the playoffs it misses, and again in the draft it cannot win.
      </Para>
      <ThreePathsFigure />
      <Para>
        The way out is a decision, and the test I use is blunt. Count how many
        of your starters would start for the best team in your league. Five or
        more, you are closer than you think, and a couple of the right veterans
        can make you a contender this year. Two or fewer, you are further away
        than a couple of trades can fix, and every month you wait is a month of
        value your veterans lose. Three or four is the genuine middle, and the
        tiebreaker is age, which is Lesson 3: a Bubble team whose core is 23
        should hold and add, and a Bubble team whose core is 28 should sell.
      </Para>
      <Para>
        One kind of middle team is not stuck at all. A Loaded team, in the
        playoff picture and worth more than its projected wins, is usually a
        roster of young players who have not broken out yet. That team should
        not sell youth to chase this season, and it should not tear down
        either. Hold, add a cheap veteran if one is there, and let next season
        arrive.
      </Para>
      <KeyIdea>
        Pick a direction and commit to it. A team that finishes seventh every
        year pays twice: once in the playoffs and again in the rookie draft.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 3: age ---------- */

function marketSentence(market: DynastyAgeMarket): string | null {
  if (market.status !== "ok") return null;
  const share = (pos: string) =>
    market.positions.find((p) => p.position === pos)?.veteranValueSharePct ??
    null;
  const rb = share("RB");
  const qb = share("QB");
  const wr = share("WR");
  if (rb === null || qb === null || wr === null) return null;
  return `Right now, in ${market.format.displayName}, players ${AGE_MARKET_VETERAN_AGE} and over hold ${qb} percent of that value at quarterback, ${rb} percent at running back and ${wr} percent at receiver.`;
}

/**
 * The sentence that reads the live running back row. It states what the
 * figure shows tonight, and falls back to pointing at the figure when the
 * figure is unavailable, so the prose never asserts a number it cannot see.
 */
function rbGapSentence(market: DynastyAgeMarket): string {
  if (market.status !== "ok") {
    return "Check the running back row of the live figure when it is available: that is where the market's price for age shows up.";
  }
  const rb = market.positions.find((p) => p.position === "RB");
  const share = rb?.veteranValueSharePct ?? null;
  if (share === null) {
    return "The live figure has no running back row tonight, so there is no market reading to compare.";
  }
  return share < 50
    ? `Yet in the live figure, running backs ${AGE_MARKET_VETERAN_AGE} and over hold only ${share} percent of the value at their position.`
    : `In the live figure tonight, running backs ${AGE_MARKET_VETERAN_AGE} and over hold ${share} percent of the value at their position, so tonight the discount on older backs is a small one.`;
}

function AgeSection({ market }: { market: DynastyAgeMarket }) {
  const live = marketSentence(market);
  return (
    <section aria-labelledby="age-heading" className="mt-12">
      <GuideSectionHeader
        id="age-heading"
        eyebrow="Lesson 3 of 8"
        heading="Age is a price, and the market charges it before production falls"
        tone="purple"
      />
      <Para>
        Everybody in dynasty knows running backs age badly. What gets missed is
        the gap between when a player&apos;s production falls and when his
        price falls, because they do not happen at the same time. Production
        follows the body. Price follows the calendar, and it moves first,
        because every manager in your league can count to 29.
      </Para>
      <Para>
        Start with production, because the research here is good. 4for4&apos;s
        2025 study of every running back and receiver with at least two top-12
        seasons over 25 years found running backs peak at 26, hold close to
        that through 28 and start declining at 29. ESPN&apos;s study put a
        number on the drop: running backs lost 25.2 percent of their PPR points
        per game from age 28 to 29. Receivers peak between 26 and 28 and fall
        steeply at 32 and 33. Tight ends peak at 26 and, in 4for4&apos;s data,
        show no regression until 31.
      </Para>
      <ProductionCurveFigure />
      <Para>
        Now the price. The next figure is the dynasty market today, read from the same values the rankings boards on this
        site show, and it rebuilds every night. It takes the 24 most valuable
        players at each position and asks how old they are. {live ?? ""}
      </Para>
      <AgeMarketFigure market={market} />
      <Para>
        Put those two figures next to each other and the lesson is in the gap.
        A running back at 27 or 28 is still inside his production peak by every
        study above. {rbGapSentence(market)} For a contender a gap like that is
        the best discount in dynasty, because you are buying points the market
        has stopped paying for. For a rebuilder it is a warning: the price of your 26-year-old
        back will never be higher than it is now. Quarterbacks are the
        exception in the other direction. They play well into their thirties,
        and the market knows it, which is why the{" "}
        <Link href="/guides/superflex-strategy#dynasty-heading" className={LINK_CLASS}>
          superflex guide
        </Link>{" "}
        treats a 30-year-old quarterback as a long-term asset. Defenders follow their own
        clock, set by role rather than age, and the{" "}
        <Link href="/guides/idp-fantasy-football#dynasty-heading" className={LINK_CLASS}>
          IDP guide
        </Link>{" "}
        covers them.
      </Para>
      <Para>
        The same logic sets your window. A roster is only as young as the
        players who score its points, and a core where four of six starters
        leave their prime in the same two seasons is a core with a closing
        date. Try your own starters in the box below.
      </Para>
      <div className="mt-6">
        <AgeClock />
      </div>
      <KeyIdea>
        Production falls at 29 for running backs and later for everyone else.
        The price falls earlier than that, for every position except
        quarterback. Buy the gap when you contend. Sell ahead of it when you
        rebuild.
      </KeyIdea>
      <TryIt
        href={
          market.status === "ok"
            ? `/rankings/${market.format.slug}?source=${encodeURIComponent(market.sourceSlug)}`
            : "/rankings/dynasty-ppr-sflex"
        }
        label="See dynasty rankings"
      >
        The dynasty boards carry every player&apos;s value and how it moved
        over the last seven days, so a veteran the market is marking down for
        age shows up as a falling price you can check against his role.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 4: rookie picks ---------- */

function PicksSection() {
  return (
    <section aria-labelledby="picks-heading" className="mt-12">
      <GuideSectionHeader
        id="picks-heading"
        eyebrow="Lesson 4 of 8"
        heading="Rookie picks: lottery tickets with published odds"
      />
      <Para>
        A rookie pick is the only asset in dynasty that cannot get hurt, cannot
        lose its job and cannot get older. That is exactly why it gets
        overrated. Until the draft, every pick is priced as the best version of
        the player it might become, and most picks do not become that player.
      </Para>
      <HitRateFigure />
      <Para>
        Read the table as odds, because that is what it is. The top four picks
        are close to sure things. Everything after them is a coin flip in round
        one and a long shot in round two. Round three and later hit 8 percent
        of the time, which is roughly the odds on a waiver claim, and that is
        how a third-round pick should be priced in a trade. The draft capital a
        player gets from the NFL is the biggest single reason a pick hits,
        because NFL teams give expensive players the snaps to prove themselves,
        and the{" "}
        <Link
          href="/guides/fantasy-football-terms#draft-capital"
          className={LINK_CLASS}
        >
          glossary entry on draft capital
        </Link>{" "}
        explains why.
      </Para>
      <GuideSubheading className="mt-8">
        A future pick has no slot yet, and that is the trade
      </GuideSubheading>
      <Para>
        A pick for next year&apos;s draft has no slot until the season ends,
        so it gets priced as an average of what it could be. The calculator on
        this site prices picks by season, round and early, mid or late slot,
        and a pick whose slot is unknown is priced at the average of its early,
        mid and late values, which works out close to a middle pick. That
        average is where the edge sits. A contender&apos;s own future first will almost
        certainly land late, so when a contender sells it, they are selling a
        late pick at a middle price. A rebuilder&apos;s future first will
        almost certainly land early, so a rebuilder should be very slow to
        trade it, and a contender who can get one should.
      </Para>
      <Para>
        Contenders should treat picks as currency to spend. A pick scores
        nothing for you this season, and past the top four it has
        roughly even odds of ever scoring anything. Rebuilders should want
        picks in the top four and players they already know, and should sell
        the picks in between at their peak, which Lesson 5 puts in May.
      </Para>
      <KeyIdea>
        Price a rookie pick by its odds. Past the first four picks it is a
        coin flip, and a contender&apos;s own future first
        is a late pick being sold at a middle price.
      </KeyIdea>
      <TryIt href="/tools/trade-calculator" label="Price a pick">
        Signal Check prices dynasty picks by season, round and early, mid or
        late slot, so you can see what a future first is worth
        against the players it would bring back.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 5: the dynasty year ---------- */

function CalendarSection() {
  return (
    <section aria-labelledby="calendar-heading" className="mt-12">
      <GuideSectionHeader
        id="calendar-heading"
        eyebrow="Lesson 5 of 8"
        heading="The dynasty year: every month has a buyer and a seller"
        tone="purple"
      />
      <Para>
        Redraft trading stops at the deadline and starts again in August.
        Dynasty never stops, and the prices move with the calendar in a way you
        can plan around. The clearest evidence is on picks. Footballguys
        tracked KeepTradeCut prices through 2023 and found the best time to buy
        a rookie pick was the start of the regular season in September, and the
        best time to sell was right after the NFL draft and during rookie
        drafts in May. Picks generally lost value through the summer months,
        between June and August.
      </Para>
      <DynastyYearFigure />
      <Para>
        Players move the other way. The spring is rookie season: from the
        combine to the rookie drafts, every manager in your league is watching
        college highlights, and proven veterans are the easiest thing in
        dynasty to buy. By September most rookies are still learning their
        role, the veterans are scoring, and the contenders start paying for
        points again.
        If you only trade in-season, you are only ever trading at one of the
        two prices.
      </Para>
      <Para>
        Inside the season itself, the trade guide covers the week-by-week
        picture, from the week 1 overreaction to the deadline rush, in{" "}
        <Link
          href="/guides/fantasy-football-trade-guide#timing-heading"
          className={LINK_CLASS}
        >
          its lesson on timing
        </Link>
        . The dynasty version adds one rule: a rebuilder&apos;s real deadline
        comes before the league&apos;s. It is the last week before a
        contender&apos;s need gets solved by somebody else. Sell in October.
        In the final week, three other rebuilders are selling the same kind of
        player to the same two buyers.
      </Para>
      <KeyIdea>
        Buy picks in September and sell them in May. Buy veterans in the spring
        while the room is scouting rookies. Sell veterans in October, before
        the rush.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 6: contending ---------- */

function ContendSection() {
  return (
    <section aria-labelledby="contend-heading" className="mt-12">
      <GuideSectionHeader
        id="contend-heading"
        eyebrow="Lesson 6 of 8"
        heading="How to contend: pay with the future you will not need"
      />
      <Para>
        A contender has one job, and it is to turn value into wins at a good
        exchange rate. The exchange rate is best on the players the market has
        started discounting for age and who are still scoring. That is the gap
        from Lesson 3, and it is where a contender should do most of its
        shopping.
      </Para>
      <ContenderDiscountFigure />
      <Para>Here is the playbook I use when I am in the Contender band.</Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">
              Buy points the market has stopped paying for.
            </strong>{" "}
            Receivers from 27 to 29 and running backs at 26 and 27 with a real
            workload are the cheapest points in dynasty. The market prices them
            on their next five years, and you only need the next five months.
          </>,
          <>
            <strong className="text-ink">Pay with the far future first.</strong>{" "}
            A pick two years out is worth less to you than to anyone else in
            the league, because by the time it becomes a player your window may
            have closed. Spend those before next year&apos;s first, and spend
            your own future first before somebody else&apos;s, because yours
            will land late.
          </>,
          <>
            <strong className="text-ink">Consolidate.</strong> Two good players
            for one great one is a contender&apos;s trade, because you can only
            start so many and the waiver wire can replace a good player but
            never a great one. The{" "}
            <Link
              href="/guides/fantasy-football-trade-guide#two-for-one-heading"
              className={LINK_CLASS}
            >
              trade guide&apos;s lesson on the 2-for-1
            </Link>{" "}
            has the arithmetic.
          </>,
          <>
            <strong className="text-ink">Plan the exit.</strong> Every veteran
            you buy has a date when his price hits zero. Know it before you buy
            him, and sell the running back in the offseason before he turns 29,
            not the one after.
          </>,
          <>
            <strong className="text-ink">Keep one first.</strong> A contender
            with no picks left and an aging core has nowhere to go when the
            window shuts, and the next rebuild takes twice as long. One first
            in hand is the insurance policy.
          </>,
        ]}
      />
      <Para>
        Windows are shorter than they feel. A core built around running backs
        in their mid-twenties has two seasons, maybe three, before the age
        curve takes it apart. So push hard while the window is open, rather
        than spending one of your two good seasons deciding whether to go for
        it.
      </Para>
      <KeyIdea>
        A contender buys the points the market is discounting, pays with the
        picks furthest from helping, and knows the date every veteran it buys
        stops being worth anything.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        Inside a synced league, Trade Ideas reports what a deal does to your
        projected wins week by week against your real remaining schedule, and
        to your roster&apos;s value, side by side.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 7: rebuilding ---------- */

function RebuildSection() {
  return (
    <section aria-labelledby="rebuild-heading" className="mt-12">
      <GuideSectionHeader
        id="rebuild-heading"
        eyebrow="Lesson 7 of 8"
        heading="How to rebuild: sell early, buy the year-two jump, and set an end date"
        tone="purple"
      />
      <Para>
        A rebuild starts with the hardest sell in dynasty: your best veteran,
        while he is still scoring. The reason is Lesson 3. His price is set by
        his age more than his points, and it only goes one way from here. The
        contender who buys him in October is paying for this season, and this
        season is the one thing you do not need.
      </Para>
      <RebuildTimelineFigure />
      <Para>
        What to buy is where most rebuilds go wrong, and the age research is
        specific about it. 4for4 found running backs most often break out as
        rookies: of the 47 in their sample, only 2 broke out in their fifth
        season or later. So a running back you buy at 22 will be 25 or 26 by
        the time your rebuild is done, halfway through his window. Buy running
        backs last, in the offseason your window opens.
      </Para>
      <Para>
        Receivers and tight ends run on a slower clock, which makes them the
        rebuilder&apos;s natural target. 4for4 puts more than 70 percent of
        receiver breakouts in years two through four. ESPN measured a 43
        percent jump in PPR points per game for receivers from year one to year
        two, and 98.5 percent for tight ends. The cheapest moment to buy either
        one is the offseason after a quiet rookie year, when his price still
        reflects the rookie numbers and not the jump.
      </Para>
      <Para>
        And set an end date. A real rebuild takes about a season and a half: a
        bad year, an offseason of buying, and a deadline where you check
        whether five of your starters would start for the best team in the
        league. When they would, stop collecting picks and start spending
        them. A manager who keeps collecting past that point ends up with a
        shelf of lottery tickets and no lineup.
      </Para>
      <KeyIdea>
        Sell veterans before the deadline, buy receivers and tight ends before
        their second season, buy running backs last, and put a date on the
        rebuild before you start it.
      </KeyIdea>
      <div className="mt-6">
        <LaneQuiz />
      </div>
    </section>
  );
}

/* ---------- Lesson 8: roster ---------- */

function RosterSection() {
  return (
    <section aria-labelledby="roster-heading" className="mt-12">
      <GuideSectionHeader
        id="roster-heading"
        eyebrow="Lesson 8 of 8"
        heading="Startups, taxi squads and the bench: every roster spot is a bet on a window"
      />
      <GuideSubheading className="mt-6">
        The startup draft decides your first window
      </GuideSubheading>
      <Para>
        A{" "}
        <Link
          href="/guides/fantasy-football-terms#startup-draft"
          className={LINK_CLASS}
        >
          startup draft
        </Link>{" "}
        is the one time you can build a whole roster to one plan, so pick the
        plan before the first pick. If you want to win in year one, draft
        proven producers the room is discounting for age, and accept that you
        will be selling some of them in two years. If you want a longer run,
        build around receivers and quarterbacks in their early twenties and
        wait on running backs, for the reason in Lesson 7. In superflex, lock
        in two starting quarterbacks early; the{" "}
        <Link href="/guides/superflex-strategy#draft-heading" className={LINK_CLASS}>
          superflex guide
        </Link>{" "}
        has a plan for every draft seat.
      </Para>
      <Para>
        The mistake to avoid is a roster whose best years do not overlap: a
        29-year-old running back, a 22-year-old receiver and a rookie
        quarterback are three good picks that peak in three different seasons.
        The team that wins is the one whose core peaks together.
      </Para>
      <GuideSubheading className="mt-8">Taxi squads, as Sleeper runs them</GuideSubheading>
      <Para>
        A{" "}
        <Link
          href="/guides/fantasy-football-terms#taxi-squad"
          className={LINK_CLASS}
        >
          taxi squad
        </Link>{" "}
        is roster space for young players that does not count against your
        roster limit. League Pulse reads Sleeper leagues, so here is how Sleeper
        runs it, from its own help centre:
      </Para>
      <GuideTable
        caption="How Sleeper's taxi squad settings work, from Sleeper's help centre. Your commissioner chooses the values."
        head={["Setting", "How it works"]}
        rows={[
          [
            "Taxi spots",
            "Your commissioner sets between 0 and 10 per team. They do not count against the roster limit.",
          ],
          [
            "Who is eligible",
            "Players up to a set number of years of experience, from 1 to 4, or no maximum. An option can allow non-rookies.",
          ],
          [
            "Adding a player",
            "A free agent or waiver claim goes to your bench first, then you move him to taxi.",
          ],
          [
            "Promoting",
            "You can move a player off taxi onto your active roster at any time.",
          ],
          [
            "The deadline",
            "After your league's taxi deadline, nobody can be moved onto taxi, including a player you just promoted.",
          ],
          [
            "Poaching",
            "Sleeper does not let other teams take players off your taxi squad.",
          ],
        ]}
      />
      <Para>
        Used well, taxi is free patience. It is the place for the tight end in
        his first year, the receiver buried on a depth chart and the
        quarterback who will not start until next season: players whose value
        is years away and whose roster spot you would otherwise have to find.
        Check your league&apos;s deadline before the season, because a player
        you promote to cover a bye week cannot go back.
      </Para>
      <GuideSubheading className="mt-8">The bench is a portfolio</GuideSubheading>
      <Para>
        The last three spots on a dynasty bench should match your lane. A
        contender&apos;s end of the bench is injury cover and bye-week
        starters, because those spots can win a playoff week. A
        rebuilder&apos;s is upside: young backups one injury away from a role,
        who cost nothing now and could be worth a first by next spring. A
        rebuilder holding a 31-year-old backup running back for depth is
        holding a player who will never be worth more to anyone than he is to
        a contender this month.
      </Para>
      <KeyIdea>
        Build a startup around a core whose best years overlap, use taxi for
        players whose value is years away, and fill the end of your bench to
        match your lane.
      </KeyIdea>
      <TryIt href="/tools/on-the-clock" label="Open On The Clock">
        Connect a live Sleeper startup or rookie draft and On The Clock points
        you to the best pick for your roster, with a trade calculator and an
        analyzer built for both kinds of draft.
      </TryIt>
    </section>
  );
}

/* ---------- Mistakes ---------- */

function MistakesSection() {
  return (
    <section aria-labelledby="mistakes-heading" className="mt-12">
      <GuideSectionHeader
        id="mistakes-heading"
        eyebrow="Been there"
        heading="Mistakes I see every year"
        tone="purple"
      />
      <BulletList
        items={[
          <>
            <strong className="text-ink">Deciding your lane from your record.</strong>{" "}
            Two lucky wins do not make you a contender, and two unlucky losses
            do not make you a rebuilder. Use projected wins.
          </>,
          <>
            <strong className="text-ink">Rebuilding at the deadline.</strong>{" "}
            By the last week, three other rebuilders are selling the same kind
            of player to the same two buyers. Sell in October.
          </>,
          <>
            <strong className="text-ink">Holding a running back one year too long.</strong>{" "}
            His price falls before his production does. The sale you did not
            make at 26 does not come back at 28.
          </>,
          <>
            <strong className="text-ink">Paying for a pick&apos;s best case.</strong>{" "}
            Past the first four, a rookie pick hits about as often as it
            misses. Price it that way.
          </>,
          <>
            <strong className="text-ink">Buying rookie running backs to rebuild.</strong>{" "}
            They break out early and fade early. By the time your window opens,
            his is half over.
          </>,
          <>
            <strong className="text-ink">Buying a contender&apos;s future first at a middle price.</strong>{" "}
            If that team is good, the pick lands late, and you paid for a
            better one.
          </>,
          <>
            <strong className="text-ink">A rebuild with no end date.</strong>{" "}
            Picks are for turning into players. A shelf of them is not a team.
          </>,
          <>
            <strong className="text-ink">Staying in the middle.</strong> Every
            move is defensible and the team finishes seventh again.
          </>,
        ]}
      />
    </section>
  );
}

/* ---------- Worked example ---------- */

function ExampleSection() {
  return (
    <section aria-labelledby="example-heading" className="mt-12">
      <GuideSectionHeader
        id="example-heading"
        eyebrow="Start to finish"
        heading="A worked example, with made-up numbers"
      />
      <Para>
        Say it is week 5 in a twelve-team superflex dynasty league that sends
        six teams to the playoffs. You are 2 and 3. Your quarterbacks are 24
        and 31, your running backs are 27 and 23, your receivers are 29, 24 and
        22, and your tight end is 25. You hold your own 2027 first and second.
        Here is the whole method, in order.
      </Para>
      <GuideTable
        caption="An invented dynasty roster, walked through the way this guide reasons. Every number here is made up."
        head={["Step", "The question", "The answer"]}
        rows={[
          [
            "1. Lane",
            "Where do I rank on projected wins and on value?",
            "7th by projected wins, 4th by value. League Pulse would call that Loaded: in the picture, worth more than my wins show.",
          ],
          [
            "2. The test",
            "How many of my starters would start for the best team?",
            "Three: the 24-year-old quarterback, the 23-year-old back and the 24-year-old receiver. The genuine middle.",
          ],
          [
            "3. Age",
            "Who leaves their prime within two seasons?",
            "The 27-year-old back and the 29-year-old receiver. The quarterback at 31 has years left.",
          ],
          [
            "4. Tiebreaker",
            "Which way do the ages point?",
            "Young. Five of my eight starters are 25 or under. This is a team a year early.",
          ],
          [
            "5. Sell",
            "What do I move, and when?",
            "The 27-year-old back and the 29-year-old receiver, this month, to whichever contender lost a starter, for a first and a young receiver.",
          ],
          [
            "6. Keep",
            "What do I refuse to sell?",
            "My own 2027 first. At 2 and 3 on a young team, it could land early, and early picks are the ones that hit.",
          ],
          [
            "7. Buy",
            "What do I buy with the proceeds?",
            "A second-year tight end or receiver coming off a quiet rookie year, before the year-two jump shows up in his price.",
          ],
          [
            "8. End date",
            "When do I switch back to buying?",
            "Next year's deadline, if five of my starters would start for the best team by then.",
          ],
        ]}
      />
      <Para>
        Notice that step 1 and step 4 pointed the same way and step 2 did not.
        The starter count said middle, the value rank said a good roster, and the ages
        broke the tie. Now change one fact: make the core 28 instead of 24,
        with the same ranks. Step 4 flips, and the right move is to sell
        everyone over 26 this month and rebuild properly, because a middle team
        with an old core is the one team in dynasty that has no good reason to
        wait.
      </Para>
      <TryIt href="/games/would-you-rather" label="Play Would You Rather">
        Want reps? Would You Rather puts a real trade from a real league in
        front of you, names removed, and asks you to call the winner before it
        shows the full grade and how the room voted.
      </TryIt>
    </section>
  );
}

/* ---------- Checklist ---------- */

function ChecklistSection() {
  return (
    <section aria-labelledby="checklist-heading" className="mt-12">
      <GuideSectionHeader
        id="checklist-heading"
        eyebrow="Pre-flight"
        heading="Before your trade deadline"
        tone="purple"
      />
      <Para>
        Eight questions, one roster. Run through them once before your
        league&apos;s trade deadline and once before your rookie draft. If you
        cannot tick one, that is the thing to work out before you trade.
      </Para>
      <div className="mt-6">
        <DeadlineChecklist />
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="mt-12">
      <GuideSectionHeader
        id="faq-heading"
        eyebrow="FAQ"
        heading="Questions, answered"
      />
      <div className="mt-6">
        <FaqAccordion items={FAQ} />
      </div>
    </section>
  );
}

/* ---------- Sources ---------- */

const SOURCES: { name: string; detail: string; href: string }[] = [
  {
    name: "4for4, Production curves: positional breakouts, prime years and falloffs by age",
    detail:
      "Tristan Bassett, August 2025. Peak and decline ages for running backs, receivers and tight ends; breakout timing.",
    href: "https://www.4for4.com/2025/preseason/production-curves-positional-breakouts-prime-years-and-falloffs-age",
  },
  {
    name: "ESPN, When fantasy football players peak and decline",
    detail:
      "Tristan H. Cockcroft, July 2023. The running back drop from 28 to 29 and the year-two jumps for receivers and tight ends.",
    href: "https://www.espn.com/fantasy/football/story/_/id/37933720/2023-fantasy-football-players-peak-decline-quarterback-running-back-wide-receiver",
  },
  {
    name: "Fantasy Life, How does age impact WR performance",
    detail:
      "Dwain McFarland, June 2024, updated June 2025. Receiver prime years and the drop from 31.",
    href: "https://www.fantasylife.com/articles/redraft/how-does-age-impact-wr-performance-in-fantasy-football",
  },
  {
    name: "PFF, Age of decline: quarterbacks",
    detail:
      "June 2012. Franchise quarterbacks produce solid numbers from 25 to 36. Older than the others, and used here only for the quarterback rule of thumb.",
    href: "https://www.pff.com/news/age-of-decline-qb",
  },
  {
    name: "Dynasty Nerds, Dynasty trade secrets: understanding draft pick values",
    detail:
      "Mychal Warno, March 2025. Rookie pick hit rates by slot for 2018 to 2023 rookie drafts.",
    href: "https://www.dynastynerds.com/dynasty/dynasty-trade-secrets-understanding-draft-pick-values/",
  },
  {
    name: "Footballguys, Dynasty Investor: rookie pick valuation",
    detail:
      "Jay Stein, March 2024. When rookie picks are cheapest and most expensive, from KeepTradeCut prices through 2023.",
    href: "https://www.footballguys.com/article/2024-dynasty-investor-rookie-pick-valuation",
  },
  {
    name: "Sleeper, How do taxi squads work",
    detail: "Sleeper's help centre. The taxi squad settings in Lesson 8.",
    href: "https://support.sleeper.com/en/articles/3640482-how-do-taxi-squads-work",
  },
];

function SourcesSection() {
  return (
    <section aria-labelledby="sources-heading" className="mt-12">
      <GuideSectionHeader
        id="sources-heading"
        eyebrow="Where the numbers come from"
        heading="Sources"
        tone="purple"
      />
      <Para>
        Every published figure on this page comes from one of these. The live
        age figure in Lesson 3 is read from this site&apos;s own dynasty values
        and says so in its caption. Everything else is invented to show a
        shape, and says that too.
      </Para>
      <ul role="list" className="mt-4 space-y-3">
        {SOURCES.map((s) => (
          <li
            key={s.href}
            className="rounded-card border border-line bg-surface/40 p-3 text-sm leading-relaxed"
          >
            <a href={s.href} className={LINK_CLASS}>
              {s.name}
            </a>
            <span className="block text-ink-muted">{s.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Closing ---------- */

function ClosingSection() {
  return (
    <section aria-labelledby="closing-heading" className="mt-12">
      <GuideSectionHeader
        id="closing-heading"
        eyebrow="Next"
        heading="Find your lane in your own league"
      />
      <Para>
        Your lane is on{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>
        , beside your team&apos;s name in any synced Sleeper league. The trades
        that follow from it get graded in the{" "}
        <Link href="/tools/trade-calculator" className={LINK_CLASS}>
          trade calculator
        </Link>{" "}
        for value and in Trade Ideas for wins, and the{" "}
        <Link href="/guides/fantasy-football-trade-guide" className={LINK_CLASS}>
          trade guide
        </Link>{" "}
        covers how to judge one offer before you send it. If your league starts
        two quarterbacks, the{" "}
        <Link href="/guides/superflex-strategy" className={LINK_CLASS}>
          superflex guide
        </Link>{" "}
        is the other half of this one. Dynasty, rebuild, win-now and the rest
        of the vocabulary are in the{" "}
        <Link
          href="/guides/fantasy-football-terms#rebuild"
          className={LINK_CLASS}
        >
          glossary
        </Link>
        .
      </Para>
    </section>
  );
}
