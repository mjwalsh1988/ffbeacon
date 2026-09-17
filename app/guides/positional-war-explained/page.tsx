import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
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
  MarkerFigure,
  PointsToWinsFigure,
  ReplacementLineFigure,
  SamePointsDifferentGapFigure,
  SteepVsFlatFigure,
} from "./war-figures";
import { MoveTheLine, WhichQuestion } from "./war-classroom";

/**
 * /guides/positional-war-explained
 *
 * The beginner's guide to the one number on this site nobody else publishes.
 * Written in Michael's first person, in plain words, for a reader who has
 * heard "WAR" on a podcast and has no idea what it means on a fantasy roster.
 *
 * Seven lessons, each with a diagram or an interactive, in the course shape
 * the trade guide set: a short version, a syllabus, a key idea per lesson, and
 * a pointer at the tool that runs the lesson's arithmetic.
 *
 * NAMING RULE (CLAUDE.md, Positional WAR). The token "WAR" names exactly one
 * metric in this product and carries the word "Positional" beside it on first
 * use in any surface. This page is the surface where a reader learns the
 * word, so it is careful about it: the title, the h1 and the first sentence
 * of the body all say "Positional WAR", and the team-specific question is
 * called "projected wins" and "wins added", never WAR. The figures and the
 * interactives keep the same rule in every string.
 *
 * EVERY MECHANICAL CLAIM MATCHES THE CODE. The replacement player is the best
 * benched player at the position after every team's lineup is filled once
 * (lib/positional-war/replacement.ts, definition A). Points above replacement
 * are turned into wins through a league-average team and a league-average
 * opponent, week by week, and summed (lib/positional-war/war.ts). The model
 * reads no roster, never varies by value source or format, ignores draft
 * picks, and runs on projections for the games still to play. The marker on
 * the curve carries its real value rather than an asserted zero
 * (war_at_demand). Nothing here promises a mechanism the engine does not have.
 *
 * THE WORKED NUMBERS ARE MADE UP AND SAY SO. A guide that quoted a live league
 * would go stale nightly; one that invents a league and labels it invented
 * does not. Every figure caption and both interactives say so in words.
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders so the two cannot disagree.
 */

const SLUG = "positional-war-explained";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-15T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Positional WAR Explained: What WAR Means in Fantasy Football";
const DESCRIPTION =
  "Positional WAR in fantasy football, explained for beginners: what a replacement player is, why scarcity beats raw points, and how to read the curve.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "war fantasy football",
    "war meaning fantasy football",
    "wins above replacement fantasy football",
    "positional war",
    "positional scarcity fantasy football",
    "how to calculate positional scarcity fantasy football",
    "replacement level fantasy football",
    "value over replacement fantasy football",
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
  { id: "meaning-heading", label: "What Positional WAR means" },
  { id: "replacement-heading", label: "The replacement player" },
  { id: "points-lie-heading", label: "Why points lie to you" },
  { id: "wins-heading", label: "From points to wins" },
  { id: "curve-heading", label: "Reading the curve" },
  { id: "two-questions-heading", label: "Positional WAR versus your team" },
  { id: "use-heading", label: "Three decisions it changes" },
  { id: "honest-heading", label: "How it is calculated, honestly" },
  { id: "faq-heading", label: "Questions, answered" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "What does Positional WAR mean in fantasy football?",
    answer:
      "Wins above replacement. It is how many more of your weekly matchups you should win over the season because you start a particular player instead of the best player at his position that nobody in your league starts. On FF Beacon it is called Positional WAR, and it is worked out for your league's own scoring and starting lineup.",
  },
  {
    question: "Is a higher Positional WAR always the better player?",
    answer:
      "Higher Positional WAR means the player is worth more in that league, which is a different thing from being better at football. The same tight end can carry a big number in a tight end premium league and a small one in a standard league without playing a single snap differently. Positional WAR measures how hard he is to replace, in your rules.",
  },
  {
    question: "What is a replacement player?",
    answer:
      "The best player at a position who would not make a starting lineup anywhere in your league. In a twelve-team league that starts one quarterback, that is roughly the thirteenth-best quarterback. Every player at the position is measured against him, so when he is bad, the good players are worth more.",
  },
  {
    question:
      "Why does my quarterback have a low Positional WAR when he scores the most points?",
    answer:
      "Because in a one-quarterback league the replacement quarterback also scores a lot of points. What matters is the gap between your guy and the free one, not the total. Turn on superflex, where teams start two quarterbacks and the replacement becomes the twenty-fifth-best passer, and the same player's Positional WAR jumps without him getting any better.",
  },
  {
    question: "Where do I see Positional WAR for my league?",
    answer:
      "Open your league in League Pulse and pick Positional WAR from the league menu. It reads your Sleeper league's scoring settings and roster slots and draws one curve per position, with your own players marked on it if you have told the site who you are.",
  },
  {
    question: "Does Positional WAR change when I switch the value source?",
    answer:
      "No. It is built from weekly projections scored under your league's own rules, not from trade values, so the source toggle in the site header has no effect on it. Draft picks are not on the curve either, because a pick cannot start on Sunday.",
  },
];

