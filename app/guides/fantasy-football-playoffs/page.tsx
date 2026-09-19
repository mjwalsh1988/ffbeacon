import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
import { oddsPercent, playoffOdds } from "@/lib/guides/playoff-odds";
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
  BracketFigure,
  ConsolationFigure,
  DeadlineGridFigure,
  LuckFigure,
  MatchupRangeFigure,
  SwingFigure,
  VarianceFigure,
} from "./playoff-figures";
import {
  FloorOrCeiling,
  OddsWorksheet,
  PlayoffChecklist,
} from "./playoff-classroom";

/**
 * /guides/fantasy-football-playoffs
 *
 * How fantasy playoffs work and how to play for them, in Michael's first
 * person, for a reader somewhere between week 6 and the trade deadline who
 * wants to know whether their team is in and what to do about it.
 *
 * WHY THIS PAGE. Unlike the dynasty guide, this one is NOT picked from our own
 * Search Console: in the 90 days to 2026-09-18 not one query containing
 * "playoff", "odds", "deadline", "standings" or "tiebreak" reached the site.
 * It is a bet on outside demand (dedicated Sleeper playoff-odds tools exist,
 * Sleeper's own forum carries requests for one, and the big sites publish
 * playoff pieces every year) plus the one thing nobody else can offer: Power
 * Pulse simulates a reader's real Sleeper league. It pairs with Power Pulse
 * the way the FAAB guide pairs with the FAAB calculator, and it lands before
 * the trade deadline window, when playoff-odds searches climb. No year in the
 * URL, because the method does not expire.
 *
 * WHAT IS CLAIMED ABOUT OUR TOOLS IS CHECKED AGAINST THE CODE (2026-09-18):
 *   - Power Pulse (lib/power-pulse/simulate.ts): a seeded Monte Carlo season,
 *     wins then points for as the seeding tiebreak, byes to the top seeds, the
 *     bracket reseeded every round, the median game modelled when the league
 *     uses it, divisions NOT modelled, playoff rounds played from each team's
 *     season-average projection. Last-place odds exist and are not shown, so
 *     the page never mentions them.
 *   - The Schedules Luck index (lib/league-schedule/insights.ts buildLuckRows):
 *     real win rate minus all-play win rate, over every final week, with the
 *     median game in the real record and not in all-play.
 *   - Trade Ideas: projected wins, playoff odds and title odds before and after.
 *   - The FAAB calculator (lib/faab/league-faab.ts): prices a claim over the
 *     regular-season weeks left and does NOT count playoff weeks; blocks the
 *     all-in call at 5 percent playoff odds or lower.
 *   - Opponent adjustment (lib/power-pulse/default-settings.ts): 0.85 to 1.15,
 *     and zero weight for receivers and quarterbacks by default.
 *
 * THREE KINDS OF NUMBER, EACH LABELLED WHERE IT APPEARS. The worksheet and the
 * swing figure are a TEACHING MODEL (lib/guides/playoff-odds.ts) and say so.
 * The luck and lineup figures run PRODUCT CODE over INVENTED teams. Platform
 * rules and the odds-by-record study are PUBLISHED and linked in Sources, each
 * read at the source before it was quoted. Everything else is invented and says
 * so.
 *
 * Source and format: this guide shows no player values, rankings or
 * projections, so it has nothing to resolve (the generic-guide exception in
 * CLAUDE.md). Projection engines are never named, because the page describes
 * no engine's numbers.
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders.
 */

const SLUG = "fantasy-football-playoffs";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-18T12:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Fantasy Football Playoffs: Odds, Schedules and How to Win";
const DESCRIPTION =
  "How fantasy football playoffs work, what your playoff odds mean, luck against points for, buy or sell at the trade deadline, playoff schedules and lineups.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "fantasy football playoffs",
    "fantasy football playoff odds",
    "how do fantasy football playoffs work",
    "fantasy football playoff strategy",
    "fantasy football playoff schedule",
    "fantasy football tiebreaker",
    "points for tiebreaker",
    "sleeper playoff odds",
    "league median sleeper",
    "all-play record",
    "fantasy football trade deadline buy or sell",
    "toilet bowl fantasy football",
    "consolation bracket",
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
  { id: "rules-heading", label: "How the playoffs work" },
  { id: "odds-heading", label: "What your odds mean" },
  { id: "luck-heading", label: "Luck against quality" },
  { id: "deadline-heading", label: "Buy, hold or sell" },
  { id: "schedule-heading", label: "Playoff schedules" },
  { id: "run-heading", label: "FAAB and roster spots" },
  { id: "lineup-heading", label: "Win-or-go-home lineups" },
  { id: "out-heading", label: "When you are out" },
  { id: "mistakes-heading", label: "Mistakes I see every year" },
  { id: "example-heading", label: "A worked example" },
  { id: "checklist-heading", label: "Before the deadline" },
  { id: "faq-heading", label: "Questions, answered" },
  { id: "sources-heading", label: "Sources" },
];

