import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
import { createClient } from "@/lib/supabase/server";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  DRAFT_CAPITAL,
  ROOKIE_GUIDE_LESSONS,
  ROOKIE_GUIDE_SLUG,
  ROOKIE_PICK_HIT_RATES,
  buildRookieFaq,
} from "@/lib/guides/dynasty-rookie-draft";
import { loadRookieGuideData } from "@/lib/guides/rookie-draft-data";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc } from "@/components/guides/guide-toc";
import { GuideSectionHeader, GuideSubheading } from "@/components/guides/guide-section-header";
import { FaqAccordion } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import {
  ClassBoardFigure,
  DraftMonthFigure,
  DraftShapeFigure,
  KeyFigures,
  PickLadderFigure,
  PriceCalendarFigure,
  PriceHistoryFigure,
  QbGapFigure,
} from "./rookie-figures";
import {
  CapitalExplorer,
  ClockCall,
  PickFinder,
  PickOdds,
  PostDraftChecklist,
  RookieSorter,
} from "./rookie-classroom";

/**
 * /guides/dynasty-rookie-draft
 *
 * Ten lessons on the dynasty rookie draft and the offseason around it: how
 * the draft runs, when it happens, the odds and the price of every pick, how
 * pick prices move through the year, how to read the NFL draft, and how to
 * trade before, during and after.
 *
 * WHERE THE NUMBERS COME FROM. Three kinds, and each figure says which it is.
 *   - LIVE, from our own tables through lib/guides/rookie-draft-data.ts: the
 *     shape and timing of the rookie drafts we synced from Sleeper, where the
 *     newest class went in them, and today's price of each pick slot. Each of
 *     those reads can fail on its own, and a lesson is written to stand without
 *     its figure.
 *   - PUBLISHED: Dynasty Nerds (pick hit rates), Footballguys (draft capital
 *     and the pick price calendar), ESPN (the second-year jump). Attributed in
 *     the sentence that uses them and listed under Sources.
 *   - RULES OF THUMB: the two sorting boxes, labeled as the guide's own.
 *
 * SOURCE AND FORMAT. The two value figures follow the reader's value source
 * and league format through the usual chain (URL, then DB, then cookie, then
 * default); a redraft or best ball reader sees the dynasty format with the
 * same quarterback count. The class board follows the same dynasty format.
 *
 * NO YEAR IN THE SLUG, for the same reason as the other strategy guides: the
 * method does not expire, and the live figures move to each new class on
 * their own.
 *
 * ASCII only; one h1; no wins-above-replacement vocabulary.
 */

const SLUG = ROOKIE_GUIDE_SLUG;
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-11-13T18:00:00-05:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Dynasty Rookie Draft Guide: Strategy, Pick Values and Timing";
const DESCRIPTION =
  "How dynasty rookie drafts work, what each pick is worth, when pick prices peak and dip, how to read the NFL draft, and how to trade picks all offseason.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "dynasty rookie draft",
    "dynasty rookie draft strategy",
    "dynasty rookie draft guide",
    "how do dynasty rookie drafts work",
    "dynasty rookie pick values",
    "rookie pick hit rates",
    "when to trade rookie picks",
    "dynasty offseason strategy",
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
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

const LESSONS = ROOKIE_GUIDE_LESSONS;

const TOC_ITEMS = [
  ...LESSONS.map((l) => ({ id: l.id, label: l.title })),
  { id: "faq-heading", label: "Questions, answered" },
];

const LINK = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