export default async function PositionalWarGuide() {
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
      about: {
        "@type": "Thing",
        name: "Wins above replacement in fantasy football",
      },
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
          title="Positional WAR explained: what WAR actually means in fantasy football"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "For beginners", tone: "purple" },
            { label: `${LESSONS.length} lessons`, tone: "cyan" },
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
            <MeaningSection />
            <ReplacementSection />
            <PointsLieSection />
            <WinsSection />
            <CurveSection />
            <TwoQuestionsSection />
            <UseSection />
            <HonestSection />
            <FaqSection />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Still fuzzy on it?"
        heading="Ask a real person, free."
        body="If a number on your league's Positional WAR page does not make sense, bring the league into our Discord and somebody will walk through it with you. I am in there too."
        isMember={isMember}
        memberHeading="Now go look at your own league."
        memberBody="You're already in the crew, so we'll skip the invite. Open a league in League Pulse and the curve is one click away."
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

/** A pointer at the tool that shows the lesson's number for a real league. */
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

/** A small invented-numbers table, labelled as invented in its caption. */
function ExampleTable({
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
      <table className="w-full min-w-[28rem] text-sm">
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
            <tr key={row[0]} className="border-b border-line/60 last:border-0">
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
                    className="px-4 py-2.5 tabular-nums text-ink-muted"
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
          Positional WAR, wins above replacement by position, answers one
          question: how many more games do I win this season because I start
          this player instead of the best guy at his position that nobody in my
          league starts? The question is who is hardest to replace, in your
          league, under your rules, and that is a different question from who
          scores the most. Once that clicks, a lot of draft, waiver and trade
          decisions get easier.
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
      title: "What Positional WAR means",
      href: "#meaning-heading",
      takeaway: "One question, asked about your league.",
    },
    {
      n: "02",
      title: "The replacement player",
      href: "#replacement-heading",
      takeaway: "The free player decides everything.",
    },
    {
      n: "03",
      title: "Why raw points lie",
      href: "#points-lie-heading",
      takeaway: "The gap wins the matchup, not the total.",
    },
    {
      n: "04",
      title: "From points to wins",
      href: "#wins-heading",
      takeaway: "One slot different, one week at a time.",
    },
    {
      n: "05",
      title: "Reading the curve",
      href: "#curve-heading",
      takeaway: "Steep means pay up. Flat means wait.",
    },
    {
      n: "06",
      title: "The position versus your team",
      href: "#two-questions-heading",
      takeaway: "Two numbers that are allowed to disagree.",
    },
    {
      n: "07",
      title: "Three decisions it changes",
      href: "#use-heading",
      takeaway: "Your draft, your waiver budget, your trades.",
    },
  ];