/* The two teams Lesson 2 compares, from the teaching model. */
const LEAGUE = { teams: 12, playoffSpots: 6, seasonWeeks: 14 };
const WEAK_42 = oddsPercent(playoffOdds({ ...LEAGUE, weeksPlayed: 6, wins: 4, winChance: 0.4 }));
const STRONG_33 = oddsPercent(
  playoffOdds({ ...LEAGUE, weeksPlayed: 6, wins: 3, winChance: 0.65 }),
);

const FAQ: FaqAccordionItem[] = [
  {
    question: "How do fantasy football playoffs work?",
    answer:
      "The regular season is a qualifier. After it ends, usually after week 14, the top teams in the standings enter a bracket, most often four or six of them. In a six-team playoff the top two seeds get a first-round bye and the other four play. Each round is one head-to-head game, the winner moves on, and the last team standing is the champion. Some leagues play a two-week final that adds weeks 16 and 17 together.",
  },
  {
    question: "How many teams make the playoffs in fantasy football?",
    answer:
      "Your league decides. On Sleeper the commissioner sets the number and can change it until the playoffs begin. Sleeper's own blog puts the usual range at four to six teams, and ESPN public leagues send four. A bigger playoff field makes the regular season matter less and the playoff weeks matter more.",
  },
  {
    question: "What is the tiebreaker in fantasy football standings?",
    answer:
      "On Sleeper, when records are level, points for decides it, then higher points against, then a coin toss unless the commissioner sets custom seeding. Yahoo also uses total points for. ESPN public leagues use points for first, while ESPN private leagues default to head-to-head record first and let the league manager reorder the list. Check your own league's settings before you count on one.",
  },
  {
    question: "Are 60 percent playoff odds good?",
    answer:
      "They are better than a coin flip and a long way from safe. Sixty percent means that in four seasons out of ten this team misses. Treat 60 percent as a bubble team that should still be buying, not as a team that has earned the right to stand still.",
  },
  {
    question: "Should I buy or sell at the fantasy trade deadline?",
    answer:
      "Decide from your playoff odds and the kind of roster you have, not from your record. In redraft, buy unless you are out of it, because nothing you hold is worth anything in January. In dynasty, a young roster on the bubble should hold, and a veteran roster on the bubble should usually sell before the price falls. A team that is likely in should buy for the weeks the playoffs are played in.",
  },
  {
    question: "What is the league median on Sleeper?",
    answer:
      "It is an optional second game every week. Your score is compared with the league median, the average of the two middle scores that week, and you get an extra win for beating it or an extra loss for falling short. It applies to the regular season only, not to the playoffs or the consolation bracket, and Sleeper describes it as a way to reduce bad luck in head-to-head scheduling.",
  },
  {
    question: "What is the Toilet Bowl in fantasy football?",
    answer:
      "It is a bracket for teams that missed the playoffs where the loser of each game moves on. On Sleeper up to eight of the teams with the worst records enter it, and the team left at the end finishes last in the league. The opposite setting is a consolation bracket, where the winner moves on instead.",
  },
  {
    question: "Do fantasy playoff schedules matter?",
    answer:
      "Less than the rankings articles suggest. A matchup moves a projection by a limited amount, and matchup strength measured one season holds up poorly the next, especially for receivers and quarterbacks. Use weeks 15 to 17 opponents to break a tie between two similar players, not to pick a worse player over a better one.",
  },
];

export default async function PlayoffsGuide() {
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
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "Fantasy football playoffs" },
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
          title="Fantasy football playoffs: your odds, your schedule, and how to win the title"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Playoffs", tone: "purple" },
            { label: "8 lessons", tone: "cyan" },
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
        <article>
          <TheShortVersion />
          <Syllabus />

          <div className="text-[15px] sm:text-base">
            <RulesSection />
            <OddsSection />
            <LuckSection />
            <DeadlineSection />
            <ScheduleSection />
            <RunSection />
            <LineupSection />
            <OutSection />
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
        eyebrow="On the bubble"
        heading="Not sure whether to buy or sell? Ask people who have been there."
        body="Post your record, your odds and the trade you are looking at in our Discord, and real players will tell you whether they would push or fold, free. I am in there too."
        isMember={isMember}
        memberHeading="You know the odds. Now see your own."
        memberBody="You're already in the crew, so we'll skip the invite. Sync your Sleeper league in League Pulse and Power Pulse simulates the rest of your season, with playoff odds for every team."
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
    <ul role="list" className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-ink-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** The one sentence a lesson exists to leave behind. */
function KeyIdea({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-card border-l-4 border-brand-purple bg-surface p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Key idea
      </p>
      <p className="mt-1 text-base font-medium leading-relaxed text-ink">{children}</p>
    </div>
  );
}

/** A pointer at the tool that runs the lesson's arithmetic on a real league. */
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
    // container reachable by keyboard on its own.
    <div
      className="mt-5 overflow-x-auto rounded-card border border-line bg-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full text-sm">
        <caption className="px-4 py-3 text-left text-xs text-ink-subtle">{caption}</caption>
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
            <tr key={row[0]} className="border-b border-line/60 align-top last:border-0">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={cell} scope="row" className="px-4 py-2.5 text-left font-semibold text-ink">
                    {cell}
                  </th>
                ) : (
                  <td key={`${row[0]}-${i}`} className="px-4 py-2.5 text-ink-muted">
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
          The regular season only decides who gets into a bracket, and after that one bad week ends
          your year. So judge your team by its playoff odds and its points, not its record, which
          carries a lot of luck. At the deadline, a redraft team buys unless it is out of it; in
          dynasty, a young roster on the bubble holds and an old one sells. Use playoff schedules to break ties, never to make the
          decision. And when the games get close, the favorite plays it safe while the underdog
          swings.
        </p>
      </div>
    </section>
  );
}