function Para({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-ink-muted">{children}</p>;
}

/** The one sentence a lesson should leave behind, set apart from the prose. */
function KeyIdea({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 rounded-card border-l-4 border-brand-purple/70 bg-surface/60 px-4 py-3 text-sm leading-relaxed text-ink">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-brand-purple">Key idea</span>
      <span className="mt-1 block">{children}</span>
    </p>
  );
}

function lessonEyebrow(id: string): string {
  const i = LESSONS.findIndex((l) => l.id === id);
  return `Lesson ${i + 1} of ${LESSONS.length}`;
}

function Lesson({
  id,
  heading,
  tone = "cyan",
  children,
}: {
  id: string;
  heading: string;
  tone?: "cyan" | "purple";
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <GuideSectionHeader id={id} eyebrow={lessonEyebrow(id)} heading={heading} tone={tone} />
      {children}
    </section>
  );
}

const hit = (key: string) => Math.round(ROOKIE_PICK_HIT_RATES.find((h) => h.key === key)?.hit ?? 0);

/* ---------- Lesson 9: the offseason, date by date ---------- */

const OFFSEASON: { when: string; what: string; move: string }[] = [
  {
    when: "January",
    what: "The fantasy season ends",
    move: "Decide whether next season is a contending year or a rebuilding one. Every trade after this follows from that answer.",
  },
  {
    when: "February and March",
    what: "The combine and free agency",
    move: "Veterans change teams and depth charts open up. Buy proven players while the room is busy ranking rookies it has not seen play.",
  },
  {
    when: "Late April",
    what: "The NFL draft",
    move: "Draft capital and landing spots become facts. Rookie picks stop being numbers and become names, and their price peaks.",
  },
  {
    when: "May",
    what: "Rookie drafts",
    move: "The best month to sell a pick you do not want to use. Offers arrive while you are on the clock, so know your price before the draft starts.",
  },
  {
    when: "June to August",
    what: "The quiet months",
    move: "Next year's picks tend to drift lower, though first-round picks held their price in the Footballguys study. Little reason to sell anything. Set your taxi squad and wait.",
  },
  {
    when: "September",
    what: "Kickoff",
    move: "The best time to buy next year's picks. Contenders are chasing points and let them go for less than they will cost in the spring.",
  },
];

function OffseasonTimeline() {
  return (
    <ol role="list" className="mt-6 divide-y divide-line/70 border-y border-line">
      {OFFSEASON.map((s) => (
        <li key={s.when} className="grid gap-x-6 gap-y-1 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <p>
            <span className="block font-mono text-lg font-black leading-tight text-ink">{s.when}</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
              {s.what}
            </span>
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">{s.move}</p>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Sources ---------- */

const SOURCES: { name: string; detail: string; href: string }[] = [
  {
    name: "Dynasty Nerds, Dynasty trade secrets: understanding draft pick values",
    detail:
      "Mychal Warno, March 2025, with draft data credited to Garret Price. Rookie pick hit rates by slot for 2018 to 2023 rookie drafts.",
    href: "https://www.dynastynerds.com/dynasty/dynasty-trade-secrets-understanding-draft-pick-values/",
  },
  {
    name: "Footballguys, Draft Capital Matters: rookie quarterbacks",
    detail: "Jason Wood, July 2026. Rookie-season finishes by NFL draft round, 2016 to 2025.",
    href: DRAFT_CAPITAL.QB.href,
  },
  {
    name: "Footballguys, Draft Capital Matters: rookie running backs",
    detail: "Jason Wood, July 2026. Same series and sample years.",
    href: DRAFT_CAPITAL.RB.href,
  },
  {
    name: "Footballguys, Draft Capital Matters: rookie wide receivers",
    detail: "Jason Wood, July 2026. Same series and sample years.",
    href: DRAFT_CAPITAL.WR.href,
  },
  {
    name: "Footballguys, Draft Capital Matters: rookie tight ends",
    detail: "Jason Wood, July 2026. Same series and sample years.",
    href: DRAFT_CAPITAL.TE.href,
  },
  {
    name: "Footballguys, Dynasty Investor: rookie pick valuation",
    detail:
      "Jay Stein, March 2024. How rookie pick prices moved through 2023, from KeepTradeCut prices, and when to buy and sell.",
    href: "https://www.footballguys.com/article/2024-dynasty-investor-rookie-pick-valuation",
  },
  {
    name: "ESPN, Fantasy football: What age do players peak/decline?",
    detail:
      "Tristan H. Cockcroft, July 2023. The year-two jumps for receivers and tight ends, for players who debuted since 2000.",
    href: "https://www.espn.com/fantasy/football/story/_/id/37933720/2023-fantasy-football-players-peak-decline-quarterback-running-back-wide-receiver",
  },
  {
    name: "Sleeper, What draft types are supported",
    detail: "Sleeper's help center. Rookie-only drafts, snake and linear order, and third round reversal.",
    href: "https://support.sleeper.com/en/articles/4645647-what-draft-types-are-supported",
  },
];

export default async function DynastyRookieDraftGuide({
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
  const data = await loadRookieGuideData(supabase, formatResolution.slug, sourceResolution.slug);
  const { drafts, board, qbGap, market } = data;

  const FAQ = buildRookieFaq(
    drafts
      ? {
          season: drafts.season,
          drafts: drafts.drafts,
          linearPct: drafts.linearPct,
          commonRounds: drafts.commonRounds,
          commonRoundsPct: drafts.commonRoundsPct,
          busiestMonth: drafts.busiestMonth,
          busiestMonthPct: drafts.busiestMonthPct,
          byEndOfMayPct: drafts.byEndOfMayPct,
        }
      : null,
  );

  const rb = DRAFT_CAPITAL.RB.rounds;
  const wr = DRAFT_CAPITAL.WR.rounds;
  const te = DRAFT_CAPITAL.TE.rounds;
  const qb = DRAFT_CAPITAL.QB.rounds;

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
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "Dynasty fantasy football rookie drafts" },
    },
    faqPageJsonLd(FAQ),
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
          title="Dynasty rookie draft guide"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Dynasty", tone: "purple" },
            { label: `${LESSONS.length} lessons`, tone: "cyan" },
          ]}
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
        <article className="text-[15px] sm:text-base">
          <section aria-labelledby="short-heading">
            <h2 id="short-heading" className="text-xl font-semibold text-ink">
              The short version
            </h2>
            <Para>
              The rookie draft is the one day a year a dynasty league adds new players, and most of the year&apos;s
              trades are really arguments about what its picks are worth. This guide covers the draft itself and the
              offseason around it, with figures from real rookie drafts and today&apos;s pick prices.
            </Para>
            <KeyFigures facts={drafts} />
            <ul role="list" className="mt-6 list-disc space-y-2 pl-6 leading-relaxed text-ink-muted">
              <li>
                A top-four pick usually becomes a player. The rest of round one is closer to a coin flip, round
                two hits about one time in five, and a third-round pick is a long shot.
              </li>
              <li>
                Rookie picks are most expensive around the NFL draft and your rookie draft. Sell then. Buy at the
                start of the season.
              </li>
              <li>
                NFL draft round tells you more than landing spot. A late-round pick with an open job is a rental.
              </li>
              <li>Running backs pay off as rookies. Receivers and tight ends often pay off in year two.</li>
              <li>Take the best player, not the position you need. Fix needs by trade.</li>
            </ul>
          </section>

          <Lesson id="how-heading" heading="How a dynasty rookie draft works" tone="purple">
            <Para>
              In a dynasty league you keep your whole roster from one season to the next. The only new players each
              year are the NFL&apos;s rookie class, and the rookie draft is how the league divides them. It is short,
              it happens once a year, and the worst teams pick first.
            </Para>
            <Para>
              That last part is the point. A rookie draft is how a bad team gets better, so most leagues run it in
              linear order: the same order in every round, worst team first. A startup draft, where every team
              starts from nothing, is usually a snake, with the order reversing each round to keep things even.
              {drafts ? (
                <>
                  {" "}
                  Of the {drafts.drafts.toLocaleString("en-US")} completed rookie drafts FF Beacon synced from
                  Sleeper in {drafts.season}, {drafts.linearPct} percent were linear.
                </>
              ) : null}
            </Para>
            {drafts ? (
              <div className="mt-6">
                <DraftShapeFigure facts={drafts} />
              </div>
            ) : null}
            <GuideSubheading className="mt-8">Reading a pick</GuideSubheading>
            <Para>
              Picks are written as round, a dot, and the pick inside the round. The 1.01 is the first pick of the
              first round. The 2.08 is the eighth pick of the second round, which in a 12-team league is pick 20
              overall. Before the order is known, a pick is described by where it is expected to land: an early,
              mid or late first.
            </Para>
            <GuideSubheading className="mt-8">Who picks first</GuideSubheading>
            <Para>
              The commissioner sets the order. The usual method is the reverse of last season&apos;s standings for
              the teams that missed the playoffs, then the playoff teams by how far they went. Some leagues rank
              the non-playoff teams by the points their best possible lineup would have scored, and some run a
              lottery. Both exist to stop a team from losing on purpose.
            </Para>
            <Para>
              On Sleeper, a commissioner makes a draft rookie-only by setting the players available to draft to
              rookies only, and chooses snake or linear order for it. Picks can be traded years before they are
              used, so the team on the clock is often not the team that earned the slot.
            </Para>
            <PickFinder />
            <KeyIdea>
              A rookie draft is linear on purpose. The slot you pick from in round one is the slot you pick from in
              every round, so a bad season pays you three or four times.
            </KeyIdea>
          </Lesson>

          <Lesson id="when-heading" heading="When rookie drafts happen">
            <Para>
              The NFL draft is held in late April. Most dynasty leagues hold their rookie draft in the weeks after
              it, once every rookie has a team.
              {drafts ? (
                <>
                  {" "}
                  In {drafts.season}, {drafts.busiestMonthPct} percent of the rookie drafts we synced started in{" "}
                  {drafts.busiestMonth}, and {drafts.byEndOfMayPct} percent had started by the end of May.
                </>
              ) : null}
            </Para>
            {drafts ? (
              <div className="mt-6">
                <DraftMonthFigure facts={drafts} />
              </div>
            ) : null}
            <GuideSubheading className="mt-8">Before or after the NFL draft</GuideSubheading>
            <Para>
              A few leagues draft before the NFL draft, on talent alone. It is a harder draft and a more
              interesting one: you are guessing at draft capital and landing spot, the two things the next two
              lessons show matter most. If your league does this, lean on the players expected to go in the first
              two NFL rounds and discount everyone else more than feels right.
            </Para>
            <Para>
              Leagues that wait until August trade certainty for a different risk. You see training camp, but
              every manager sees the same camp reports, and a rookie who has a good August costs more than he did
              in May.
            </Para>
            <GuideSubheading className="mt-8">Slow drafts</GuideSubheading>
            <Para>
              Many rookie drafts run slowly, with hours on the clock for each pick. That is time to trade. The
              manager one pick ahead of you is easier to deal with when you both know exactly who is left.
            </Para>
          </Lesson>

          <Lesson id="odds-heading" heading="Rookie pick hit rates: the odds on every pick" tone="purple">
            <Para>
              A rookie pick is a chance at a player, and the chance has been measured. Dynasty Nerds graded every
              pick in rookie drafts from 2018 to 2023 by what the player went on to do. The 1.01 hit{" "}
              {hit("101")} percent of the time. Picks 1.02 to 1.04 hit {hit("102")} percent. Then the odds fall off
              a ledge: picks 1.05 to 1.08 hit {hit("105")} percent, round two about {hit("201")} percent, and round
              three and later {hit("300")} percent.
            </Para>
            <PickOdds />
            <Para>
              One oddity in the study: the end of round one ({hit("109")} percent) beat the middle of it (
              {hit("105")} percent). That comes from six drafts of four picks each, which is a small sample. Read
              picks five through twelve as roughly the same bet.
            </Para>
            <Para>
              Two things follow. First, the gap between the 1.04 and the 1.05 is larger than the gap between the
              1.05 and the 1.12, so moving up into the top four is worth paying for and moving up inside the rest
              of the round usually is not. Second, a round-three pick that misses costs you nothing but a roster
              spot, so the roster spot is the real price.
            </Para>
            <KeyIdea>
              Past the first four picks, a rookie pick is a coin flip at best, and the odds get worse every
              round. Price it that way.
            </KeyIdea>
          </Lesson>

          <Lesson id="worth-heading" heading="Rookie pick values: what a pick is worth">
            <Para>
              Odds tell you how often a pick works. Price tells you what your league will pay for it today, and
              the two do not move together. A pick is a blank name until the NFL draft, and every manager fills the
              blank with the best player they can imagine.
            </Para>
            {market ? (
              <>
                <Para>
                  The ladder below is every {market.ladder.season} rookie pick slot in {market.sourceName}&apos;s{" "}
                  {market.format.displayName} values, with the early first set to 100. Switch your value source or
                  league format in the site header and it follows you.
                </Para>
                <div className="mt-6">
                  <PickLadderFigure market={market} />
                </div>
              </>
            ) : (
              <Para>
                Today&apos;s pick prices could not be loaded just now. The{" "}
                <Link href="/tools/trade-calculator" className={LINK}>
                  trade calculator
                </Link>{" "}
                prices every pick slot in your league&apos;s format.
              </Para>
            )}
            <GuideSubheading className="mt-8">Three things the price hides</GuideSubheading>
            <Para>
              Compare the price with the odds in lesson 3.
              {market?.ladder.slots.find((s) => s.key === "1-mid") ? (
                <>
                  {" "}
                  Today a mid first costs {market.ladder.slots.find((s) => s.key === "1-mid")?.index} percent of
                  an early first.
                </>
              ) : null}{" "}
              In the Dynasty Nerds study the middle of round one hit {hit("105")} percent of the time, about half
              the rate of picks 1.02 to 1.04. A mid first costs most of what an early first does and hits about
              half as often, so the top four tend to be cheap for what they are and the middle of round one
              expensive.
            </Para>
            <Para>
              Two seconds are not a first. A pick&apos;s value is in the chance of a star, and two 20 percent
              chances at a starter are not one 70 percent chance at one. They also cost you two roster spots
              instead of one.
            </Para>
            <Para>
              A pick further out is cheaper, and it should be.
              {market && market.ladder.nextYearDiscountPct !== null ? (
                <>
                  {" "}
                  Today a mid first in {market.ladder.season + 1} costs {market.ladder.nextYearDiscountPct} percent
                  less than the same pick in {market.ladder.season}.
                </>
              ) : null}{" "}
              You wait a year longer for it and nobody knows where it will land. A contender should pay with the
              far picks first. A rebuilder should ask for them, because a contender&apos;s first two years from now
              may not be a late one.
            </Para>
            <KeyIdea>
              Price steps down a little at a time. The odds fall off a ledge after pick four. Buy where the odds
              are better than the price, which is the very top.
            </KeyIdea>
          </Lesson>

          <Lesson id="clock-heading" heading="When to trade rookie picks: the yearly price curve" tone="purple">
            <Para>
              Rookie picks have a season of their own. They are worth the most when the draft is closest and every
              slot has a name on it, and they sag in the months when nobody is thinking about next year&apos;s
              class. Footballguys tracked it through a full year of KeepTradeCut prices.
            </Para>
            <div className="mt-6">
              <PriceCalendarFigure />
            </div>
            <Para>
              The same study found one exception worth knowing. It broke out first-round picks on their own, and
              they mostly held their price through the summer. The summer dip it found is across all picks, so
              it is most likely in the later rounds. Buying a first in July is not a bargain. A second or a third
              in early September is the more likely one.
            </Para>
            <GuideSubheading className="mt-8">What our own prices show</GuideSubheading>
            {market?.history ? (
              <>
                <Para>
                  FF Beacon records the price of every pick slot each night. Below is a mid first and a mid second
                  in the {market.history.season} rookie draft, from the first week we recorded them. It is one
                  class from one value source, so treat it as a running check on the study above, not as proof
                  of it.
                </Para>
                <div className="mt-6">
                  <PriceHistoryFigure market={market} history={market.history} />
                </div>
              </>
            ) : (
              <Para>
                FF Beacon records the price of every pick slot each night. The week-by-week chart appears here once
                there are enough weeks on file for your value source and format.
              </Para>
            )}
            <GuideSubheading className="mt-8">Why the price moves at all</GuideSubheading>
            <Para>
              Nothing about a pick changes between September and May except how close it is and how much the room
              is thinking about it. In the fall, contenders want points this week and treat next year&apos;s pick as
              a spare part. In the spring the same pick has a mock draft attached, and the manager who holds it can
              picture the player. The player has not changed. The picture has.
            </Para>
            <KeyIdea>
              Buy picks when the room is watching games. Sell them when the room is watching the NFL draft.
            </KeyIdea>
          </Lesson>

          <Lesson id="capital-heading" heading="Reading the NFL draft">
            <Para>
              The NFL draft is the best free scouting report you will ever get. Thirty-two teams with full-time
              scouts tell you, in public, how much they think of each player. The round a player is taken in is
              called his draft capital, and it is one of the strongest signals a fantasy manager has.
            </Para>
            <Para>
              Footballguys counted every rookie drafted from 2016 to 2025. Of the running backs taken in round one,{" "}
              {rb[0].wide} percent finished in the top 24 at the position in their first season. In round two it
              was {rb[1].wide} percent, in round three {rb[2].wide} percent, and in round four {rb[3].wide}{" "}
              percent.
            </Para>
            <CapitalExplorer />
            <GuideSubheading className="mt-8">Each position reads differently</GuideSubheading>
            <Para>
              Running backs are the most direct. A first-round back plays right away, and half of them (
              {rb[0].top12} percent) were top-12 backs as rookies.
            </Para>
            <Para>
              Receivers are slower. Only {wr[0].top12} percent of first-round receivers were top-12 as rookies,
              and {wr[0].wide} percent made the top 36. In round two it was {wr[1].wide} percent, and after that
              the rookie-year rate never got out of single digits. That does not make later receivers worthless,
              but it does mean you are buying year two or three.
            </Para>
            <Para>
              Tight ends are all or nothing. First-round tight ends were top-12 at the position {te[0].top12}{" "}
              percent of the time as rookies, from a sample of only {te[0].players}. In round two it was{" "}
              {te[1].top12} percent.
            </Para>
            <Para>
              Quarterbacks need round one. {qb[0].wide} percent of first-round quarterbacks were top-24 as
              rookies, which is the bar for a superflex starter, and {qb[1].wide} percent of second-rounders. Of
              the {qb.slice(2).reduce((s, r) => s + r.players, 0)} quarterbacks taken after round two, two cleared
              that bar.
            </Para>
            <GuideSubheading className="mt-8">Why capital works</GuideSubheading>
            <Para>
              It measures two things at once. It is the team&apos;s opinion of the player&apos;s talent, and it is
              a promise about opportunity: a team that spends a first-round pick will keep giving that player
              snaps through a bad month, because benching him is admitting a mistake. A fifth-round pick gets one
              bad month.
            </Para>
            <KeyIdea>
              Sort rookies by NFL draft round before you sort them by anything else. Your film opinion is the
              tiebreaker, not the ranking.
            </KeyIdea>
          </Lesson>

          <Lesson id="spot-heading" heading="Opportunity now, upside later" tone="purple">
            <Para>
              After capital, two questions decide what a rookie is worth to your team: how soon will he play, and
              how long will he be good. They are different questions, and the same player can have a good answer to
              one and a bad answer to the other.
            </Para>
            <GuideSubheading className="mt-8">Landing spot: how soon</GuideSubheading>
            <Para>
              Landing spot is the depth chart he walks into, the quarterback throwing to him and the offense he
              plays in. It matters most in year one, and it changes faster than anything else about a player.
              Coaches are fired, veterans are cut, and next April the team drafts someone else.
            </Para>
            <Para>
              That is why an open depth chart cannot rescue low draft capital. In the Footballguys count, running
              backs taken in rounds four to seven were top-24 backs as rookies between 0 and {rb[4].wide} percent
              of the time, round by round. Plenty of them had a clear path to the job in May.
            </Para>
            <RookieSorter />
            <GuideSubheading className="mt-8">Long-term upside: how long</GuideSubheading>
            <Para>
              Position sets the clock. A first-round running back is the most likely rookie to help you this
              season, and also the one whose value starts falling soonest. Receivers and tight ends take longer
              and last longer. ESPN measured the wait for players who debuted since 2000: receivers gained 43
              percent in PPR points per game from year one to year two, and tight ends 98.5 percent. The{" "}
              <Link href="/guides/dynasty-strategy#age-heading" className={LINK}>
                age lesson in the dynasty strategy guide
              </Link>{" "}
              has the full curves.
            </Para>
            <Para>
              So match the rookie to your window. A contender picking late in round one gets the most from a back
              with a role. A rebuilder gets the most from a receiver or a first-round tight end who may do little
              this year, because that team is not playing for this year.
            </Para>
            <Para>
              Age matters inside a position too. A 21-year-old rookie has one or two more seasons in his prime
              than a 24-year-old one, and the market rarely charges for the difference on draft day.
            </Para>
            <KeyIdea>
              Capital tells you how long the team will wait. Landing spot tells you how soon he plays. Position
              tells you how long it lasts. Draft the one your window needs.
            </KeyIdea>
          </Lesson>

          <Lesson id="board-heading" heading="How the class really goes">
            <Para>
              Rankings tell you what one analyst thinks. Real drafts tell you what a league will actually do, and
              how much leagues disagree with each other. That second part is where the edge is.
            </Para>
            {board ? (
              <>
                <div className="mt-6">
                  <ClassBoardFigure board={board} />
                </div>
                <Para>
                  Read the four figures at the top of the chart from left to right. Each is how many picks a
                  player in that range typically moved from one draft to the next. Compare the first with the
                  last: the difference is how much more leagues disagree in round two than at the top. The thin
                  lines show how far apart the same player can go in two different leagues.
                </Para>
              </>
            ) : (
              <Para>
                The board of real rookie drafts appears here once enough drafts in your league format have been
                synced.
              </Para>
            )}
            <GuideSubheading className="mt-8">What the spread is for</GuideSubheading>
            <Para>
              A wide spread means your league&apos;s board is not the average board. If you like a player the
              average draft takes at the 2.03, he might be there at the 2.08 in your league, or gone at the 1.11.
              Before your draft, write down the three players you would take a round early. Those are your trade-up
              targets. Everyone else, let them come to you.
            </Para>
            <Para>
              It also tells you where sleepers are. Nobody sleeps on the 1.02. Later in the draft the spread is
              wide enough that the best player on your board is often still there a few picks later, so trading
              back a few spots costs you little.
            </Para>
            <GuideSubheading className="mt-8">Superflex moves the quarterbacks</GuideSubheading>
            <Para>
              In a superflex league every team can start two quarterbacks, so there are not enough good ones to go
              around and a first-round NFL quarterback becomes one of the first picks in the rookie draft. In a
              one-quarterback league the same player goes later, often by most of a round or more.
            </Para>
            {qbGap ? (
              <div className="mt-6">
                <QbGapFigure gap={qbGap} />
              </div>
            ) : null}
            <Para>
              If you play in a one-quarterback league and read superflex rankings, every non-quarterback is ranked
              too low for you. The{" "}
              <Link href="/guides/superflex-strategy" className={LINK}>
                superflex strategy guide
              </Link>{" "}
              covers the format in full. Tight end premium scoring does a smaller version of the same thing for
              first-round tight ends.
            </Para>
            <KeyIdea>
              The top of the board is a consensus. After that every league drafts its own board, and knowing yours
              is worth more than any ranking.
            </KeyIdea>
          </Lesson>

          <Lesson id="trade-heading" heading="Offseason trades, date by date" tone="purple">
            <Para>
              The offseason is when a pick is easiest to trade, because nobody needs points this week. What you
              should do with yours depends on the date as much as on the player.
            </Para>
            <OffseasonTimeline />
            <GuideSubheading className="mt-8">Trading up, back and out</GuideSubheading>
            <Para>
              Trade up when one player stands clearly above the rest of your board and he will not reach you. Pay
              with next year&apos;s picks before this year&apos;s players. Moving into the top four is the one
              move up that the odds in lesson 3 support.
            </Para>
            <Para>
              Trade back when the next four or five players look the same to you. You still get one of them, and
              you add a pick. This is the right move more often than managers make it, because picking feels
              better than waiting.
            </Para>
            <Para>
              Trade out when you are contending and the pick is outside the top four. A proven starter who helps
              you win this season is worth more to you than a coin flip who might help in two years. The{" "}
              <Link href="/guides/fantasy-football-trade-guide" className={LINK}>
                trade guide
              </Link>{" "}
              covers how to judge the offer.
            </Para>
            <ClockCall />
            <GuideSubheading className="mt-8">Tools for the trade</GuideSubheading>
            <Para>
              The{" "}
              <Link href="/tools/trade-calculator" className={LINK}>
                trade calculator
              </Link>{" "}
              prices picks and players together in your format.{" "}
              <Link href="/tools/on-the-clock" className={LINK}>
                On The Clock
              </Link>{" "}
              connects to a live Sleeper rookie draft, clears out everyone already taken and tells you who is worth
              your pick. In a Sleeper league, the Team Blueprint in{" "}
              <Link href="/tools/league-pulse" className={LINK}>
                League Pulse
              </Link>{" "}
              lists a team&apos;s future picks by season and ranks its draft capital against the rest of the
              league.
            </Para>
            <KeyIdea>
              Know your price before you are on the clock. The best offers arrive with a timer running, and that
              is the worst time to work one out.
            </KeyIdea>
          </Lesson>

          <Lesson id="after-heading" heading="After the draft">
            <Para>
              The draft is one evening. What you do with the players over the next two years decides whether the
              picks worked.
            </Para>
            <GuideSubheading className="mt-8">Use the taxi squad</GuideSubheading>
            <Para>
              A taxi squad is a set of extra roster spots for young players who are not ready to start. They do not
              count against your roster limit, so a rookie can wait there without costing you a bench spot. The{" "}
              <Link href="/guides/dynasty-strategy#roster-heading" className={LINK}>
                dynasty strategy guide
              </Link>{" "}
              explains the Sleeper settings.
            </Para>
            <GuideSubheading className="mt-8">Give them two years</GuideSubheading>
            <Para>
              Lesson 6 showed how few receivers and tight ends produce as rookies, and lesson 7 showed how much
              they gain in year two. Cutting a second-round receiver after one quiet season throws away the season
              you drafted him for. Set a review date after year two and hold to it.
            </Para>
            <Para>
              The exception is draft capital that has already been spent. If the team drafts another player at his
              position in the first two rounds the next April, the opportunity you were waiting for went to someone
              else. Sell then, even at a loss.
            </Para>
            <GuideSubheading className="mt-8">Sell a hot start you do not believe</GuideSubheading>
            <Para>
              A late-round rookie who has two big games in September is worth more that week than he may ever be
              again. If lesson 7 sorted him as a rental, take the offer.
            </Para>
            <PostDraftChecklist />
          </Lesson>

          <section aria-labelledby="faq-heading" className="mt-12">
            <GuideSectionHeader id="faq-heading" heading="Questions, answered" />
            <div className="mt-4">
              <FaqAccordion items={FAQ} />
            </div>
          </section>

          <section aria-labelledby="sources-heading" className="mt-12">
            <h2 id="sources-heading" className="text-lg font-semibold text-ink">
              Sources
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Every published figure on this page comes from one of these. The figures marked live are read from FF
              Beacon&apos;s own synced Sleeper drafts and nightly pick values when the page loads, and each one says
              so in its caption. The two sorting boxes are this guide&apos;s rules of thumb.
            </p>
            <ul role="list" className="mt-4 space-y-3">
              {SOURCES.map((s) => (
                <li key={s.href} className="rounded-card border border-line bg-surface/40 p-3 text-sm leading-relaxed">
                  <a href={s.href} className={LINK}>
                    {s.name}
                  </a>
                  <span className="block text-ink-muted">{s.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="On the clock"
        heading="Not sure who to take, or what your pick is worth?"
        body="Post your pick and the offer in our Discord and real dynasty players will help you weigh it, free. I am in there too."
        isMember={isMember}
        memberHeading="You know the odds. Now price your picks."
        memberBody="The trade calculator values every rookie pick slot in your league's format."
        memberCtaHref="/tools/trade-calculator"
        memberCtaLabel="Open the trade calculator"
      />
    </main>
  );
}