function Syllabus() {
  return (
    <section aria-labelledby="syllabus-heading" className="mt-8">
      <h2
        id="syllabus-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        The seven lessons
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

/* ---------- Lesson 1: what Positional WAR means ---------- */

function MeaningSection() {
  return (
    <section aria-labelledby="meaning-heading" className="mt-12">
      <GuideSectionHeader
        id="meaning-heading"
        eyebrow="Lesson 1 of 7"
        heading="What Positional WAR actually means"
        tone="purple"
      />
      <Para>
        You have probably heard the phrase from baseball. Wins above replacement
        is the stat that lets people compare a shortstop to a pitcher by asking
        how many wins each one adds over a player you could pick up for nothing.
        Positional WAR is that same idea moved onto a fantasy roster. Instead of
        a real team, the team is yours. Instead of a real win, the win is your
        head-to-head matchup on Sunday.
      </Para>
      <Para>
        So the question is always the same, and I want you to hear it in plain
        words: if I put this player in my lineup instead of the best free player
        at his position, how many more matchups do I win over the rest of the
        season? A number like 0.65 means about two thirds of a win. A number
        like 0.05 means he is barely better than what you could grab off waivers
        this afternoon.
      </Para>
      <Para>
        That is the whole thing. Everything else on this page is just me
        explaining who the free player is, why he decides everything, and how a
        gap in points turns into a gap in wins.
      </Para>
      <KeyIdea>
        Positional WAR is one question: how many more matchups do I win because
        I start this player instead of the best one nobody in my league starts?
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 2: the replacement player ---------- */

function ReplacementSection() {
  return (
    <section aria-labelledby="replacement-heading" className="mt-12">
      <GuideSectionHeader
        id="replacement-heading"
        eyebrow="Lesson 2 of 7"
        heading="The replacement player decides everything"
      />
      <Para>
        Every position in your league has a line. Above the line are the players
        somebody starts. Below it are the players nobody starts, sitting on a
        bench or on the waiver wire. The best player just below that line is the
        replacement player. He is the one you could have for free, so he is the
        one every starter gets measured against.
      </Para>
      <ReplacementLineFigure />
      <Para>
        Where the line sits depends entirely on your league. Twelve teams that
        each start one quarterback need twelve quarterbacks, so the replacement
        quarterback is roughly the thirteenth best. Twelve teams that each start
        two running backs plus a flex need at least twenty-four backs, and
        usually a few more once the flex spots fill, so the replacement running
        back is somewhere around the twenty-eighth best. That is a much worse
        player, and it is why a good running back is worth so much more than his
        points alone suggest.
      </Para>
      <Para>
        Here is a made-up twelve-team league to make it concrete. The numbers
        are invented, but the shape is what you will see in a real one.
      </Para>
      <ExampleTable
        caption="An invented twelve-team league that starts 1 QB, 2 RB, 3 WR, 1 TE and a flex. Points are per week."
        head={["Position", "Best starter", "Replacement player", "Gap"]}
        rows={[
          ["Quarterback", "22.0", "16.5 (QB13)", "5.5"],
          ["Running back", "18.5", "8.5 (about RB28)", "10.0"],
          ["Wide receiver", "17.5", "9.0 (about WR40)", "8.5"],
          ["Tight end", "13.0", "6.0 (TE13)", "7.0"],
        ]}
      />
      <Para>
        Look at the quarterback row. He scores the most points of anyone on the
        table and has the smallest gap, because the guy you could get for free
        at his position is also pretty good. Now look at the running back. Fewer
        points, biggest gap. That gap is what you are paying for when you pay up
        for a running back, and it is what Positional WAR measures.
      </Para>
      <Para>
        Now change the rules and watch the line move. Nothing about any player
        changes in the box below. Only the league does.
      </Para>
      <div className="mt-6">
        <MoveTheLine />
      </div>
      <KeyIdea>
        The replacement player is the best one nobody in your league starts, and
        where that line sits is set by your league&apos;s rules, not by the
        players.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 3: why points lie ---------- */

function PointsLieSection() {
  return (
    <section aria-labelledby="points-lie-heading" className="mt-12">
      <GuideSectionHeader
        id="points-lie-heading"
        eyebrow="Lesson 3 of 7"
        heading="Why raw points lie to you"
        tone="purple"
      />
      <Para>
        The most common mistake I see, and one I made for years, is ranking
        players by how many points they score. It feels right. More points is
        more good. But your matchup is not you against zero. It is you against
        another team that also has a quarterback, also has two running backs,
        also has a tight end. What decides the matchup is where you beat them by
        more than they beat you, and that comes from the gaps, not the totals.
      </Para>
      <SamePointsDifferentGapFigure />
      <Para>
        Tight end is the cleanest example. In most leagues the top tight end
        scores less than a mid-range wide receiver, so on a points list he looks
        ordinary. But the replacement tight end is often awful, so the top guy
        wins you his slot by a wide margin every single week. Add a tight end
        premium rule that pays extra per catch and the gap opens further. That
        is why an elite tight end goes so early in a TE premium draft, and why
        the same player goes much later in standard scoring. Nothing about him
        changed. The replacement did.
      </Para>
      <Para>
        Superflex is the other big one. Let teams start a second quarterback and
        suddenly the league needs twenty-four of them. The replacement
        quarterback becomes somebody who might not even start for his NFL team,
        the gap at the top explodes, and quarterbacks go in the first round.
        Same players, different rules, completely different answer. Positional
        WAR is the number that tracks that change for you instead of asking you
        to feel it out.
      </Para>
      <KeyIdea>
        Your matchup is decided by the gaps, not the totals. The player who wins
        you his slot by the most is the one worth paying for, whatever his raw
        points say.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 4: from points to wins ---------- */

function WinsSection() {
  return (
    <section aria-labelledby="wins-heading" className="mt-12">
      <GuideSectionHeader
        id="wins-heading"
        eyebrow="Lesson 4 of 7"
        heading="How a gap in points becomes a gap in wins"
      />
      <Para>
        A gap of ten points a week is obviously worth more than a gap of two.
        But how much more, in wins? This is the part that sounds like math and
        is really just one idea. Imagine a team in your league that is average
        at every starting spot except one, where it is stuck starting the
        replacement player at your guy&apos;s position. Against an average
        opponent that team wins a little less than half the time.
      </Para>
      <Para>
        Now put your guy into that one slot. The team scores more, so its chance
        of winning that week goes up, by a little for a small gap and by a lot
        for a big one, depending too on how much scores in your league tend to
        swing. The difference between the two chances is what he was worth that
        week. Do that for every week left in the season and add the differences
        up. That sum is his Positional WAR.
      </Para>
      <PointsToWinsFigure />
      <Para>
        A few things fall out of this that are worth knowing. A player who is
        exactly replacement level scores zero, by definition. By default nobody
        is ever below zero: a player under the replacement line is scored as
        zero rather than negative, because you would just not start him. And a
        player is worth more in a league where weekly scores are tight than in
        one where they swing wildly, because a five-point edge changes a close
        game and does not change a blowout. The engine measures that swing from
        your league&apos;s own projections rather than assuming one.
      </Para>
      <KeyIdea>
        One average team, one slot different, one week at a time. The change in
        win chance is what the player was worth that week, and the season figure
        is those weeks added up.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 5: reading the curve ---------- */

function CurveSection() {
  return (
    <section aria-labelledby="curve-heading" className="mt-12">
      <GuideSectionHeader
        id="curve-heading"
        eyebrow="Lesson 5 of 7"
        heading="How to read the Positional WAR curve"
        tone="purple"
      />
      <Para>
        Open any league in{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>{" "}
        and pick Positional WAR from the league menu. You get one line per
        position. Left to right is the rank at that position, best player first.
        Up and down is Positional WAR. Every line starts high and falls toward
        zero, and the shape of the fall is the whole story. There is also a
        relative depth view that lines up every position&apos;s replacement
        point at the same spot, which makes the shapes easier to compare.
      </Para>
      <SteepVsFlatFigure />
      <GuideSubheading className="mt-8">A steep line</GuideSubheading>
      <Para>
        The position runs out fast. The drop from the best player to the fifth
        is big, and the drop from the fifth to the tenth is big again. That is a
        position where the top players are worth paying up for, because once
        they are gone, what is left is a long way behind. In most leagues that
        is running back, and in superflex it is quarterback.
      </Para>
      <GuideSubheading className="mt-6">A flat line</GuideSubheading>
      <Para>
        The next player down is nearly as good as the one above him. Paying a
        premium for the top of a flat line is how people waste a second-round
        pick or half a FAAB budget, because the guy who costs a tenth as much
        gets you most of the way there. Wide receiver in a three-receiver league
        often looks like this in the middle: a real cliff at the very top, then
        a long gentle slope where the twentieth and thirtieth receivers are
        separated by almost nothing.
      </Para>
      <GuideSubheading className="mt-6">The marker</GuideSubheading>
      <Para>
        There is a hollow marker on each line at the last player your league
        actually starts at that position. You might expect the line to hit zero
        there, and it does not, on purpose. The number of players a league needs
        is counted from a week with no byes, but a player is worth the most on
        exactly the weeks when byes thin the position out, so the last starter
        is still worth something. The page labels the marker with its real value
        rather than pretending it is zero.
      </Para>
      <MarkerFigure />
      <GuideSubheading className="mt-8">Your own players</GuideSubheading>
      <Para>
        If the site knows your Sleeper handle, your players are marked on their
        lines, injured ones included. That last part is deliberate: an injured
        starter still has a real rank, and if you own him you want to see
        exactly where he sits, not have him quietly removed.
      </Para>
      <KeyIdea>
        Read the shape, not the height. A steep line is a position to pay up
        for; a flat line is a position to wait on; the hollow marker is where
        your league stops needing starters.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        Sync your Sleeper league and the Positional WAR page draws every one of
        these lines from your league&apos;s own scoring and roster slots, with
        your players marked on them.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 6: two questions ---------- */

function TwoQuestionsSection() {
  return (
    <section aria-labelledby="two-questions-heading" className="mt-12">
      <GuideSectionHeader
        id="two-questions-heading"
        eyebrow="Lesson 6 of 7"
        heading="Positional WAR versus what a player does for your team"
      />
      <Para>
        This is the part people get tangled in, so I want to be direct about it.
        Positional WAR is about the position, not about you. It never looks at
        your roster. It measures every player against an average team, so the
        curve is the same for every manager in the league. That is what makes it
        useful for pricing: it tells you what a position is worth in this
        league, full stop.
      </Para>
      <Para>
        What a specific player does for your specific team is a different
        question, and this site calls it something different: projected wins, or
        wins added. That one does read your roster. It runs the rest of your
        season with and without the player and tells you what changed. The two
        numbers legitimately disagree, and the disagreement is the point. A
        league where the best quarterback carries 0.65 Positional WAR still
        gives you almost nothing for trading for him if you already start the
        second-best quarterback, because he would be replacing a great player on
        your team rather than a replacement-level one.
      </Para>
      <Para>
        So use them in order. Positional WAR tells you which positions deserve
        your money. The team-specific number, on the{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          FAAB calculator
        </Link>{" "}
        and in a league&apos;s Trade Ideas, tells you whether a particular move
        is worth it for you. When somebody uses the word for the second thing,
        they are using it wrong, and on this site you will never see it used
        that way.
      </Para>
      <Para>Four questions. Sort each one before you read on.</Para>
      <div className="mt-6">
        <WhichQuestion />
      </div>
      <KeyIdea>
        Positional WAR answers a question about the position and reads no
        roster. Projected wins answers a question about your team and reads
        yours. Use the first to pick where to spend, and the second to decide
        whether a specific move is worth it.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 7: three uses ---------- */

function UseSection() {
  return (
    <section aria-labelledby="use-heading" className="mt-12">
      <GuideSectionHeader
        id="use-heading"
        eyebrow="Lesson 7 of 7"
        heading="Three decisions it should change"
        tone="purple"
      />
      <GuideSubheading className="mt-6">Your draft</GuideSubheading>
      <Para>
        Before a startup or an auction, look at which lines are steep. Those are
        the positions to spend early picks or real auction dollars on, because
        the drop-off is coming and you do not want to be on the wrong side of
        it. The flat lines are where you wait: the player you get four rounds
        later is nearly as good. Our{" "}
        <Link
          href="/guides/fantasy-football-draft-guide"
          className={LINK_CLASS}
        >
          draft guide
        </Link>{" "}
        uses the same points-above-replacement idea to find the players the room
        is late on.
      </Para>
      <GuideSubheading className="mt-6">Your waiver budget</GuideSubheading>
      <Para>
        The most expensive FAAB mistake is emptying the budget for a player at a
        flat position. If the twentieth receiver is nearly as good as the
        twelfth, then the exciting waiver receiver everyone is chasing is nearly
        as good as the one nobody wants. Save the big bid for a steep position,
        where the pickup really is hard to replace. The{" "}
        <Link href="/guides/faab-strategy" className={LINK_CLASS}>
          FAAB strategy guide
        </Link>{" "}
        goes through this in detail.
      </Para>
      <GuideSubheading className="mt-6">Your trades</GuideSubheading>
      <Para>
        Two-for-one trades are where scarcity hides. Giving up two decent
        receivers for one great running back looks fair on a values list and can
        be a steal on the curve, because you are trading two players from a flat
        line for one from a steep one, and the receiver you pick up off waivers
        to fill the empty slot is not far behind the ones you sent away. Run the
        deal through the{" "}
        <Link href="/tools/trade-calculator" className={LINK_CLASS}>
          trade calculator
        </Link>{" "}
        for the values, then look at where each player sits on the curve for the
        part values miss.
      </Para>
      <KeyIdea>
        Spend early picks and big bids on the steep lines, wait on the flat
        ones, and in a two-for-one, notice which line each player came from.
      </KeyIdea>
      <TryIt
        href="/guides/fantasy-football-trade-guide"
        label="Read the trade guide"
      >
        The trade guide takes the two-for-one apart lesson by lesson, including
        the roster spot you get back and which free agent fills it.
      </TryIt>
    </section>
  );
}

/* ---------- Honest section ---------- */

function HonestSection() {
  return (
    <section aria-labelledby="honest-heading" className="mt-12">
      <GuideSectionHeader
        id="honest-heading"
        eyebrow="Honestly"
        heading="How it is calculated, and what it leaves out"
      />
      <Para>
        Positional WAR is built from weekly projections for the games still to
        play, scored under your league&apos;s own scoring settings and roster
        slots. Every team&apos;s lineup in the league is filled once, optimally,
        from every projectable player, and the replacement player at each
        position is simply the best one left on the bench after that fill.
        Points above replacement go through the average-team, average-opponent
        conversion above, week by week, and get summed.
      </Para>
      <Para>
        It does not read anyone&apos;s roster, so it never changes because of a
        trade. It does not change when you switch the value source in the site
        header, because it is not built from trade values at all. Draft picks
        are not on it, because a 2028 first cannot start on Sunday. And it only
        knows what the projections know: an injury is reflected once the
        designation is published, and nothing here predicts one. The full
        methodology for the projections underneath it is in{" "}
        <Link href="/guides/how-ff-beacon-works" className={LINK_CLASS}>
          How FF Beacon works
        </Link>
        .
      </Para>
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
        tone="purple"
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
        heading="Go look at your own league"
      />
      <Para>
        Reading about scarcity is one thing; seeing that your league&apos;s
        tight end line falls off a cliff after the fourth guy is another. Open
        your league in{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>
        , pick Positional WAR, and find the steepest line. That is where your
        next dollar should go. If you want the vocabulary first, the{" "}
        <Link href="/guides/fantasy-football-terms#war" className={LINK_CLASS}>
          glossary entry
        </Link>{" "}
        is the one-paragraph version of this page.
      </Para>
    </section>
  );
}