/* ---------- Syllabus ---------- */

const LESSONS: { n: string; title: string; href: string; takeaway: string }[] = [
  { n: "01", title: "How the playoffs work", href: "#rules-heading", takeaway: "Seeds, byes and the tiebreaker." },
  { n: "02", title: "What your odds mean", href: "#odds-heading", takeaway: "Sixty percent is not safe." },
  { n: "03", title: "Luck against quality", href: "#luck-heading", takeaway: "Points for and the all-play record." },
  { n: "04", title: "Buy, hold or sell", href: "#deadline-heading", takeaway: "Decide by odds, not by record." },
  { n: "05", title: "Playoff schedules", href: "#schedule-heading", takeaway: "A tiebreaker, not a plan." },
  { n: "06", title: "FAAB and roster spots", href: "#run-heading", takeaway: "Spend for the weeks that count." },
  { n: "07", title: "Win-or-go-home lineups", href: "#lineup-heading", takeaway: "Floor when favored, ceiling when not." },
  { n: "08", title: "When you are out", href: "#out-heading", takeaway: "Brackets, spoilers and the pick." },
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
              <span aria-hidden="true" className="font-mono text-sm font-semibold tabular-nums text-brand-cyan">
                {l.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  <span className="sr-only">Lesson {Number(l.n)}: </span>
                  {l.title}
                </span>
                <span className="block text-xs text-ink-muted">{l.takeaway}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Lesson 1: the rules ---------- */

function RulesSection() {
  return (
    <section aria-labelledby="rules-heading" className="mt-12">
      <GuideSectionHeader
        id="rules-heading"
        eyebrow="Lesson 1 of 8"
        heading="How fantasy playoffs work: the regular season is a qualifier"
        tone="purple"
      />
      <Para>
        Most of a fantasy season is spent chasing a record, but the record only buys you two
        things: a place in the bracket and a seed inside it. Once the playoffs start, each round is
        one head-to-head game, and a team that went 11-3 loses to a team that went 7-7 just as
        easily as it would in October. The title goes to the team that is good in December and gets
        through three straight weeks of it.
      </Para>
      <Para>
        Your commissioner sets most of the rules, and they differ more than people assume. On
        Sleeper the number of playoff teams is whatever your league chooses, and it can be changed
        until the playoffs begin. Sleeper&apos;s own blog says the usual range is four to six teams
        and that most leagues start in week 15. Here is the six-team shape, which is the one I see
        most often:
      </Para>
      <BracketFigure />
      <GuideSubheading className="mt-8">Seeds, byes and the tiebreaker</GuideSubheading>
      <Para>
        Seeding runs on overall record. When two teams finish level, the tiebreaker is where most
        leagues quietly differ, so it is worth knowing yours before week 14:
      </Para>
      <GuideTable
        caption="The default standings tiebreakers on three platforms, from each platform's help centre. Your league may have changed them."
        head={["Platform", "When records are level"]}
        rows={[
          [
            "Sleeper",
            "Points for, then higher points against, then a coin toss unless the commissioner sets custom seeding.",
          ],
          [
            "ESPN",
            "Public leagues: points for, then head-to-head record. Private (League Manager) leagues: head-to-head record, then points for, and the league manager can reorder them.",
          ],
          ["Yahoo", "Total points for, then points in the most recent matchup."],
        ]}
      />
      <Para>
        Points for is the big one. On Sleeper and Yahoo, a close race for the last spot is often
        settled by total points rather than by any game, which is why an unlucky team that scores a
        lot is in better shape than its record says. The{" "}
        <Link href="/guides/fantasy-football-terms#points-for-against" className={LINK_CLASS}>
          glossary entry on points for and against
        </Link>{" "}
        explains the pair.
      </Para>
      <Para>
        A{" "}
        <Link href="/guides/fantasy-football-terms#first-round-bye" className={LINK_CLASS}>
          first-round bye
        </Link>{" "}
        is worth more than it looks. It is one fewer one-game round to survive, and in a six-team
        field without divisions only the top two seeds get one. On Sleeper,
        a playoff game that ends level goes to the higher seed as well, so seeding still pays in the
        bracket itself.
      </Para>
      <GuideSubheading className="mt-8">Three settings that change the math</GuideSubheading>
      <BulletList
        items={[
          <>
            <strong className="text-ink">The league median.</strong> On Sleeper this optional
            setting gives every team a second result each week: a win for beating the{" "}
            <Link href="/guides/fantasy-football-terms#league-median" className={LINK_CLASS}>
              league median
            </Link>
            , the average of the two middle scores, and a loss for falling short. It applies to the
            regular season only. It doubles the games in your record and takes a lot of the schedule
            luck out of the standings.
          </>,
          <>
            <strong className="text-ink">Reseeding.</strong> With Sleeper&apos;s reseeding toggle
            on, the highest seed left always plays the lowest seed left. Without it, the bracket is
            fixed from the start.
          </>,
          <>
            <strong className="text-ink">Divisions.</strong> On Sleeper, division winners get in
            automatically and take the top seeds, and in a six-team playoff the byes go to the two
            division winners with the best records. A division can put a worse team ahead of you.
          </>,
        ]}
      />
      <KeyIdea>
        The regular season buys a place and a seed, nothing else. Know how many teams get in, who
        gets a bye, and what breaks a tie in your league, because all three decide how much a win in
        November is worth.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 2: odds ---------- */

function OddsSection() {
  return (
    <section aria-labelledby="odds-heading" className="mt-12">
      <GuideSectionHeader
        id="odds-heading"
        eyebrow="Lesson 2 of 8"
        heading="What playoff odds actually mean, and why 60 percent is not safe"
      />
      <Para>
        <Link href="/guides/fantasy-football-terms#playoff-odds" className={LINK_CLASS}>
          Playoff odds
        </Link>{" "}
        are a share of simulated seasons. A tool plays out the rest of your season thousands of
        times, each time with a little different luck, and counts how often you finish inside the
        line. Sixty percent means you made it in six seasons out of ten. It also means you missed
        in four. A team at 60 percent is a bubble team with a slight edge, and it should be acting
        like one: still buying, still grinding the waiver wire.
      </Para>
      <Para>
        Your record is only half of the input. The other half is how good your team is from here,
        and that is why a 4-2 team can be worse off than a 3-3 team. In the guide&apos;s teaching
        model, a twelve-team league with six spots, a 4-2 team that wins 40 percent of its weeks
        from here makes the playoffs {WEAK_42} percent of the time. A 3-3 team that wins 65 percent
        of its weeks makes it {STRONG_33} percent of the time. The first team has banked a win the
        second has not, and it will lose more of the eight games that are left.
      </Para>
      <Para>
        Real data backs the shape. Alex Cates looked at more than 100,000 teams in 2019 and 2020 ESPN
        leagues of ten teams with four playoff spots. A team that finished with 8 wins made it 60
        percent of the time, 9 wins 91 percent, and 7 wins only 20 percent. A 3-0 start carried
        about 76 percent odds and an 0-3 start about 8 percent, so three games in, nobody was
        finished and nobody was safe.
      </Para>
      <Para>
        Put your own record into the worksheet below. It is a simplified model, and it says so, but
        it moves the way the real odds move.
      </Para>
      <div className="mt-6">
        <OddsWorksheet />
      </div>
      <GuideSubheading className="mt-8">Why a loss in week 13 hurts more than one in week 3</GuideSubheading>
      <Para>
        The later a game comes, the fewer games are left to make it up, so each result moves your
        odds further. For a team sitting exactly at .500 the effect roughly doubles over the season:
      </Para>
      <SwingFigure />
      <Para>
        This is why the weeks before the deadline feel so loud. A game in week 11 moves a .500
        team&apos;s odds about 60 percent more than a game in week 1 does, and that is exactly when you
        are deciding whether to trade for help.
      </Para>
      <KeyIdea>
        Playoff odds are your record plus how good your team is from here. Sixty percent means you
        miss four seasons in ten, and a strong 3-3 team can be better placed than a weak 4-2 one.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        Sync your Sleeper league and Power Pulse plays out the rest of your season thousands of
        times on your real schedule and your league&apos;s own bracket, with the median game when
        your league uses one. Every team gets playoff odds and a projected record. It seeds by wins
        and then points for, assumes the bracket reseeds every round, and does not model divisions.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 3: luck ---------- */

function LuckSection() {
  return (
    <section aria-labelledby="luck-heading" className="mt-12">
      <GuideSectionHeader
        id="luck-heading"
        eyebrow="Lesson 3 of 8"
        heading="Luck against quality: points for, record and the all-play record"
        tone="purple"
      />
      <Para>
        Head-to-head scoring hands out wins partly at random. Your score does not decide your game
        by itself; your opponent&apos;s score that week does the rest, and you have no say in it.
        Score 125 in the week your opponent posts 130 and you lose to one of the best weeks anybody
        had. Score 98 against a team that put up 92 and you win with one of the worst.
      </Para>
      <Para>
        The{" "}
        <Link href="/guides/fantasy-football-terms#all-play-record" className={LINK_CLASS}>
          all-play record
        </Link>{" "}
        takes the draw out. It plays your score each week against every other team&apos;s score
        that week, as if you had played the whole league, and adds it up. Two teams can score
        exactly the same points and end up three games apart in the real standings:
      </Para>
      <LuckFigure />
      <Para>
        How big can the gap get? Tony ElHabr measured it across six seasons of one ten-team ESPN
        league: the most extreme 5 percent of seasons were about 22 points of win rate away from
        their all-play record, which he puts at about three wins over a 14-game season. That is the
        difference between a bye and missing the playoffs, earned by nobody.
      </Para>
      <Para>
        So when you size up your team, and every rival you might trade with, look at three numbers:
        record, points for and all-play. When they agree, believe them. When the record is well
        ahead of the other two, the team has been lucky and its odds are thinner than its place in
        the standings. When it is well behind, the team is better than it looks, and it is the one to
        worry about in a playoff game.
      </Para>
      <KeyIdea>
        Your record tells you where you stand. Your points for and your all-play record tell you how
        good you are, and in a one-game playoff round, only how good you are counts.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Sync a league for its Luck index">
        In a synced league, the Schedules page has a Luck index: every team&apos;s real record set
        against its all-play record, ranked from luckiest to unluckiest, using every week that has
        been played. In a league with a median game, the real record includes those extra games and
        the all-play record does not, so read the gap with that in mind.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 4: the deadline ---------- */

function DeadlineSection() {
  return (
    <section aria-labelledby="deadline-heading" className="mt-12">
      <GuideSectionHeader
        id="deadline-heading"
        eyebrow="Lesson 4 of 8"
        heading="The trade deadline: buy, hold or sell by odds, not by record"
      />
      <Para>
        The{" "}
        <Link href="/guides/fantasy-football-terms#trade-deadline" className={LINK_CLASS}>
          trade deadline
        </Link>{" "}
        is the last point where you can change your roster by more than a waiver claim. On Sleeper
        it is tied to the final game of the NFL week your commissioner picks, and it can be moved or
        switched off, so look it up in your league settings rather than assuming. In the leagues I
        play in it has fallen anywhere from week 10 to week 13.
      </Para>
      <Para>
        The call has two inputs. The first is your odds band, from Lesson 2. The second is what
        happens to your roster after the season. In redraft the answer is nothing: every player you
        hold is worth zero in January, so a long shot has almost nothing to lose by pushing in. In
        dynasty, a player you trade away is gone for years, and whether that matters depends on how
        old your core is.
      </Para>
      <DeadlineGridFigure />
      <Para>
        Two cells are worth a second look. A young dynasty team on the bubble should hold, because
        selling youth to chase a coin-flip season throws away the season you are actually built for.
        A veteran dynasty team on the bubble should usually sell, because its players lose value every
        week and there is no next year for them to be good in. The{" "}
        <Link href="/guides/dynasty-strategy#lane-heading" className={LINK_CLASS}>
          dynasty guide&apos;s lesson on picking a lane
        </Link>{" "}
        goes further into both.
      </Para>
      <GuideSubheading className="mt-8">What to buy, and what to pay with</GuideSubheading>
      <BulletList
        items={[
          <>
            <strong className="text-ink">Buy for your weakest starting slot.</strong> A trade that
            upgrades a bench player does nothing for your odds. The one that replaces your worst
            starter does the most.
          </>,
          <>
            <strong className="text-ink">Pay with players who do not start.</strong> Your bench
            depth is worth more to a team with injuries than to you, and in redraft it is worth
            nothing to you in January.
          </>,
          <>
            <strong className="text-ink">Buy for the playoff weeks.</strong> If you are likely in,
            you are{" "}
            <Link href="/guides/fantasy-football-terms#contending" className={LINK_CLASS}>
              contending
            </Link>
            , and the standings no longer need you. A player who is hurt now and back for week 15 can be
            the best buy on the market.
          </>,
          <>
            <strong className="text-ink">Sell to the teams that need it most.</strong> The team
            sitting seventh with good points is the one most willing to overpay, and the{" "}
            <Link href="/guides/fantasy-football-trade-guide#record-heading" className={LINK_CLASS}>
              trade guide&apos;s lesson on why your record decides the trade
            </Link>{" "}
            explains how to pitch it.
          </>,
        ]}
      />
      <KeyIdea>
        Decide at the deadline from your odds band and the age of your roster. Redraft teams buy
        unless they are out of it. Old dynasty teams on the bubble sell. Young ones hold.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Sync a league for Trade Ideas">
        Inside a synced league, Trade Ideas runs your season before and after any trade you propose
        and shows the change in your projected wins, your playoff odds and your title odds, beside
        what the deal does to your roster&apos;s value.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 5: schedules ---------- */

function ScheduleSection() {
  return (
    <section aria-labelledby="schedule-heading" className="mt-12">
      <GuideSectionHeader
        id="schedule-heading"
        eyebrow="Lesson 5 of 8"
        heading="Playoff schedules: a tiebreaker, not a plan"
        tone="purple"
      />
      <Para>
        Every December someone in your league trades for a player because his team plays three soft
        defenses in weeks 15 to 17. The instinct is sound, because those are the weeks that decide
        the title. The weight people put on it is too much. Even Establish The Run, whose playoff
        schedule rankings come out every August, says a playoff schedule should serve at the very
        least as a tiebreaker when you are stuck between two players, and warns against ignoring
        everything else to chase an easy one.
      </Para>
      <Para>
        Two things limit it. First, a matchup can only move a projection so far. In FF Beacon&apos;s
        projections the opponent adjustment is capped at 15 percent either way by default, and
        receivers and quarterbacks get none at all.
      </Para>
      <MatchupRangeFigure />
      <Para>
        Second, matchups are hard to see coming. When we checked whether a defense&apos;s matchup
        number in one season said anything about the same number the next, it held up modestly for
        running backs and team defenses and not at all for receivers and quarterbacks. That is why
        those two get no adjustment. A schedule that looks soft in September is a guess about what
        a defense will look like in December, and defenses change: injuries, coaching, and a team
        that has stopped playing for anything.
      </Para>
      <Para>
        Power Pulse itself does not shift anybody&apos;s playoff odds for the NFL matchups their
        players face in weeks 15 to 17. It plays the playoff rounds from each team&apos;s average
        projected week over the rest of the regular season, which is the honest thing to do in
        October. The{" "}
        <Link href="/guides/fantasy-football-terms#strength-of-schedule" className={LINK_CLASS}>
          glossary entry on strength of schedule
        </Link>{" "}
        has the rest.
      </Para>
      <KeyIdea>
        Pick the better player. When two players are close enough that a matchup could flip them,
        let the playoff schedule break the tie.
      </KeyIdea>
      <TryIt href="/tools/who-should-i-start" label="Compare two players">
        The Start / Sit tool puts two to eight players side by side for one week, so you can see
        how close the call really is before you let a matchup decide it.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 6: FAAB and roster spots ---------- */

function RunSection() {
  return (
    <section aria-labelledby="run-heading" className="mt-12">
      <GuideSectionHeader
        id="run-heading"
        eyebrow="Lesson 6 of 8"
        heading="Spending FAAB and roster spots for the run"
      />
      <Para>
        Leftover FAAB in January bought you nothing. A contender should reach the playoffs close to
        empty, and the{" "}
        <Link href="/guides/faab-strategy#all-in-heading" className={LINK_CLASS}>
          FAAB guide&apos;s lesson on when to spend it all
        </Link>{" "}
        sets out the three conditions for emptying the budget on one player: he is a league-winner,
        you are contending, and he fills a hole.
      </Para>
      <Para>
        One thing to know about the numbers. With a Sleeper league connected, the{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          FAAB calculator
        </Link>{" "}
        prices a claim over the regular-season weeks you have left and runs your season before and
        after it, so the playoff odds it shows are real. It does not add the playoff weeks
        themselves. For a player you want mostly for weeks 15 to 17, the calculator&apos;s number
        is a floor, and the rest is your judgment. And if your playoff odds are 5 percent or lower,
        it will not tell you to empty the budget, however good the player looks.
      </Para>
      <GuideSubheading className="mt-8">The last three bench spots</GuideSubheading>
      <BulletList
        items={[
          <>
            <strong className="text-ink">Cover your thinnest position.</strong> One injury in week
            15 should not leave an empty slot. A backup who would start for you beats a stash who
            would not.
          </>,
          <>
            <strong className="text-ink">Hold the handcuff that matters.</strong> The backup to
            your own starting running back is worth a spot now in a way he was not in September.
          </>,
          <>
            <strong className="text-ink">Cut the long-term stash in redraft.</strong> A player who
            might matter next year does not matter in this league next year.
          </>,
          <>
            <strong className="text-ink">Think about the other bracket.</strong> Grabbing a player
            your likely playoff opponent needs is a legitimate move in the weeks before the playoffs.
          </>,
        ]}
      />
      <KeyIdea>
        Spend the budget before the playoffs, not in them, and fill the end of your bench with
        players who could start for you in week 15.
      </KeyIdea>
      <TryIt href="/tools/faab" label="Open the FAAB calculator">
        Connect your Sleeper league and the calculator shows what a claim does to your weekly
        points, your projected wins and your playoff odds, with a bid, a higher bid to be sure of
        him, and a walk-away line.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 7: lineups ---------- */

function LineupSection() {
  return (
    <section aria-labelledby="lineup-heading" className="mt-12">
      <GuideSectionHeader
        id="lineup-heading"
        eyebrow="Lesson 7 of 8"
        heading="Setting a lineup when one loss ends your season"
        tone="purple"
      />
      <Para>
        In the regular season you want the most points over many weeks. In a playoff round you want
        to beat one team, once. Those are different goals, and the difference shows up in how much
        a player&apos;s score swings from week to week.
      </Para>
      <Para>
        If you are the favorite, the only way you lose is a bad week, so you want players whose bad
        weeks are still decent. If you are the underdog, a normal week loses, so you need the
        players who can have a great one. Same projected points, different choice:
      </Para>
      <VarianceFigure />
      <Para>
        The effect is real and it is not huge, a few points of win chance. That means it breaks ties
        between players with similar projections. It does not justify benching a much better player
        for a lottery ticket. Start the best players you have, then lean on spread for the last spot
        or two.
      </Para>
      <div className="mt-6">
        <FloorOrCeiling />
      </div>
      <KeyIdea>
        Favored, play for the floor. Underdog, play for the ceiling. Either way the choice only
        matters between players with similar projections.
      </KeyIdea>
      <TryIt href="/tools/league-pulse" label="Open League Pulse">
        On the Lineups page of a synced league, the slot label beside each starter opens a what-if:
        swap him for anyone on your bench and see your projected points before and after. During
        the regular season it also shows your chance of beating that week&apos;s opponent, so build
        the habit before December.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 8: out ---------- */

function OutSection() {
  return (
    <section aria-labelledby="out-heading" className="mt-12">
      <GuideSectionHeader
        id="out-heading"
        eyebrow="Lesson 8 of 8"
        heading="When you are out: consolation brackets, spoilers and the pick you are playing for"
      />
      <Para>
        Missing the playoffs does not have to end your season. On Sleeper, up to eight of the teams
        with the worst records go into a second bracket, and it comes in two kinds:
      </Para>
      <ConsolationFigure />
      <Para>
        The{" "}
        <Link href="/guides/fantasy-football-terms#consolation-bracket" className={LINK_CLASS}>
          consolation bracket
        </Link>{" "}
        is a small prize. The Toilet Bowl is a small punishment, and it is built to keep every
        eliminated team trying to win, because losing keeps you in it. The league median, if your
        league uses one, does not apply in either bracket.
      </Para>
      <GuideSubheading className="mt-8">Play it straight</GuideSubheading>
      <Para>
        Before the bracket, there are the last regular-season weeks, and an eliminated team decides
        other people&apos;s seasons. Set a full, honest lineup every week. Your league will remember
        the manager who started three injured players against the team fighting for sixth.
      </Para>
      <Para>
        In dynasty the calculation is different. Next year&apos;s rookie draft order is usually set
        by the standings or by a bracket your league chooses, and{" "}
        <Link href="/guides/fantasy-football-terms#tanking" className={LINK_CLASS}>
          tanking
        </Link>{" "}
        for a better pick is an open strategy in plenty of dynasty leagues. Read your league&apos;s
        rules on how draft order is set before you plan around it, because leagues do it many
        different ways. Then sell what a contender will pay for, which the{" "}
        <Link href="/guides/dynasty-strategy#rebuild-heading" className={LINK_CLASS}>
          dynasty guide&apos;s lesson on rebuilding
        </Link>{" "}
        covers step by step.
      </Para>
      <KeyIdea>
        Out in redraft, set a real lineup and let the playoff race stay fair. Out in dynasty, know
        how your league sets the draft order, then sell to the teams still playing.
      </KeyIdea>
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
            <strong className="text-ink">Standing still at 60 percent.</strong> Four seasons in
            ten, that team misses. It should be buying.
          </>,
          <>
            <strong className="text-ink">Trusting a lucky record.</strong> A 7-3 team that is
            eighth in points for is closer to the bubble than the standings say.
          </>,
          <>
            <strong className="text-ink">Selling a strong 3-4 team.</strong> If your points and
            your all-play record are good, the wins tend to follow. Check them before you fold.
          </>,
          <>
            <strong className="text-ink">Trading for a playoff schedule.</strong> A worse player
            with soft matchups is still usually the worse start.
          </>,
          <>
            <strong className="text-ink">Hoarding FAAB into December.</strong> The budget is for
            the weeks before the playoffs, not after them.
          </>,
          <>
            <strong className="text-ink">Chasing spread as the favorite.</strong> The team that is
            expected to win should take the steady option.
          </>,
          <>
            <strong className="text-ink">Not knowing the tiebreaker.</strong> Points for settles
            more playoff spots than head-to-head results do on Sleeper and Yahoo.
          </>,
          <>
            <strong className="text-ink">Missing the deadline.</strong> It is a setting, it can be
            earlier than you think, and it does not wait.
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
        Say it is week 10 in a twelve-team redraft league on Sleeper. Six teams make the playoffs,
        the top two get byes, the regular season runs 14 weeks and points for breaks ties. You are
        4-5. Here is the whole method, in order.
      </Para>
      <GuideTable
        caption="An invented redraft team walked through the way this guide reasons. Every number here is made up."
        head={["Step", "The question", "The answer"]}
        rows={[
          ["1. Odds", "What are my playoff odds?", "Power Pulse says 38 percent. That is the bubble, not out of it."],
          [
            "2. Luck",
            "How good is the team, honestly?",
            "Fourth in points for, with an all-play record of 55-44. The 4-5 is unlucky. The team is better than the record.",
          ],
          [
            "3. Call",
            "Buy, hold or sell?",
            "Redraft on the bubble: buy. Nothing on this roster is worth anything in January.",
          ],
          [
            "4. Target",
            "Where does one player help most?",
            "The flex, which has averaged 7 points. A 14-point receiver adds about 7 a week.",
          ],
          [
            "5. Price",
            "What do I pay with?",
            "Two bench running backs who have not started since week 4.",
          ],
          [
            "6. Check",
            "What does it do to my season?",
            "Trade Ideas shows projected wins up by half a game and playoff odds from 38 to 49 percent.",
          ],
          [
            "7. Tiebreak",
            "Two receivers look equal. Which one?",
            "The one with the better weeks 15 to 17 matchups. Only now does the schedule get a vote.",
          ],
          [
            "8. Week 15",
            "I made it as the six seed and I am projected 12 points behind. What now?",
            "Underdog. For the last flex spot, start the player with the bigger ceiling.",
          ],
        ]}
      />
      <Para>
        Notice what did not decide anything: the 4-5 record on its own, and the playoff schedule
        until step 7. Change one fact and the answer flips. Make it a dynasty league with a core of
        29-year-olds, and step 3 becomes a sale, because a veteran roster on the bubble loses value
        every week it waits.
      </Para>
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
        Eight checks, one roster. Run through them the week before your deadline. If you cannot tick
        one, that is the thing to work out before you trade.
      </Para>
      <div className="mt-6">
        <PlayoffChecklist />
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="mt-12">
      <GuideSectionHeader id="faq-heading" eyebrow="FAQ" heading="Questions, answered" />
      <div className="mt-6">
        <FaqAccordion items={FAQ} />
      </div>
    </section>
  );
}

/* ---------- Sources ---------- */

const SOURCES: { name: string; detail: string; href: string }[] = [
  {
    name: "Sleeper, How do playoff teams get determined",
    detail: "Sleeper's help centre. Playoff team count, seeding order, divisions and byes.",
    href: "https://support.sleeper.com/en/articles/2203518-how-do-playoff-teams-get-determined",
  },
  {
    name: "Sleeper, Can I set tiebreakers",
    detail: "Sleeper's help centre. Standings tiebreakers and tied playoff games.",
    href: "https://support.sleeper.com/en/articles/4238872-can-i-set-tiebreakers",
  },
  {
    name: "Sleeper, Extra game each week against league median",
    detail: "Sleeper's help centre. How the median game works and where it applies.",
    href: "https://support.sleeper.com/en/articles/3971690-extra-game-each-week-against-league-median",
  },
  {
    name: "Sleeper, Can I customize my league's playoff seeding",
    detail: "Sleeper's help centre. Custom seeding, the reseeding toggle and the two-week final.",
    href: "https://support.sleeper.com/en/articles/2528718-can-i-customize-my-league-s-playoff-seeding",
  },
  {
    name: "Sleeper, Consolation bracket vs Toilet Bowl",
    detail: "Sleeper's help centre. The two brackets for teams that miss the playoffs.",
    href: "https://support.sleeper.com/en/articles/2203534-consolation-bracket-vs-toilet-bowl",
  },
  {
    name: "Sleeper, When is my trade deadline",
    detail: "Sleeper's help centre. How the deadline is set and changed.",
    href: "https://support.sleeper.com/en/articles/2435411-when-is-my-trade-deadline",
  },
  {
    name: "Sleeper, How do fantasy playoffs work",
    detail: "Avi Creditor, December 2024. The usual playoff sizes, week 15 starts and byes for the top two of six.",
    href: "https://sleeper.com/blog/how-do-fantasy-playoffs-work/",
  },
  {
    name: "ESPN, Playoff seeding: how regular season standings tiebreakers work",
    detail: "ESPN's help centre. Tiebreaker order for public and private leagues.",
    href: "https://support.espn.com/hc/en-us/articles/360036952471-Playoff-Seeding-How-Regular-Season-Standings-Tiebreakers-Work",
  },
  {
    name: "Yahoo, Head-to-head regular season tiebreakers",
    detail: "Yahoo's help centre. Total points for as the wild card tiebreaker.",
    href: "https://help.yahoo.com/kb/SLN35744.html",
  },
  {
    name: "Alex Cates, Your playoff odds given your record",
    detail:
      "September 2021, updated September 2022. Playoff rates by win total in more than 100,000 ESPN teams from 2019 and 2020.",
    href: "https://www.alexcates.com/post/don-t-panic-at-least-not-this-week-or-your-playoff-odds-given-your-record",
  },
  {
    name: "Tony ElHabr, Fantasy football performance",
    detail: "December 2023. Real win rate against all-play win rate in one ten-team ESPN league, 2018 to 2023.",
    href: "https://tonyelhabr.rbind.io/posts/fantasy-football-performance/",
  },
  {
    name: "Establish The Run, 2026 fantasy football playoff schedules",
    detail: "Jack Miller, August 2026. Playoff schedules as a tiebreaker between two players.",
    href: "https://establishtherun.com/fantasy-football-playoff-schedules-3/",
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
        Every platform rule and published figure on this page comes from one of these, read at the
        source. The worksheet and the week-by-week figure come from the guide&apos;s own teaching
        model and say so. The luck and lineup figures use invented teams run through the same
        functions the Schedules page and the Lineups what-if use. Everything else is invented to show a
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
      <GuideSectionHeader id="closing-heading" eyebrow="Next" heading="Run it on your own league" />
      <Para>
        Your real odds are on{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>
        : sync a Sleeper league and the Power Pulse page simulates the rest of your season, the
        Schedules page shows your Luck index, and Trade Ideas prices any deadline deal in wins as
        well as value. The{" "}
        <Link href="/guides/fantasy-football-trade-guide" className={LINK_CLASS}>
          trade guide
        </Link>{" "}
        covers judging one offer before you send it, the{" "}
        <Link href="/guides/faab-strategy" className={LINK_CLASS}>
          FAAB guide
        </Link>{" "}
        covers the waiver wire, and if you play dynasty, the{" "}
        <Link href="/guides/dynasty-strategy#contend-heading" className={LINK_CLASS}>
          dynasty guide&apos;s contender playbook
        </Link>{" "}
        is the other half of Lesson 4. Bye, seed, median and the rest of the vocabulary are in the{" "}
        <Link href="/guides/fantasy-football-terms#first-round-bye" className={LINK_CLASS}>
          glossary
        </Link>
        .
      </Para>
    </section>
  );
}
