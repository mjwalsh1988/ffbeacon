import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
import { createClient } from "@/lib/supabase/server";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { getActiveFormats } from "@/lib/source";
import { loadSuperflexPricePairs } from "@/lib/guides/superflex-price-pairs";
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
  AgeCurveFigure,
  ByeGridFigure,
  EarlyRoundsFigure,
  PricePairsFigure,
  ReplacementLineFigure,
  TePremiumFigure,
  ThirdQbFigure,
} from "./superflex-figures";
import {
  DraftChecklist,
  DraftSlotPlan,
  QbRosterPlanner,
} from "./superflex-classroom";

/**
 * /guides/superflex-strategy
 *
 * How to play a superflex league, written in Michael's first person for a
 * reader who just joined one and has been told "quarterbacks go early" and
 * nothing else.
 *
 * WHY THIS PAGE. Search Console (28 days to 2026-09-16) puts the site's five
 * superflex and TE premium rankings boards at about a thousand impressions a
 * month between them, at positions 8 to 12 with a click rate of one to four
 * percent, and Google's own suggestions around the phrase are strategy-shaped:
 * "superflex fantasy football strategy", "superflex draft strategy", "how many
 * qbs to roster in superflex", "how many qbs in superflex dynasty", "2 qb
 * fantasy football strategy", "superflex dynasty trade value chart", "te
 * premium fantasy strategy". The FAAB guide pairs with the FAAB calculator,
 * the one pairing proven to win search here; this page pairs with those five
 * boards, the trade calculator, On The Clock and the League Pulse Positional
 * WAR curve the same way. The URL carries no year because the method does not
 * expire.
 *
 * THE MECHANICAL CLAIMS ARE CHECKED AGAINST THE ENGINES. The superflex slot
 * accepts QB, RB, WR and TE (PULSE_SLOT_ELIGIBILITY in lib/power-pulse/
 * types.ts). Format derivation treats an explicit SUPER_FLEX slot or two QB
 * slots as superflex and lands a superflex league on a superflex board even
 * when its scoring does not match (lib/sleeper-to-format.ts). Positional WAR
 * reads the league's own slots, fills every lineup once and takes the best
 * benched player as the replacement (lib/positional-war/replacement.ts), so
 * a superflex league's replacement quarterback is found rather than assumed.
 * The pick source fallback to KTC is lib/signal-check/values.ts.
 *
 * ONE FIGURE IS LIVE and says so: PricePairsFigure reads the same cached
 * rankings boards the /rankings pages render, through
 * lib/guides/superflex-price-pairs.ts, in the reader's resolved source and
 * the league type of their resolved format. EVERY OTHER NUMBER IS INVENTED
 * AND SAYS SO, in the figure captions and in the interactive boxes.
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders.
 */

