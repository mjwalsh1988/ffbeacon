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
import { createAdminClient } from "@/lib/supabase/server";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import {
  MarginScaleFigure,
  PickCalendarFigure,
  PriceVsRoleFigure,
  TradeCalendarFigure,
  TwoForOneFigure,
  TwoScalesFigure,
} from "./trade-figures";
import { SameTradeTwoWays, SendChecklist } from "./trade-classroom";

/**
 * /guides/fantasy-football-trade-guide
 *
 * How to judge a trade, written in Michael's first person for a reader with an
 * offer sitting in their inbox and no idea whether to press accept.
 *
 * WHY THIS PAGE. Search Console (90 days to 2026-09-15) shows 45 different
 * trade queries reaching this site ("fantasy football trade calculator",
 * "trade analyzer", "fair trade fantasy football", "pick trade calculator") and
 * every one of them at position 56 or worse with no clicks. The FAAB guide
 * pairs with the FAAB calculator, which is the one pairing already proven to
 * win search here; this page pairs with the trade calculator, Trade Ideas and
 * Would You Rather the same way. It lands in week 2, at the start of the
 * trading season, and the URL carries no year because the method does not
 * expire.
 *
 * THE MECHANICAL CLAIMS ARE CHECKED AGAINST THE ENGINES. The margin formula and
 * the two bands come from lib/signal-check/verdict.ts and the defaults in
 * lib/signal-check/settings.ts, read live so an admin edit cannot leave this
 * page quoting an old number. The value-versus-wins split is
 * lib/trade-impact/types.ts. The team bands (Contender, Loaded, Bubble,
 * Rebuilder, Longshot in redraft) are lib/league-team-status.ts. Pick pricing
 * and the KTC fallback are lib/signal-check/values.ts. Where a figure is a
 * default, the page says "by default".
 *
 * EVERY WORKED NUMBER IS INVENTED AND SAYS SO, in the figure captions and in
 * the interactive box.
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders.
 */

const SLUG = "fantasy-football-trade-guide";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-15T12:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Fantasy Football Trade Guide: How to Judge Any Trade";
const DESCRIPTION =
  "How to judge a fantasy football trade before you send it: value against wins, the 2-for-1 trap, buying low without fooling yourself, dynasty picks, timing, and how to pitch it.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "fantasy football trade guide",
    "fantasy football trade tips",
    "how to trade in fantasy football",
    "fantasy football trade advice",
    "fantasy football trade strategy",
    "how to evaluate a fantasy football trade",
    "is this fantasy football trade fair",
    "buy low sell high fantasy football",
    "2 for 1 trade fantasy football",
    "fantasy football trade deadline strategy",
    "dynasty trade strategy",
    "fantasy football trade calculator explained",
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
  { id: "fair-heading", label: "What a fair trade is" },
  { id: "calculator-heading", label: "What a calculator knows" },
  { id: "two-for-one-heading", label: "The 2-for-1 trap" },
  { id: "buy-low-heading", label: "Buy low, sell high" },
  { id: "record-heading", label: "Your record decides" },
  { id: "picks-heading", label: "Picks in dynasty" },
  { id: "timing-heading", label: "Timing and the deadline" },
  { id: "pitch-heading", label: "How to pitch it" },
  { id: "no-heading", label: "When to say no" },
  { id: "mistakes-heading", label: "Mistakes I see every year" },
  { id: "example-heading", label: "A worked example" },
  { id: "checklist-heading", label: "Before you hit send" },
  { id: "faq-heading", label: "Questions, answered" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "How do I know if a fantasy football trade is fair?",
    answer:
      "Run two tests, not one. First, add up what each side is worth and see how far apart they are; a trade calculator does that in a second, and a gap under a few percent is even. Second, and this is the one most people skip, work out what the trade does to your starting lineup every remaining week. A deal can be fair on value and still cost you a game a month, or lopsided on value and still be the right deal for the season you are in.",
  },
  {
    question: "Should I do a 2-for-1 trade?",
    answer:
      "If you are contending and the one player is clearly the best in the deal, usually yes. You can only start so many players, and two decent starters on your bench score nothing. Before you say yes, count the roster spot you get back: it gets filled by the best free agent on your wire, and the real comparison is your two against their one plus that free agent. If your wire is empty, the two-for-one is worth less than it looks.",
  },
  {
    question: "What does buy low and sell high actually mean?",
    answer:
      "Buying low is trading for a player while the room has marked him down, usually after a slow stretch or a small injury, when you have a reason to think the drop is temporary. Selling high is trading a player away after a run of production you do not believe he can keep up. The test for both is the same: look at the role, meaning snaps, routes, targets and carries, and ignore the points. A price that fell while the role held is a buy. A price that rose on touchdowns alone is a sell.",
  },
  {
    question: "Should I trade for draft picks or players in dynasty?",
    answer:
      "It depends on which season you are playing for. A contender should turn picks into players, because a 2027 first cannot start in December. A rebuilder should do the opposite. Picks are also seasonal: they are cheapest during the NFL season, when contenders are chasing wins, and most expensive around the rookie draft in the spring. Buy them in October and sell them in April, as a rule.",
  },
  {
    question: "When is the best time to make a fantasy football trade?",
    answer:
      "Weeks 4 through 8 are the best buying window, because roles are established and slow starters are cheap. The last two weeks before your league's trade deadline are the best selling window if you are out of it, because contenders are desperate. Weeks 1 through 3 are mostly overreaction and a bad time to buy. After the deadline there is no trading at all, so check the date in your league settings before you plan around it.",
  },
  {
    question: "How do I get a trade accepted?",
    answer:
      "Solve the other manager's problem, in their terms. Look at their roster for the hole, offer the player that fills it, and take back something they can afford to lose. Open with a firm offer you would accept yourself rather than asking what they want, reply to every offer you get even if the answer is no, and keep every negotiation private. Managers accept trades from people they trust, and trust is built one honest offer at a time.",
  },
];