const SLUG = "superflex-strategy";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-16T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Superflex Strategy: How to Draft, Roster and Trade Quarterbacks";
const DESCRIPTION =
  "A plain-English superflex fantasy football guide: what the slot changes, how many quarterbacks to roster in redraft, dynasty and best ball, when to draft them, how to trade them, and how TE premium stacks on top.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "superflex strategy",
    "superflex fantasy football strategy",
    "superflex draft strategy",
    "how many qbs to draft in superflex",
    "how many qbs to roster in superflex",
    "how many qbs in superflex dynasty",
    "2qb fantasy football strategy",
    "superflex fantasy football meaning",
    "superflex dynasty strategy",
    "superflex vs 2qb",
    "te premium fantasy strategy",
    "superflex best ball strategy",
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
  { id: "changes-heading", label: "What superflex changes" },
  { id: "how-many-heading", label: "How many quarterbacks" },
  { id: "draft-heading", label: "Drafting in superflex" },
  { id: "dynasty-heading", label: "Dynasty superflex" },
  { id: "trades-heading", label: "Trading quarterbacks" },
  { id: "season-heading", label: "Managing the season" },
  { id: "tep-heading", label: "TE premium on top" },
  { id: "league-heading", label: "Read your own league" },
  { id: "mistakes-heading", label: "Mistakes I see every year" },
  { id: "example-heading", label: "A worked draft" },
  { id: "checklist-heading", label: "Before your draft" },
  { id: "faq-heading", label: "Questions, answered" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "What is a superflex league in fantasy football?",
    answer:
      "A superflex league has one lineup slot that can hold a quarterback as well as a running back, receiver or tight end. Because a quarterback almost always scores more than the other three, nearly every team puts a second quarterback in it, so the league needs about twice as many starting quarterbacks as a normal one. That is the whole change, and everything else about superflex strategy follows from it.",
  },
  {
    question: "How many quarterbacks should I draft in a superflex league?",
    answer:
      "Three, in a normal twelve-team redraft league: two to start every week and one to cover bye weeks and the one injury a season you should expect. Draft the first two inside the first six rounds and the third late. A fourth quarterback in redraft is a bench spot that never scores; in a fourteen-team league or a true 2QB league, four is right because the waiver wire runs dry.",
  },
  {
    question: "How many quarterbacks should I roster in superflex dynasty?",
    answer:
      "Four. Two starters, a bye-week cover, and a fourth who is a stash: a young backup with a path to a starting job, or a veteran on a one-year deal. Quarterbacks keep their value for years, so the fourth one on a dynasty roster is an asset the whole league will want the week his starter gets hurt, which is different from redraft, where he is dead weight.",
  },
  {
    question:
      "Should I draft a quarterback in the first round of a superflex draft?",
    answer:
      "Often, and it depends on your pick. From an early pick, take the best player on the board and plan your quarterback for the round two and three turn, where you get two picks together. From a late pick, take one of the two best quarterbacks left at the round one and two turn, because about twenty-two picks pass before you choose again and the quarterback run happens in that gap. From the middle, take the best player and let the run tell you when to grab your first quarterback.",
  },
  {
    question: "What is the difference between superflex and 2QB?",
    answer:
      "In superflex the second slot can hold a quarterback or a running back, receiver or tight end, so a bye week or an injury costs you a few points while you start a flex player there. In a 2QB league the second slot must be a quarterback, so an empty one is a zero. 2QB leagues need one more quarterback on every roster and price the position even harder, because there is no fallback.",
  },
  {
    question: "How many quarterbacks should I take in superflex best ball?",
    answer:
      "Three in a ten or twelve-team room, four in a fourteen-team one or a 2QB one. Nobody sets a lineup in best ball, so the third quarterback is your bye cover and your injury cover at the same time, and every week the two highest scores count automatically. Spend the extra roster spots on receivers, where a lucky week is more likely to be counted.",
  },
  {
    question: "Is TE premium the same thing as superflex?",
    answer:
      "No, and leagues often run both. Superflex changes how many quarterbacks the league needs. TE premium changes what a catch by a tight end is worth, usually half a point or a full point more than a catch by anyone else, which widens the gap between the best tight ends and the replacement. The two stack: a TE premium superflex league prices quarterbacks and elite tight ends higher than any other format.",
  },
  {
    question: "How do I trade quarterbacks in a superflex league?",
    answer:
      "Sell your third quarterback to the team that has two, and do it before his bye week does it for you. A third quarterback is worth a lot on a value list and scores nothing on your bench, so the team that needs a starter will pay a starter's price for him. Buy the opposite way: a contender with a quarterback on injured reserve in November will pay far more for a backup than he was worth in August.",
  },
];