export default async function TradeGuide() {
  const isMember = await isDiscordMember();
  // The two bands the calculator grades on, read live rather than typed here.
  const settings = await loadSignalCheckSettings(createAdminClient());
  const neutralPct = settings.neutralThresholdPct;
  const blowoutPct = settings.blowoutThresholdPct;

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
      about: { "@type": "Thing", name: "Fantasy football trade strategy" },
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
          title="The trade guide: how to tell a good trade from a bad one before you send it"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Trades", tone: "purple" },
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
            <FairSection />
            <CalculatorSection
              neutralPct={neutralPct}
              blowoutPct={blowoutPct}
            />
            <TwoForOneSection />
            <BuyLowSection />
            <RecordSection />
            <PicksSection />
            <TimingSection />
            <PitchSection />
            <NoSection />
            <MistakesSection />
            <ExampleSection neutralPct={neutralPct} blowoutPct={blowoutPct} />
            <ChecklistSection />
            <FaqSection />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Got an offer sitting there"
        heading="Not sure about a trade? Ask before you accept it."
        body="Paste both sides into our Discord and real fantasy players will tell you what they would do, free. I am in there too, and I will tell you if I think you are getting fleeced."
        isMember={isMember}
        memberHeading="You know the method. Now grade one."
        memberBody="You're already in the crew, so we'll skip the invite. Signal Check grades any two sides in a few seconds, and Trade Ideas runs the wins test inside your own league."
        memberCtaHref="/tools/trade-calculator"
        memberCtaLabel="Open the trade calculator"
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
          A trade is good when it makes your starting lineup score more in the
          weeks you have left, or when it moves your roster toward the season
          you are actually playing for. Those are two different tests. A
          calculator runs half of one of them, and most bad trades pass the
          calculator. Get the best player in the deal, count the roster spot,
          solve the other manager&apos;s problem, and know whether you are
          buying wins or buying futures before you open the chat.
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
      title: "What a fair trade is",
      href: "#fair-heading",
      takeaway: "Value and wins are two different scales.",
    },
    {
      n: "02",
      title: "What a calculator knows",
      href: "#calculator-heading",
      takeaway: "And the six things it does not.",
    },
    {
      n: "03",
      title: "The 2-for-1 trap",
      href: "#two-for-one-heading",
      takeaway: "Count the roster spot you get back.",
    },
    {
      n: "04",
      title: "Buy low, sell high",
      href: "#buy-low-heading",
      takeaway: "Price the role, ignore the points.",
    },
    {
      n: "05",
      title: "Your record decides",
      href: "#record-heading",
      takeaway: "One trade, two correct verdicts.",
    },
    {
      n: "06",
      title: "Picks in dynasty",
      href: "#picks-heading",
      takeaway: "A pick has a season of its own.",
    },
    {
      n: "07",
      title: "Timing and the deadline",
      href: "#timing-heading",
      takeaway: "Four stretches, four different moves.",
    },
    {
      n: "08",
      title: "How to pitch it",
      href: "#pitch-heading",
      takeaway: "Offer, do not ask.",
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

/* ---------- Lesson 1: what fair means ---------- */

function FairSection() {
  return (
    <section aria-labelledby="fair-heading" className="mt-12">
      <GuideSectionHeader
        id="fair-heading"
        eyebrow="Lesson 1 of 8"
        heading="What a fair trade actually is, and why there are two answers"
        tone="purple"
      />
      <Para>
        Here is the argument every league has at least once a season. Somebody
        accepts a trade, somebody else calls it a robbery, and the two of them
        are both right, because they are measuring different things. One is
        looking at value. The other is looking at wins. I spent years thinking
        these were the same number. They are not, and once you see the gap
        between them you cannot unsee it.
      </Para>
      <Para>
        Value is what the market would pay. It is the number a{" "}
        <Link
          href="/guides/fantasy-football-terms#trade-calculator"
          className={LINK_CLASS}
        >
          trade calculator
        </Link>{" "}
        adds up, it counts every player on your roster whether he starts or not,
        and in dynasty it counts picks that will not be a player for two years.
        Wins is what the deal does to your starting lineup in the weeks you have
        left, against the opponents you actually play. It only counts players
        who start, because only players who start score.
      </Para>
      <Para>
        Those two disagree all the time. A stud on your bench behind two better
        studs is a lot of value and no wins. A 30-year-old running back in a
        good offense is a lot of wins in November and very little value in
        March. A first-round pick is value, full stop, and it cannot start for
        you in December no matter how much it is worth.
      </Para>
      <TwoScalesFigure />
      <Para>
        So when someone asks whether a trade is fair, the honest answer is a
        question back: fair for which season? A deal that adds value and costs
        wins is a good trade for a team rebuilding for next year and a bad one
        for a team playing for this one. The trade did not change. The team did.
        Everything else in this guide is about telling those two apart on your
        own roster, which is harder than it sounds.
      </Para>
      <KeyIdea>
        Value is what your roster is worth. Wins is what it does. Judge every
        trade on both, and decide in advance which one you are playing for.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        Inside your synced Sleeper league, Trade Ideas reports both scales for
        any deal: the value in your league&apos;s own format, and the wins from
        your best lineup week by week against the real remaining schedule.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 2: what a calculator knows ---------- */

function CalculatorSection({
  neutralPct,
  blowoutPct,
}: {
  neutralPct: number;
  blowoutPct: number;
}) {
  return (
    <section aria-labelledby="calculator-heading" className="mt-12">
      <GuideSectionHeader
        id="calculator-heading"
        eyebrow="Lesson 2 of 8"
        heading="What a trade calculator knows, and the six things it does not"
      />
      <Para>
        A trade calculator does one thing well. It puts a value on every asset
        in the deal, adds up each side, and tells you how far apart they are.
        The{" "}
        <Link href="/tools/trade-calculator" className={LINK_CLASS}>
          trade calculator on this site
        </Link>{" "}
        measures that gap as a share of the whole trade: the difference between
        the two sides divided by their total. As it is set today, a gap under{" "}
        {neutralPct} percent is called even and no winner is named, because a
        margin that small is inside the noise of the values themselves. From{" "}
        {neutralPct} to {blowoutPct} percent one side is named the winner, with
        the size of the edge. At {blowoutPct} percent or more it calls the deal
        a blowout, which usually means somebody has stopped valuing a player and
        started valuing a name.
      </Para>
      <MarginScaleFigure neutralPct={neutralPct} blowoutPct={blowoutPct} />
      <Para>
        It can also report a confidence level from low to high, built mostly
        from how far apart the sides land and whether any asset had to be priced
        without a firm value, which is most often a draft pick. Picks only count
        in dynasty formats, since a redraft league has nothing to trade, and on
        a format FF Beacon has not priced a pick for yet the calculator falls
        back to KTC&apos;s dynasty pick values rather than leaving the picks
        unpriced. All of that is a real, useful answer to a real question: on
        value, who won?
      </Para>
      <Para>
        Here is what it cannot see, and every one of these has cost me a trade.
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">Your roster.</strong> It does not know
            you already start three receivers better than the one you are
            getting. A calculator grades the assets; your lineup grades the
            trade.
          </>,
          <>
            <strong className="text-ink">Your record.</strong> A first-round
            pick is worth the same to a 6 and 0 team and a 0 and 6 team on a
            calculator, and worth completely different things to them in real
            life.
          </>,
          <>
            <strong className="text-ink">The roster spot.</strong> In a
            two-for-one, the spot you free up gets filled by somebody, and the
            calculator has no idea who is on your wire. Lesson 3 is about
            exactly this.
          </>,
          <>
            <strong className="text-ink">Bye weeks and schedules.</strong> A
            player on a bye in week 15 is a smaller asset for a contender than
            the same player with a clear playoff run, and values do not carry a
            calendar.
          </>,
          <>
            <strong className="text-ink">Timing.</strong> The same deal is
            priced differently in week 3, week 9 and the week before the
            deadline, because what you can do with the asset changes. Values
            move slowly. What the other side will pay moves fast.
          </>,
          <>
            <strong className="text-ink">Your league.</strong> A value is a
            consensus across every league. Your league has a manager who
            overpays for rookies and one who never trades a running back, and
            the consensus knows nothing about either of them.
          </>,
        ]}
      />
      <KeyIdea>
        A calculator is a guardrail, not a referee. Use it to catch a lopsided
        deal before you send it. Never use it to decide a deal that passes.
      </KeyIdea>
      <TryIt href="/tools/trade-calculator" label="Grade a trade">
        Put any two sides into Signal Check, redraft or dynasty, and get the
        margin, the winner and the confidence in a few seconds. Then come back
        here for the other half.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 3: the two-for-one ---------- */

function TwoForOneSection() {
  return (
    <section aria-labelledby="two-for-one-heading" className="mt-12">
      <GuideSectionHeader
        id="two-for-one-heading"
        eyebrow="Lesson 3 of 8"
        heading="The 2-for-1 trap: count the roster spot you get back"
        tone="purple"
      />
      <Para>
        The most common trade in fantasy football is two decent players for one
        good one, and the most common mistake is grading it as if the two
        players simply vanished. They do not. When you send two and receive one,
        you have an open roster spot, and that spot gets filled by the best free
        agent on your waiver wire the same night. So the deal was never
        two-for-one. It was your two against their one plus your wire.
      </Para>
      <TwoForOneFigure />
      <Para>
        Once you see it that way the arithmetic is simple and the answer depends
        on something that is not in the trade at all. If your wire has a usable
        player, the consolidation is almost always right for a contender: you
        upgraded a starter and replaced the other one with a free agent, and the
        best player in the deal is now yours. If your wire is bare, the free
        agent is worth close to nothing, and you just paid two starters for one.
        The trade calculator will read those two situations identically. Your
        lineup will not.
      </Para>
      <Para>
        The same logic runs in reverse when you are the one sending the star.
        Two players coming back cost you a roster spot, and the player you drop
        to make room is a real cost the other side will not mention. Demand two
        starters, not a starter and a bench body you will cut on Wednesday. And
        if you are a contender, be very slow to give up the best player in any
        trade, whatever the calculator says about the totals. Championships get
        won by the team with the most players who cannot be replaced, and a
        first-round talent is the thing on your roster the wire can never give
        back.
      </Para>
      <KeyIdea>
        Every two-for-one is a two-for-two, and the second incoming player is
        whoever is sitting on your waiver wire. Price him before you say yes.
      </KeyIdea>
      <Para>
        The{" "}
        <Link href="/guides/positional-war-explained" className={LINK_CLASS}>
          Positional WAR guide
        </Link>{" "}
        is the longer answer to why that free agent is worth so much more at one
        position than another. At a position where the fortieth player is nearly
        as good as the twentieth, the spot you free up costs you almost nothing.
        At a position that runs out fast, it costs you a starter.
      </Para>
    </section>
  );
}

/* ---------- Lesson 4: buy low, sell high ---------- */

function BuyLowSection() {
  return (
    <section aria-labelledby="buy-low-heading" className="mt-12">
      <GuideSectionHeader
        id="buy-low-heading"
        eyebrow="Lesson 4 of 8"
        heading="Buy low and sell high without fooling yourself"
      />
      <Para>
        Everyone knows the phrase. Almost nobody applies the test that makes it
        work, which is this: a player has a price and a role, and they are two
        different things. The price is what your league would pay for him this
        week. The role is his snaps, his routes, his targets, his carries inside
        the ten. Points come from the role. The price comes from the last three
        box scores. When the two drift apart, there is a trade to make.
      </Para>
      <PriceVsRoleFigure />
      <Para>
        Buying low means the price fell and the role did not. A receiver who has
        seen a quarter of his team&apos;s targets for eight straight weeks and
        scored one touchdown is cheap for reasons that have nothing to do with
        him, and the touchdowns are coming. Buying low on a player whose role
        also shrank is not buying low. It is buying a smaller player at a
        smaller price, and it is the mistake that gets called buying low most
        often. Check the snaps before you check the price.
      </Para>
      <Para>
        Selling high is the mirror. The price rose and the role did not. Three
        touchdowns on eleven targets is a price spike, not a role change, and
        the manager who pays for it is paying for last week. The uncomfortable
        part, and I will not pretend otherwise, is that selling high always
        feels early. If the trade feels comfortable, the window has usually
        closed. Sell production that is unlikely to continue, and be honest with
        yourself about which production that is. It is not every big game.
        Sometimes the breakout is the breakout.
      </Para>
      <Para>
        One more rule that took me too long to learn: draft cost no longer
        matters. A player you took in the second round is not a second-round
        player in week 7. He is whatever his role says he is now, and the room
        that still prices him at his draft slot, in either direction, is the
        room you trade with.
      </Para>
      <KeyIdea>
        Price the role, not the points. A price that fell while the role held is
        a buy. A price that rose on touchdowns alone is a sell.
      </KeyIdea>
      <TryIt href="/rankings" label="See the rankings board">
        The rankings on this site carry each player&apos;s value and how it
        moved over the last seven days, and the player&apos;s own page adds the
        thirty-day move, so a falling price is easy to spot. The role you check
        on that same page.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 5: your record decides ---------- */

function RecordSection() {
  return (
    <section aria-labelledby="record-heading" className="mt-12">
      <GuideSectionHeader
        id="record-heading"
        eyebrow="Lesson 5 of 8"
        heading="Contender or rebuilder: your record decides which scale you read"
        tone="purple"
      />
      <Para>
        Lesson 1 said a trade has two answers. This lesson is about which one is
        yours. Inside League Pulse every team gets a one-word read on where it
        sits: Contender, Loaded, Bubble or Rebuilder, with Longshot standing in
        for Rebuilder in a redraft league because a redraft roster has nothing
        to rebuild toward. Contender means you are inside the band that should
        take most of your league&apos;s playoff spots. Loaded means you are
        still in the picture and holding more value than your wins reflect.
        Bubble is the pack. Rebuilder is below the picture, with the season no
        longer the thing to play for.
      </Para>
      <Para>
        That one word changes the verdict on every trade you look at. A
        contender should buy ceiling, buy players with soft schedules in weeks
        15 through 17, buy the injured star who is back for the playoffs, and
        consolidate depth into starters. A rebuilder should do the opposite of
        every one of those, and should do it in October, when the contenders are
        desperate and paying the most. Here is the same trade, graded both ways.
      </Para>
      <div className="mt-6">
        <SameTradeTwoWays />
      </div>
      <Para>
        The honest check on your own status is blunt, and most managers fail it
        in the flattering direction. Count how many of your starters would start
        on the best team in your league. If the answer is five or more, you are
        contending whether your record says so or not. If it is two, you are
        not, whatever last week looked like. And in a redraft league you are
        always contending, because there is no next season to hold an asset for,
        so I grade every trade there on wins alone.
      </Para>
      <KeyIdea>
        Decide which season you are playing for before you look at any offer. A
        contender reads the wins scale. A rebuilder reads the value scale.
        Reading the wrong one is how a good trade loses a league.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 6: picks in dynasty ---------- */

function PicksSection() {
  return (
    <section aria-labelledby="picks-heading" className="mt-12">
      <GuideSectionHeader
        id="picks-heading"
        eyebrow="Lesson 6 of 8"
        heading="Picks in dynasty: what a first is worth, and when"
      />
      <Para>
        A rookie pick is the purest value asset in the game. It cannot start, it
        cannot get hurt, and it cannot lose its job, so it never contributes a
        single win until it becomes a player. That makes it the cleanest test of
        Lesson 5: a contender who trades for a pick in October has bought
        something that scores zero points for them this season, and a rebuilder
        who trades a pick away in October has sold the one thing on their roster
        that was not going to get worse.
      </Para>
      <Para>
        What a pick is worth depends on the league more than people think. The
        1.01 in a twelve-team{" "}
        <Link href="/guides/superflex-strategy" className={LINK_CLASS}>
          superflex
        </Link>{" "}
        league is a quarterback market, and it is worth a lot more than the
        1.01 in a ten-team one-quarterback league,
        where the same rookie is competing with a deeper free agent pool. A
        known pick is worth more than an unknown one: a 2027 first from a team
        that is 1 and 5 is a different asset from a 2027 first from a team that
        is 5 and 1, and the calculator on this site prices picks by season,
        round and rough slot for that reason. Early, mid and late are not
        decoration.
      </Para>
      <PickCalendarFigure />
      <Para>
        Picks also have a season of their own, and it runs opposite to players.
        During the NFL season contenders want players and will sell picks cheap
        to get them. In the spring, with the rookie class scouted and the draft
        a few weeks away, everyone wants picks and the price peaks. So the rule
        of thumb, with the usual caveat that a rule of thumb is not a law: buy
        picks in October, sell them in April. A rebuilder who does this every
        year ends up holding more firsts than anyone in the league without ever
        winning a trade outright.
      </Para>
      <Para>
        In a trade with picks and players on both sides, grade the two halves
        separately. Ask what the players do to your lineup this year, then ask
        what the picks do to your roster in two. Trade Ideas prices the picks in
        the value column and leaves them out of the wins column entirely,
        because a 2028 first cannot start, and it lists every pick changing
        hands so nothing is netted away.
      </Para>
      <KeyIdea>
        A pick is value with no wins attached. Contenders turn picks into
        players. Rebuilders turn players into picks, and they do it when the
        contenders are paying the most.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 7: timing ---------- */

function TimingSection() {
  return (
    <section aria-labelledby="timing-heading" className="mt-12">
      <GuideSectionHeader
        id="timing-heading"
        eyebrow="Lesson 7 of 8"
        heading="Timing: the trade calendar and the deadline"
        tone="purple"
      />
      <Para>
        The same offer is a different offer in week 3 and week 9. Values move
        slowly, but what you can do with an asset changes every week, and so
        does what the other side will pay. The season splits into four
        stretches, and the right move in each one is different.
      </Para>
      <TradeCalendarFigure />
      <Para>
        Weeks 1 through 3 are an overreaction market. Two games are being priced
        as a season, every hot start has a buyer, and every slow one has a
        seller. It is a good time to sell a start you do not believe and a
        terrible time to buy, because you are paying full price for a sample of
        two. Weeks 4 through 8 are where the money is made. Roles are settled,
        the slow starters with steady roles are at their cheapest, and bye weeks
        start stacking up, so a team with three starters out in the same week
        will overpay for depth on a Tuesday. From week 9 to the deadline the
        trade is consolidation: contenders turn two good players into one great
        one for the playoff run, and rebuilders sell every veteran to whoever is
        most desperate, which is usually the team that just lost a starter.
      </Para>
      <Para>
        Two calendar tricks earn their keep every year. First, a player headed
        into his bye is a smaller asset to a contender than the same player
        coming out of one, so trade a player before his bye for a comparable one
        who has already had his, and you gain a usable week for nothing. Second,
        look at weeks 15 through 17 before every in-season trade, because those
        are the weeks that decide the title, and a player with a soft playoff
        schedule is worth more to you than his value shows.
      </Para>
      <Para>
        And know your deadline. Most leagues put it somewhere between week 10
        and week 13, it is in your league settings, and after it passes the only
        roster moves left are the{" "}
        <Link href="/guides/faab-strategy" className={LINK_CLASS}>
          waiver wire
        </Link>
        . The week before the deadline is the most active trading week of the
        year, and the prices in it are set by whoever is most desperate. Decide
        which side of that you are on before it arrives.
      </Para>
      <KeyIdea>
        Sell in the overreaction, buy in the evidence window, consolidate before
        the deadline. Whatever else you do, check your deadline date today.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 8: how to pitch ---------- */

function PitchSection() {
  return (
    <section aria-labelledby="pitch-heading" className="mt-12">
      <GuideSectionHeader
        id="pitch-heading"
        eyebrow="Lesson 8 of 8"
        heading="How to pitch a trade that gets accepted"
      />
      <Para>
        A perfectly graded trade that nobody accepts is worth nothing, and most
        trades die in the pitch. The managers who get deals done are not the
        ones with the best values. They are the ones the rest of the league
        likes trading with, and that reputation is built one offer at a time.
      </Para>
      <GuideSubheading className="mt-8">
        Start with their roster, not yours
      </GuideSubheading>
      <Para>
        Before you send anything, open the other team&apos;s roster and find the
        hole. A manager with two running backs on bye and a third on injured
        reserve has a problem, and a trade that solves it gets read differently
        from a trade that solves yours. Offer the player that fills the hole and
        ask for something from their surplus, which is the position where they
        have three starters for two slots. A trade where both managers can see
        why they said yes is the trade that gets accepted, and it is also the
        one that does not get talked about in the group chat afterward.
      </Para>
      <GuideSubheading className="mt-8">Offer, do not ask</GuideSubheading>
      <Para>
        &quot;What would you want for him?&quot; is the weakest opening in
        fantasy football. It hands the other side the first number, and the
        first number sets the range. Open with a firm offer you would genuinely
        accept if it came to you. It is easier to say yes to, it is easier to
        counter, and it tells the other manager you are serious, which is a
        thing people remember. Lowball offers as a habit do the opposite: after
        the second one, your name in their inbox is an eye-roll, and every real
        offer you send afterward is read as another one.
      </Para>
      <GuideSubheading className="mt-8">
        Reply to everything, and keep it private
      </GuideSubheading>
      <Para>
        Answer every offer you get, including the bad ones, and answer fast.
        Silence reads as not trading, not as playing hard to get, and it costs
        you the offers you would have wanted. A bad offer gets a polite no and,
        if you have the time, a sentence about what would work. Never post an
        offer to the league to mock it. The laugh lasts a minute and the manager
        who sent it never trades with you again, and neither does anyone who was
        watching.
      </Para>
      <GuideSubheading className="mt-8">A deal is a deal</GuideSubheading>
      <Para>
        When you agree to a trade, it is done. Do not shop it for a better
        offer, do not reopen it because a player got hurt on Sunday, and do not
        ask to add a throw-in after the handshake. Every league has one manager
        nobody trades with, and this is usually how they got there.
      </Para>
      <GuideSubheading className="mt-8">Know your league mates</GuideSubheading>
      <Para>
        Every league has a manager who overpays for rookies, one who never sells
        a running back, one who trusts a calculator completely and one who
        ignores it entirely. None of that is in any value set, and all of it is
        in your league&apos;s trade history. Trade the player each manager
        overvalues to the manager who overvalues him. It is the most reliable
        edge in the game and it costs nothing but attention.
      </Para>
      <KeyIdea>
        Solve their problem, open with a firm offer you would accept yourself,
        reply to everything, and honor every handshake. The manager everyone
        trusts gets the best deals in the league, every year.
      </KeyIdea>
    </section>
  );
}

/* ---------- When to say no ---------- */

function NoSection() {
  return (
    <section aria-labelledby="no-heading" className="mt-12">
      <GuideSectionHeader
        id="no-heading"
        eyebrow="The other answer"
        heading="When to say no"
        tone="purple"
      />
      <Para>
        The best trade of my season, most years, is one I did not make. Three
        habits get in the way of saying no, and they are worth naming.
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">
              You overvalue your own players.
            </strong>{" "}
            Everyone does. You drafted him, you have watched every snap, and he
            is worth more to you than to anyone else in the league, which is
            precisely why nobody will pay what you think he is worth. When every
            offer for a player looks insulting, the problem is usually the price
            in your head.
          </>,
          <>
            <strong className="text-ink">
              You have been negotiating for a week.
            </strong>{" "}
            The time you have spent on a deal is not a reason to close it. If
            the offer on the table is worse than no trade, it is worse than no
            trade, and the two days of messages do not change that. Walk away
            from a bad trade even when it is a trade you wanted.
          </>,
          <>
            <strong className="text-ink">
              You want the player, not the trade.
            </strong>{" "}
            Fixating on one name is how you end up paying a price you would
            laugh at for anyone else. There is always another player, and there
            is always next week.
          </>,
        ]}
      />
      <Para>
        On vetoes: a{" "}
        <Link href="/guides/fantasy-football-terms#veto" className={LINK_CLASS}>
          veto
        </Link>{" "}
        exists for collusion, meaning two managers cooperating to help one team,
        and for nothing else. A trade that looks lopsided to someone who was not
        in the negotiation is not collusion. It is a disagreement about value,
        and Lesson 1 explains why two honest managers can disagree about value
        all day. If your league vetoes trades it does not like, the fix is the
        league, not the trade.
      </Para>
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
      />
      <BulletList
        items={[
          <>
            <strong className="text-ink">
              Grading the assets instead of the lineup.
            </strong>{" "}
            The calculator said you won by 8 percent. Your flex got worse. You
            lost.
          </>,
          <>
            <strong className="text-ink">Forgetting the roster spot.</strong> A
            two-for-one with an empty wire is a two-for-one-and-a-half.
          </>,
          <>
            <strong className="text-ink">
              Buying last week&apos;s points.
            </strong>{" "}
            Three touchdowns on eleven targets is a sell signal for the other
            guy, not a buy signal for you.
          </>,
          <>
            <strong className="text-ink">Rebuilding at 4 and 2.</strong> You are
            contending. Read the wins scale. Trading your best receiver for a
            first in October is how a playoff team finishes seventh.
          </>,
          <>
            <strong className="text-ink">Contending at 1 and 5.</strong> The
            season is gone. Every veteran you are holding is worth more to a
            contender this month than he will be to you in any month.
          </>,
          <>
            <strong className="text-ink">Ignoring weeks 15 through 17.</strong>{" "}
            The whole season is a qualifier for three weeks. Look at those three
            weeks before every in-season trade.
          </>,
          <>
            <strong className="text-ink">Asking instead of offering.</strong>{" "}
            The first number sets the range. Make it yours.
          </>,
          <>
            <strong className="text-ink">Missing the deadline.</strong> It is in
            your league settings. Somebody in your league will find out about it
            the day after it passes. Do not be that manager.
          </>,
        ]}
      />
    </section>
  );
}

/* ---------- Worked example ---------- */

function ExampleSection({
  neutralPct,
  blowoutPct,
}: {
  neutralPct: number;
  blowoutPct: number;
}) {
  return (
    <section aria-labelledby="example-heading" className="mt-12">
      <GuideSectionHeader
        id="example-heading"
        eyebrow="Start to finish"
        heading="A worked example, with made-up numbers"
        tone="purple"
      />
      <Para>
        Say it is week 6 in a twelve-team PPR redraft league. You are 4 and 2,
        second in points, and your running backs are a stud, a middling starter
        and a flex who scores 9 a week. Your third receiver is on a bye in week
        15. A manager who is 2 and 4 offers you his best receiver, a target hog
        on a good offense, for your middling running back and your third
        receiver. Here is the whole method, in order.
      </Para>
      <GuideTable
        caption="An invented offer, walked through the way this guide reasons. Every number here is made up."
        head={["Step", "The question", "The answer"]}
        rows={[
          [
            "1. Which season",
            "Am I contending or rebuilding?",
            "4 and 2, second in points, redraft. Contending. I read the wins scale.",
          ],
          [
            "2. Value",
            "What does the calculator say?",
            `I win by a few percent: past the ${neutralPct} percent even line and nowhere near the ${blowoutPct} percent blowout line. A real edge, not a robbery.`,
          ],
          [
            "3. Lineup",
            "Who starts for me after this, and what changes?",
            "His receiver replaces my third receiver as a starter, plus 7 a week. My flex drops from the middling back to the 9-a-week guy, minus 3.",
          ],
          [
            "4. Roster spot",
            "Who fills the spot I emptied?",
            "The best back on my wire projects 6 a week. He is my new flex, so the flex loses 3 rather than 9.",
          ],
          [
            "5. Net",
            "What does my lineup gain?",
            "Plus 7 at receiver, minus 3 at flex. About plus 4 a week for eleven weeks.",
          ],
          [
            "6. Calendar",
            "Byes and the playoff weeks?",
            "His receiver has had his bye. My third receiver was going to miss week 15. I gain a playoff week, not lose one.",
          ],
          [
            "7. Their side",
            "Why does he say yes?",
            "He is 2 and 4 with one healthy running back. My middling back starts for him every week. It solves his problem.",
          ],
          [
            "8. Verdict",
            "Send it?",
            "Yes. Value says I win by a little. Wins says I gain about 4 a week, a playoff week back, and the best player in the deal.",
          ],
        ]}
      />
      <Para>
        Notice that steps 3 through 6 are where the decision was made, and none
        of them were in the calculator&apos;s answer. The calculator said I won
        by a little. The lineup said I won by a lot, because the roster spot got
        filled and the bye weeks broke my way. Now reverse the record: at 1 and
        5 in a dynasty league, the same offer is a no, because I should be
        selling that running back to a contender for a pick, not converting him
        into a receiver who helps me win games that no longer matter.
      </Para>
      <TryIt href="/games/would-you-rather" label="Play Would You Rather">
        Want reps? Would You Rather puts a real trade from a real league in
        front of you, names taken off, and asks you to call the winner before it
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
        heading="Before you hit send"
      />
      <Para>
        Eight questions, one trade. If you cannot tick one, you do not know
        enough to send it yet, and that is fine, because the offer will still be
        there tomorrow.
      </Para>
      <div className="mt-6">
        <SendChecklist />
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
        heading="Run it on your own trade"
      />
      <Para>
        The value test is the{" "}
        <Link href="/tools/trade-calculator" className={LINK_CLASS}>
          trade calculator
        </Link>
        : any two sides, redraft or dynasty, graded in a few seconds with the
        margin and a confidence level. The wins test is Trade Ideas inside{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>
        , which runs your best lineup week by week against your real schedule,
        before and after the deal, and writes out the reasons in sentences you
        can check against the numbers on the same screen. And if you want the
        vocabulary first, buy low, consolidation, the trade deadline and the
        rest are in the{" "}
        <Link
          href="/guides/fantasy-football-terms#trades"
          className={LINK_CLASS}
        >
          glossary
        </Link>
        .
      </Para>
    </section>
  );
}