export default async function SuperflexGuide({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; source?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [formatResolution, sourceResolution, formats, isMember] =
    await Promise.all([
      resolveFormatSlug(supabase, params.format),
      resolveSourceSlug(supabase, params.source),
      getActiveFormats(supabase),
      isDiscordMember(),
    ]);
  // The live figure shows the pair (one-QB, superflex) in the league type the
  // reader is already looking at. A best ball reader gets the redraft pair,
  // since best ball has no one-QB twin to compare against.
  const readerFormat = formats.find((f) => f.slug === formatResolution.slug);
  const leagueType =
    readerFormat?.league_type === "dynasty" ? "dynasty" : "redraft";
  const pairs = await loadSuperflexPricePairs(
    supabase,
    sourceResolution.slug,
    leagueType,
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
      about: { "@type": "Thing", name: "Superflex fantasy football strategy" },
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
          title="Superflex strategy: how to draft, roster and trade quarterbacks when everyone needs two"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Superflex", tone: "purple" },
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
            <ChangesSection pairs={pairs} />
            <HowManySection />
            <DraftSection />
            <DynastySection />
            <TradesSection />
            <SeasonSection />
            <TepSection />
            <LeagueSection />
            <MistakesSection />
            <ExampleSection />
            <ChecklistSection />
            <FaqSection />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Superflex draft coming up"
        heading="Not sure when to take your quarterback? Ask before the clock starts."
        body="Drop your draft slot and your league settings into our Discord and real superflex players will tell you what they would do, free. I am in there too, and I have been on the wrong end of the quarterback run enough times to have opinions."
        isMember={isMember}
        memberHeading="You know the method. Now look at your board."
        memberBody="You're already in the crew, so we'll skip the invite. The superflex rankings boards are one click away, and On The Clock brings them into your live draft."
        memberCtaHref="/rankings/dynasty-ppr-sflex"
        memberCtaLabel="Open the superflex rankings"
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

/** A pointer at the tool or board that runs the lesson's arithmetic. */
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
    <div className="mt-5 overflow-x-auto rounded-card border border-line bg-surface/40">
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
          Superflex adds one slot that a quarterback can fill, and because a
          quarterback outscores everyone else, every team fills it with one. A
          twelve-team league now needs twenty-four starting quarterbacks out of
          the thirty-two the NFL has, so the free one on the wire goes from
          about the thirteenth best to about the twenty-fifth. That single move
          is why quarterbacks go in the first round, why your third quarterback
          is a trade chip, and why a bye week can empty a slot. Roster three in
          redraft, four in dynasty, plan your quarterback around the turn where
          you get two picks together, and sell the spare to the team that needs
          him.
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
      title: "What superflex changes",
      href: "#changes-heading",
      takeaway: "The free quarterback moves twelve places.",
    },
    {
      n: "02",
      title: "How many quarterbacks",
      href: "#how-many-heading",
      takeaway: "Three in redraft, four in dynasty, one more in 2QB.",
    },
    {
      n: "03",
      title: "Drafting in superflex",
      href: "#draft-heading",
      takeaway: "One pillar, then let the run tell you.",
    },
    {
      n: "04",
      title: "Dynasty superflex",
      href: "#dynasty-heading",
      takeaway: "A quarterback's career is long.",
    },
    {
      n: "05",
      title: "Trading quarterbacks",
      href: "#trades-heading",
      takeaway: "Your third quarterback is value, not wins.",
    },
    {
      n: "06",
      title: "Managing the season",
      href: "#season-heading",
      takeaway: "Byes, backups and the second slot.",
    },
    {
      n: "07",
      title: "TE premium on top",
      href: "#tep-heading",
      takeaway: "Two settings that stack.",
    },
    {
      n: "08",
      title: "Read your own league",
      href: "#league-heading",
      takeaway: "The curve tells you how steep it really is.",
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

/* ---------- Lesson 1: what superflex changes ---------- */

function ChangesSection({
  pairs,
}: {
  pairs: Parameters<typeof PricePairsFigure>[0]["pairs"];
}) {
  return (
    <section aria-labelledby="changes-heading" className="mt-12">
      <GuideSectionHeader
        id="changes-heading"
        eyebrow="Lesson 1 of 8"
        heading="What superflex changes, and why it is arithmetic before it is opinion"
        tone="purple"
      />
      <Para>
        The first superflex league I joined, somebody told me quarterbacks go
        early and left it there. It took me a full season to understand why, and
        once I did, every other decision in the format got easier. So I want to
        start with the why, because the why is counting, and counting is
        something you can check.
      </Para>
      <Para>
        A{" "}
        <Link
          href="/guides/fantasy-football-terms#superflex"
          className={LINK_CLASS}
        >
          superflex
        </Link>{" "}
        slot is a flex that accepts a quarterback. A quarterback almost always
        outscores a running back, receiver or tight end, so every team puts a
        second quarterback in it. Twelve teams starting one quarterback need
        twelve. Twelve teams starting two need twenty-four. The NFL has about
        thirty-two starting jobs, and a few of those are in offenses nobody
        wants a piece of. So in a one-quarterback league the best quarterback
        nobody starts is roughly the thirteenth best, and he is a perfectly good
        player. In superflex he is roughly the twenty-fifth best, and he is a
        backup on a bad team, or an injury away from being one.
      </Para>
      <ReplacementLineFigure />
      <Para>
        That free quarterback, the replacement, is the whole story. A player is
        worth what he scores above the one you could have for nothing. The best
        quarterback did not change when your league turned on superflex. The one
        he is measured against did, and he got a lot worse, so the gap roughly
        doubled. The{" "}
        <Link href="/guides/positional-war-explained" className={LINK_CLASS}>
          Positional WAR guide
        </Link>{" "}
        is the long version of that sentence. This page is what to do about it.
      </Para>
      <Para>
        You do not have to take my word for the size of it. The table below is
        live, from the site&apos;s own rankings boards: the top quarterbacks in
        a superflex format beside the same players in the one-quarterback
        version of the same league type, from the same source, so nothing but
        the slot is different between the two columns.
      </Para>
      <PricePairsFigure pairs={pairs} />
      <KeyIdea>
        Superflex does not make quarterbacks better. It makes the free one
        worse, and every quarterback is priced against the free one. Count the
        starters your league needs and you have already understood the format.
      </KeyIdea>
      <TryIt href="/rankings/redraft-ppr-sflex" label="See the superflex board">
        Every rankings board on this site has a superflex version. Flip between
        the one-quarterback board and the superflex board for your league type
        and watch the quarterbacks climb.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 2: how many quarterbacks ---------- */

function HowManySection() {
  return (
    <section aria-labelledby="how-many-heading" className="mt-12">
      <GuideSectionHeader
        id="how-many-heading"
        eyebrow="Lesson 2 of 8"
        heading="How many quarterbacks to roster, in redraft, dynasty and best ball"
      />
      <Para>
        This is the question I get asked most about the format, and the answer
        is short enough to remember: three in redraft, four in dynasty, one more
        than that in a true 2QB league. Here is the reasoning, so you can bend
        it when your league is unusual.
      </Para>
      <Para>
        Two start every week. The third exists for the weeks one of them is on a
        bye and for the one injury a season you should plan on, and he is worth
        having even if he starts three times all year, because the alternative
        in those three weeks is a flex player scoring half as much. A fourth in
        redraft is where it goes wrong. He sits on your bench for seventeen
        weeks, he scores nothing there, and the roster spot he takes could have
        held the running back handcuff who wins you week 14. Trade him instead,
        and the next lesson but two is about who to.
      </Para>
      <Para>
        Dynasty changes the fourth one from a waste to a stash. Quarterbacks
        hold their value for years, a backup who gets a starting job is worth a
        first-round pick overnight, and a dynasty bench is bigger. Best ball
        goes the other way: nobody sets a lineup, so the third quarterback is
        your bye cover and your injury cover at once, and the spare spots are
        better spent on receivers, where a random big week is more likely to be
        the one the platform counts. Fourteen teams pushes every number up by
        one, because twenty-eight starters out of thirty-two leaves nothing on
        the wire worth picking up.
      </Para>
      <div className="mt-6">
        <QbRosterPlanner />
      </div>
      <KeyIdea>
        Roster the quarterbacks you will actually start plus one for byes and
        injuries. In redraft that is three. In dynasty the fourth is an asset;
        in redraft he is a wasted spot.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 3: drafting ---------- */

function DraftSection() {
  return (
    <section aria-labelledby="draft-heading" className="mt-12">
      <GuideSectionHeader
        id="draft-heading"
        eyebrow="Lesson 3 of 8"
        heading="Drafting in superflex: one pillar, then let the run tell you"
        tone="purple"
      />
      <Para>
        Every superflex draft has a quarterback run. Somebody takes one in the
        first round, two more people panic, and by the end of round two ten or
        eleven of the twenty-four picks are quarterbacks. The run is not a
        mistake, exactly. Lesson 1 says those players really are worth that
        much. The mistake is being on the wrong side of it: either paying a
        first-round pick for the sixth-best quarterback because you were scared,
        or waiting it out and starting the twenty-fifth.
      </Para>
      <EarlyRoundsFigure />
      <Para>
        Here is the plan that has worked for me. Take one pillar quarterback in
        the first three rounds, a starter with a settled job and a full season
        of games ahead of him, and do not overthink which one. The pillar is
        insurance: whatever the room does after that, you have one of the
        twenty-four. Then take the best player available at every pick and watch
        the quarterback count. When the room takes three in a row, your second
        quarterback is next, because the tier is about to be empty. When the
        room ignores the position for a round, keep taking running backs and
        receivers, because every quarterback that goes early is a running back
        or receiver somebody left for you in round three, and those are the
        players who win a superflex league.
      </Para>
      <Para>
        Where you pick changes the plan more than in a one-quarterback league,
        because the run happens in the long gap between your picks. Pick a slot
        below and read it.
      </Para>
      <div className="mt-6">
        <DraftSlotPlan />
      </div>
      <Para>
        Two things the plan leaves out on purpose. It says nothing about which
        quarterbacks, because that is what the rankings boards and the{" "}
        <Link
          href="/guides/fantasy-football-draft-guide?format=redraft-ppr-sflex"
          className={LINK_CLASS}
        >
          draft guide&apos;s superflex list
        </Link>{" "}
        are for, rebuilt nightly. And it says nothing about auctions, where the
        same logic applies with a budget instead of a turn: spend on one pillar
        early, let the room overpay for the next four, and buy your second
        quarterback in the middle of the auction when the money has thinned out.
      </Para>
      <KeyIdea>
        One pillar quarterback in the first three rounds, then the best player
        available while you count the tier. Expect the run, and it stops being
        a problem.
      </KeyIdea>
      <TryIt href="/tools/on-the-clock" label="Open On The Clock">
        On The Clock connects to your live Sleeper draft and calls out a
        position run while it is happening, so you see the quarterback tier
        emptying before your pick rather than after.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 4: dynasty ---------- */

function DynastySection() {
  return (
    <section aria-labelledby="dynasty-heading" className="mt-12">
      <GuideSectionHeader
        id="dynasty-heading"
        eyebrow="Lesson 4 of 8"
        heading="Dynasty superflex: startups, rookie drafts and the long career"
      />
      <Para>
        Dynasty superflex is the format most of my leagues are in, and it is the
        one where the quarterback decision matters most, because you are not
        pricing one season. A running back is a three-year asset if you are
        lucky. A quarterback drafted at 24 can start for your dynasty team until
        you have forgotten who you traded to get him.
      </Para>
      <AgeCurveFigure />
      <Para>
        In a startup, that changes what an early pick is for. A 30-year-old
        quarterback in a good offense is a long-term asset in a way a
        30-year-old at any other position is not, so the room that prices
        quarterbacks on age the way it prices running backs is a room where you
        can buy a starter for years at a discount. The reverse is true of
        rookies: a rookie quarterback is worth a lot on draft day and usually
        nothing for a year while he sits or struggles, so the rookie draft is
        where you sell quarterback hype and the in-season market is where you
        buy the player.
      </Para>
      <Para>
        The 1.01 is a quarterback market. When a rookie class has a quarterback
        with a starting job, that pick is worth more in a twelve-team superflex
        league than in a one-quarterback league by a margin the{" "}
        <Link
          href="/guides/fantasy-football-trade-guide#picks-heading"
          className={LINK_CLASS}
        >
          trade guide
        </Link>{" "}
        walks through. When it does not, the pick is worth the best running back
        or receiver in the class, which is less, and the room often forgets to
        mark it down. Check the class before you price the pick.
      </Para>
      <Para>
        On the roster itself: four quarterbacks. Two starters, a bye cover, and
        a stash who is either a young backup with a path or a veteran the league
        has written off. That fourth quarterback is the best speculative asset
        in dynasty superflex, because the day his starter gets hurt he goes from
        a bench spot to a player three contenders are bidding for.
      </Para>
      <KeyIdea>
        In dynasty superflex, age a quarterback like a quarterback, not like a
        running back. The 30-year-old starter is a buy, the rookie is a sell on
        draft day, and the fourth quarterback on your bench is a lottery ticket
        that pays out every October.
      </KeyIdea>
      <TryIt
        href="/rankings/dynasty-ppr-sflex"
        label="See dynasty superflex rankings"
      >
        The dynasty superflex board carries every quarterback&apos;s value and
        its seven-day move, so a veteran the room is marking down for age shows
        up as a falling price you can check against his role.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 5: trades ---------- */

function TradesSection() {
  return (
    <section aria-labelledby="trades-heading" className="mt-12">
      <GuideSectionHeader
        id="trades-heading"
        eyebrow="Lesson 5 of 8"
        heading="Trading quarterbacks: your third one is value, not wins"
        tone="purple"
      />
      <Para>
        The{" "}
        <Link
          href="/guides/fantasy-football-trade-guide"
          className={LINK_CLASS}
        >
          trade guide
        </Link>{" "}
        says every trade has two readings, value and wins, and superflex is the
        format where they pull apart hardest. A starting NFL quarterback is
        worth a lot on any superflex value list. On your roster, if he is your
        third one, he starts twice a year and scores nothing the rest of the
        time. He is value with no wins attached, which makes him the perfect
        thing to sell to a team where he would be wins.
      </Para>
      <ThirdQbFigure />
      <Para>
        Who is that team? The one with two quarterbacks and a bye coming, or the
        one whose starter just went on injured reserve, or the one that waited
        out the run and is starting the twenty-fifth best quarterback every
        week. Look at every roster in your league and count the quarterbacks. A
        team with two needs a third and will pay a starter&apos;s price for him.
        A team with four has one to sell and will take less than he is worth to
        clear the spot. Both of those are trades you can make this week, and the
        calculator on this site will grade the value side in a few seconds.
      </Para>
      <Para>
        Timing follows the same calendar the trade guide lays out. The price of
        a backup quarterback peaks in the week his starter gets hurt, which is
        when a contender is most desperate, and bottoms out in August, when
        everyone has three. If you are rebuilding, hold your spare quarterback
        into the season and sell him in October. If you are contending, buy your
        third quarterback in August, when he is cheap, and never be the team
        bidding in October.
      </Para>
      <KeyIdea>
        A third quarterback is a starter on somebody else&apos;s roster and a
        bench spot on yours. Sell him to the team that has two, at the moment
        they need him most.
      </KeyIdea>
      <TryIt href="/tools/trade-calculator" label="Grade a superflex trade">
        Put both sides into the trade calculator with a superflex format
        selected. It reprices every quarterback for the slot, and in a dynasty
        format the picks are priced for it too.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 6: the season ---------- */

function SeasonSection() {
  return (
    <section aria-labelledby="season-heading" className="mt-12">
      <GuideSectionHeader
        id="season-heading"
        eyebrow="Lesson 6 of 8"
        heading="Managing the season: byes, backups and the second slot"
      />
      <Para>
        A one-quarterback league lets you forget about the position from
        September to December. Superflex does not, because two slots means twice
        the bye weeks, twice the injuries, and a second slot that needs a
        decision every week you are short.
      </Para>
      <GuideSubheading className="mt-8">
        Check the byes against each other
      </GuideSubheading>
      <Para>
        The third quarterback covers byes only if his bye is not the same week
        as one of the other two. Nobody checks this in the draft, and every year
        somebody finds out in week 7 that their cover is on the same bye as
        their starter. Look up the three bye weeks the day after your draft, and
        if two collide, fix it while August prices are still low.
      </Para>
      <ByeGridFigure />
      <GuideSubheading className="mt-8">
        Know who is next in line
      </GuideSubheading>
      <Para>
        The best waiver pickup in superflex is the backup who is about to start,
        and he is on the wire the week before it happens, not the week after.
        Keep an eye on the quarterbacks whose starters are playing through
        something, and on rookies who are one bad half from getting the job. On
        the week the change is announced he is a{" "}
        <Link href="/guides/faab-strategy" className={LINK_CLASS}>
          new weekly starter and priced like one
        </Link>
        ; the week before, he is a stash for a dollar.
      </Para>
      <GuideSubheading className="mt-8">
        Streaming the second slot
      </GuideSubheading>
      <Para>
        When you are short, stream. A quarterback with a soft matchup and a high
        team total is a fine second starter for one week, and in a twelve-team
        superflex league there are usually two or three on the wire. The{" "}
        <Link href="/tools/who-should-i-start" className={LINK_CLASS}>
          start/sit tool
        </Link>{" "}
        grades any two of them with the matchup already in the projection and
        the game&apos;s implied total shown beside it. The one rule: never
        leave the superflex slot empty. A
        flex running back scoring 8 is not a quarterback, but he is not zero
        either, and zero is what an empty slot scores.
      </Para>
      <KeyIdea>
        Superflex is a position you manage all season. Check the byes, watch the
        backups, and stream the second slot rather than leaving it empty.
      </KeyIdea>
      <TryIt href="/tools/faab" label="Price a quarterback claim">
        The FAAB calculator prices a pickup against your real roster, weeks
        started included, so a backup about to start gets a number that reflects
        how many weeks he actually starts for you.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 7: TE premium ---------- */

function TepSection() {
  return (
    <section aria-labelledby="tep-heading" className="mt-12">
      <GuideSectionHeader
        id="tep-heading"
        eyebrow="Lesson 7 of 8"
        heading="TE premium on top of superflex: two settings that stack"
        tone="purple"
      />
      <Para>
        Most of the superflex leagues I am in also run{" "}
        <Link
          href="/guides/fantasy-football-terms#te-premium"
          className={LINK_CLASS}
        >
          TE premium
        </Link>
        , and people treat the two as one setting. They are not. Superflex
        changes how many quarterbacks the league needs. TE premium changes what
        a tight end&apos;s catch is worth, usually half a point or a full point
        more than anyone else&apos;s, and it does its work at the top of the
        position, because the best tight ends catch twice as many passes as the
        replacement.
      </Para>
      <TePremiumFigure />
      <Para>
        Put the two together and the early rounds get crowded. Quarterbacks go
        early because the slot needs them, and the two or three elite tight ends
        go early because the premium widens their gap over the free one. That
        leaves fewer early picks for running backs and receivers, which is
        exactly why the good ones fall further in a TE premium superflex draft
        than anywhere else. If you are not going to get a top tight end, do not
        pay a middle-round price for the fifth one: the premium barely moves the
        middle of the position, and the running back who fell is worth more.
      </Para>
      <Para>
        On this site the two formats are separate boards, because the values
        really are different:{" "}
        <Link href="/rankings/dynasty-ppr-tep-sflex" className={LINK_CLASS}>
          dynasty TE premium superflex
        </Link>{" "}
        and{" "}
        <Link href="/rankings/redraft-ppr-tep-sflex" className={LINK_CLASS}>
          redraft TE premium superflex
        </Link>
        . When a league is synced through League Pulse the format is read off
        the league&apos;s own settings, so the values inside a league page are
        already the right ones.
      </Para>
      <KeyIdea>
        Superflex prices the quarterback slot. TE premium prices the top of the
        tight end position. In a league with both, the players who fall are the
        running backs and receivers, and they are where the value is.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 8: your own league ---------- */

function LeagueSection() {
  return (
    <section aria-labelledby="league-heading" className="mt-12">
      <GuideSectionHeader
        id="league-heading"
        eyebrow="Lesson 8 of 8"
        heading="Read your own league: how steep the quarterback line really is"
      />
      <Para>
        Everything above is the general case. Your league is a specific one,
        with its own scoring, its own roster size and its own twelve managers,
        and the quarterback line in it is as steep as those settings make it.
        Six points a passing touchdown and a bonus for 300 yards makes the top
        quarterbacks worth more. A fourteen-team room makes the free one worse.
        A league that starts three receivers and two flexes spreads the scarcity
        around.
      </Para>
      <Para>
        Open your league in{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>{" "}
        and pick Positional WAR from the league menu. You get one line per
        position, built from your league&apos;s own scoring and slots, with the
        replacement player found by filling a league&apos;s worth of lineups
        once from every projectable player, rather than assumed from a rule of
        thumb. In a superflex league the
        quarterback line is steep, and how steep tells you how hard to chase the
        position: a line that falls off a cliff after QB8 says pay up for one of
        the eight; a line that slopes gently to QB20 says you can wait.
      </Para>
      <GuideSubheading className="mt-8">2QB and best ball</GuideSubheading>
      <Para>
        A{" "}
        <Link href="/guides/fantasy-football-terms#2qb" className={LINK_CLASS}>
          true 2QB league
        </Link>{" "}
        is superflex with the fallback removed: the second slot must hold a
        quarterback, so an empty one is a zero rather than a flex player scoring
        8. Everything here applies with the volume turned up. Roster one more,
        take your pillar a round earlier, and never let both byes land in the
        same week. Best ball superflex applies the draft lessons and none of the
        in-season ones, because there is no in-season: three quarterbacks,
        drafted with the same one-pillar plan, and the platform picks the best
        two every week.
      </Para>
      <KeyIdea>
        The general rules get you to the draft. Your league&apos;s own curve
        tells you how hard to push them, and it is one click away once the
        league is synced.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        Sync your Sleeper league and the Positional WAR page draws the
        quarterback line for your rules, with your own players marked on it.
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
            <strong className="text-ink">Waiting out the run.</strong> The room
            took ten quarterbacks and you took none. You are starting QB25 in
            week 1 and trading a second-round pick for QB14 in week 3.
          </>,
          <>
            <strong className="text-ink">Panicking into the run.</strong> Three
            quarterbacks went and you took the sixth-best one at pick 9. The
            running back you passed on is the one your opponent starts against
            you in the playoffs.
          </>,
          <>
            <strong className="text-ink">Four quarterbacks in redraft.</strong>{" "}
            The fourth one starts zero games and costs you the handcuff.
          </>,
          <>
            <strong className="text-ink">Two byes in one week.</strong> Nobody
            checked. Week 7 has an empty slot.
          </>,
          <>
            <strong className="text-ink">
              Pricing a 30-year-old quarterback like a 30-year-old back.
            </strong>{" "}
            He has five good years left. The room is selling him like he has
            one.
          </>,
          <>
            <strong className="text-ink">Holding the third quarterback.</strong>{" "}
            He is worth a starter to the team with two, and you are keeping him
            for a bye week in November.
          </>,
          <>
            <strong className="text-ink">Reading the one-QB board.</strong>{" "}
            Every rankings board on this site has a superflex version. If the
            quarterbacks look too low, you are on the wrong board.
          </>,
          <>
            <strong className="text-ink">Leaving the slot empty.</strong> A flex
            player scoring 8 beats a zero every week of the season.
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
        heading="A worked draft, with made-up picks"
      />
      <Para>
        Say you have the seventh pick in a twelve-team PPR superflex redraft
        league that starts one quarterback, two running backs, three receivers,
        a tight end, a flex and the superflex. You pick 7th, then 18th, then
        31st, then 42nd, and so on. Here is the whole method, in order, with the
        room behaving the way rooms behave.
      </Para>
      <GuideTable
        caption="An invented draft, walked through the way this guide reasons. Every pick and every count here is made up."
        head={["Pick", "What the room did", "What I do, and why"]}
        rows={[
          [
            "1.07",
            "Two quarterbacks and four running backs are gone.",
            "The best receiver on the board. Three quarterbacks I would be happy with are still there, and ten picks pass before my next turn.",
          ],
          [
            "2.06 (pick 18)",
            "Four more quarterbacks went in those ten picks. The run is on.",
            "My pillar quarterback, the best of the two left in the tier. That is one of the twenty-four locked in.",
          ],
          [
            "3.07 (pick 31)",
            "The room has taken nine quarterbacks. Running backs have slid.",
            "A running back who would have gone in round two in a one-quarterback league. This is the value the run created.",
          ],
          [
            "4.06 (pick 42)",
            "One more quarterback went. Twelve are gone, twelve of the twenty-four remain.",
            "The best player available, a receiver. I count: four quarterbacks I like are left and twelve picks to my next turn. Some will survive.",
          ],
          [
            "5.07 (pick 55)",
            "Three quarterbacks went in a row. The tier has two names left.",
            "My second quarterback, now, because the tier is about to be empty. Two of the twenty-four are mine.",
          ],
          [
            "6 to 9",
            "The room fills out lineups.",
            "Running backs and receivers. I do not look at a quarterback again for four rounds.",
          ],
          [
            "10 or 11",
            "Backups start going.",
            "My third quarterback: a starter on a bad team with a bye that does not collide with my first two. I check all three byes before I click.",
          ],
          [
            "After the draft",
            "",
            "I look at every roster and count quarterbacks. The team with four is my first trade target in September. The team with two is who I sell to in October.",
          ],
        ]}
      />
      <Para>
        Notice that the two quarterback picks were decided by counting the tier,
        not by a rule about rounds. From the seventh pick the pillar came in
        round two because the run started; from the eleventh pick it would have
        come at the turn; from the third pick it might have waited until round
        three. The plan is the same in every seat. The timing is the
        room&apos;s.
      </Para>
      <TryIt href="/games/would-you-rather" label="Play Would You Rather">
        Want reps at pricing quarterbacks? Would You Rather puts a real trade
        from a real league in front of you, superflex leagues included, and asks
        you to call the winner before it shows the grade.
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
        heading="Before your draft"
        tone="purple"
      />
      <Para>
        Eight questions, one draft. If you cannot tick one, you have homework
        before the clock starts, and it takes ten minutes.
      </Para>
      <div className="mt-6">
        <DraftChecklist />
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

/* ---------- Closing ---------- */

function ClosingSection() {
  return (
    <section aria-labelledby="closing-heading" className="mt-12">
      <GuideSectionHeader
        id="closing-heading"
        eyebrow="Next"
        heading="Take it into your own league"
        tone="purple"
      />
      <Para>
        The boards are the{" "}
        <Link href="/rankings/redraft-ppr-sflex" className={LINK_CLASS}>
          redraft superflex rankings
        </Link>
        , the{" "}
        <Link href="/rankings/dynasty-ppr-sflex" className={LINK_CLASS}>
          dynasty superflex rankings
        </Link>{" "}
        and the two TE premium versions, rebuilt nightly. The draft is{" "}
        <Link href="/tools/on-the-clock" className={LINK_CLASS}>
          On The Clock
        </Link>
        , which watches the run for you. The trades are the{" "}
        <Link href="/tools/trade-calculator" className={LINK_CLASS}>
          trade calculator
        </Link>
        , and the season is{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>
        , where your league&apos;s own quarterback line lives. If you want the
        vocabulary first, superflex, 2QB, TE premium and the rest are in the{" "}
        <Link
          href="/guides/fantasy-football-terms#formats"
          className={LINK_CLASS}
        >
          glossary
        </Link>
        .
      </Para>
    </section>
  );
}
