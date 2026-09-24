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
import { GuideSectionHeader, GuideSubheading } from "@/components/guides/guide-section-header";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";

/**
 * /guides/faab-settings-by-platform
 *
 * What the waiver settings on each platform actually mean, and which ones
 * change how the season plays.
 *
 * WHY THIS PAGE EXISTS. The keyword file behind the waiver build holds a
 * cluster of platform questions that no page on the site answered: "yahoo
 * fantasy football faab settings", "faab rules", "change faab budget", "faab
 * minimum bid", "waiver types", "faab espn", "faab sleeper". Individually they
 * are 50 a month each; together they are a few hundred, they are zero
 * competition, and they are exactly the kind of question an AI assistant gets
 * asked and answers from somebody's page.
 *
 * ONE PAGE RATHER THAN THREE. The intent behind "how does FAAB work in Yahoo"
 * and "how does FAAB work in ESPN" is the same question with a different logo
 * on it, and three thin pages would compete with each other for all of it.
 * Anchored sections give each platform a heading, a jump link and a fair share
 * of the page without splitting it.
 *
 * WHAT THIS PAGE REFUSES TO DO. It does not print click-by-click menu paths.
 * Those move every off-season, a stale one sends a commissioner hunting
 * through a settings screen for a button that was renamed two years ago, and
 * we cannot verify them continuously. What it does instead is name the SETTING
 * and explain what each value does, which is the durable half and the half a
 * reader actually needs, then links the platform's own support page for the
 * current steps. Every default stated here is attributed and hedged as a
 * default, because a commissioner can change all of it.
 *
 * Source and format: no player values, rankings or projections on this page, so
 * there is nothing to resolve (the generic-guide exception in CLAUDE.md).
 */

const SLUG = "faab-settings-by-platform";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-22T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "FAAB and Waiver Settings on Sleeper, Yahoo and ESPN";
const DESCRIPTION =
  "What every waiver setting actually does: FAAB budgets and minimum bids, Yahoo's three waiver types, ESPN's acquisition budget, Sleeper's waiver day, and which ones change how your season plays.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "yahoo fantasy football faab settings",
    "yahoo fantasy football faab rules",
    "yahoo fantasy football change faab budget",
    "yahoo fantasy football faab minimum bid",
    "yahoo fantasy football waiver types",
    "faab espn fantasy football",
    "faab sleeper",
    "espn faab budget",
    "how to turn on faab",
    "waiver settings fantasy football",
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
  { id: "settings-heading", label: "The settings that matter" },
  { id: "sleeper-heading", label: "Sleeper" },
  { id: "yahoo-heading", label: "Yahoo" },
  { id: "espn-heading", label: "ESPN" },
  { id: "nfl-heading", label: "NFL.com" },
  { id: "midseason-heading", label: "Changing it mid-season" },
  { id: "commissioner-heading", label: "A commissioner's short list" },
  { id: "faq-heading", label: "Questions, answered" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "How do I turn on FAAB in my league?",
    answer:
      "It is a league setting rather than a per-team one, so only the commissioner can do it, and on every major platform it lives in the waivers section of the league settings. On Sleeper the waiver type is a dropdown and FAAB is one of its values. On Yahoo and ESPN the league is on a waiver priority queue unless somebody switches it to a budget. Most platforms will not let you change the waiver system once the season is under way, so this is a preseason decision.",
  },
  {
    question: "How do I change the FAAB budget?",
    answer:
      "The budget is a separate setting from the waiver type, in the same part of the league settings, and $100 is the usual default. Changing it mid-season is the part that varies: some platforms allow it and apply the change to everybody's remaining balance in a way that is rarely what anybody expected, and some lock it once claims have been processed. If your league wants a different number, agree it before the draft.",
  },
  {
    question: "What is a FAAB minimum bid?",
    answer:
      "A floor under what a claim can cost. With a minimum of zero, which is the common default, an uncontested claim is free. Set it to one dollar and every claim costs at least a dollar, which stops a manager churning the wire daily at no cost. Some leagues set it higher deliberately to make every add a real decision. It is a small setting with a large effect on how busy your waiver wire is.",
  },
  {
    question: "What are Yahoo's waiver types?",
    answer:
      "Three of them. A continual rolling list is a queue where winning a claim drops you to the bottom, so priority is a resource you spend. Reverse order of standings rebuilds the queue every week from the table, so the worst team is always first and using it costs nothing. FAAB replaces the queue with a blind auction from a season budget. The three lead to completely different strategies, which is why it is worth knowing which one your league is on before you lose a claim.",
  },
  {
    question: "Does ESPN support FAAB?",
    answer:
      "Yes, as an alternative to its waiver order rather than alongside it. An ESPN league runs on a waiver priority order by default, and a commissioner can switch it to an acquisition budget instead, usually $100. The two are exclusive: a league is on one or the other.",
  },
  {
    question: "What happens to leftover FAAB at the end of the season?",
    answer:
      "Nothing. It is not carried forward and it is not worth anything, which is the single most useful fact about the whole system. In a dynasty league the budget almost always resets each season while the roster does not, so hoarding is a mistake there too.",
  },
  {
    question: "Can I see what my league has actually been paying?",
    answer:
      "Yes, if it is a Sleeper league. Connect it to League Pulse and the transactions feed shows every waiver claim with what it cost, and the FAAB calculator prices new claims against your league's own history rather than against a generic curve.",
  },
];

export default async function FaabSettingsByPlatformGuide() {
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
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "Fantasy football waiver and FAAB settings" },
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
          title="FAAB and waiver settings, platform by platform"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Commissioners", tone: "purple" },
            { label: "Four platforms", tone: "cyan" },
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
          <div className="text-[15px] sm:text-base">
            <SettingsSection />
            <SleeperSection />
            <YahooSection />
            <EspnSection />
            <NflSection />
            <MidseasonSection />
            <CommissionerSection />
            <FaqSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Setting up a league?"
        heading="Not sure which waiver settings to pick?"
        body="Ask in our Discord. Plenty of commissioners in there have run both systems and will tell you what actually changed about their league, free."
        isMember={isMember}
        memberHeading="Settings sorted. Now price a claim."
        memberBody="You're already in the crew, so we'll skip the invite. The FAAB calculator prices a waiver claim against your real roster and what your rivals have left."
        memberCtaHref="/tools/faab"
        memberCtaLabel="Open the FAAB calculator"
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

/**
 * The link to a platform's own rules.
 *
 * Every platform section ends with one. The exact menus change and we do not
 * track them, so the durable thing this page can do is explain the setting and
 * hand the reader the page that has the current steps.
 */
function PlatformSource({ name, href }: { name: string; href: string }) {
  return (
    <p className="mt-5 text-sm text-ink-subtle">
      Current steps and defaults:{" "}
      <a
        href={href}
        rel="nofollow noopener"
        target="_blank"
        className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {name}
        <span className="sr-only">, opens in a new tab</span>
      </a>
      .
    </p>
  );
}

/** One setting, its values, and what each value does to the season. */
function SettingCard({
  name,
  values,
  matters,
}: {
  name: string;
  values: { label: string; body: string }[];
  matters: string;
}) {
  return (
    <div className="mt-5 rounded-card border border-line bg-surface/50 p-4 sm:p-5">
      {/* h3, not h4. The card sits directly under the section's h2, so an h4
          would skip a level and a reader navigating by heading would hit an
          unexplained jump. */}
      <h3 className="text-sm font-semibold text-ink">{name}</h3>
      <dl className="mt-3 space-y-2.5">
        {values.map((v) => (
          <div key={v.label}>
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-brand-cyan">
              {v.label}
            </dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-ink-muted">{v.body}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink">Why it matters. </span>
        {matters}
      </p>
    </div>
  );
}

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
          Four settings decide how your waiver wire behaves: which SYSTEM resolves competing
          claims, how big the BUDGET is if it is FAAB, whether there is a MINIMUM BID, and
          WHEN claims process. Everything else in the waivers section is detail. All four are
          commissioner-only, all four live in the same part of the league settings on every
          major platform, and the first one is usually locked once the season starts.
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "#F4F4F8" }}>
          This page explains what each value does rather than which button to press, because
          the buttons move every off-season and the meanings do not. Each platform section
          links its own support page for the current steps. If you want the strategy rather
          than the setup, the{" "}
          <Link
            href="/guides/faab-strategy"
            className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            FAAB strategy guide
          </Link>{" "}
          is the one you want.
        </p>
      </div>
    </section>
  );
}

function SettingsSection() {
  return (
    <section aria-labelledby="settings-heading" className="mt-12">
      <GuideSectionHeader
        id="settings-heading"
        eyebrow="Start here"
        heading="The four settings that actually matter"
        tone="purple"
      />
      <Para>
        Every platform words these differently and buries them in a slightly different place,
        but underneath they are the same four decisions. Get these right and the rest of the
        waivers section can stay on its defaults forever.
      </Para>

      <SettingCard
        name="1. The waiver system"
        values={[
          {
            label: "Rolling priority",
            body: "A queue. The manager highest in the order wins any claim they enter, and winning drops them to the bottom. Priority is a resource you spend.",
          },
          {
            label: "Reverse standings",
            body: "The queue is rebuilt from the table every week, so the worst team is first every time. Using it costs nothing, which means there is no reason ever to hold it back.",
          },
          {
            label: "FAAB",
            body: "A blind auction. Everyone has a season budget, the highest bid wins, and losing costs nothing. The queue only comes back to break ties.",
          },
        ]}
        matters="This is the one that changes how the whole season is played, and it is the one you usually cannot change once it has started. Rolling priority rewards patience, reverse standings rewards nobody in particular, and FAAB rewards knowing what a player is worth."
      />

      <SettingCard
        name="2. The budget"
        values={[
          {
            label: "$100",
            body: "The usual default. Round, easy to think in percentages, and the number most published advice assumes.",
          },
          {
            label: "$1,000",
            body: "Common in high-stakes and chopped leagues. It is the same game with two extra digits, but the finer granularity genuinely does reduce ties.",
          },
        ]}
        matters="Less than people think. A $100 league and a $1,000 league make identical decisions, because everything is a share of the budget. What it does change is tie frequency: at $100, a lot of claims land on the same round number."
      />

      <SettingCard
        name="3. The minimum bid"
        values={[
          {
            label: "$0",
            body: "The common default. An uncontested claim is free, which is how most waiver adds happen.",
          },
          {
            label: "$1 or more",
            body: "Every claim costs something. Stops daily churn of the wire and makes each add a small decision.",
          },
        ]}
        matters="A quiet setting with a loud effect on league culture. At zero, an active manager can cycle five players a week for nothing. At a dollar, they think about it."
      />

      <SettingCard
        name="4. When claims process"
        values={[
          {
            label: "Weekly, Wednesday morning",
            body: "The default nearly everywhere. Everyone gets the same window to think after Sunday and Monday.",
          },
          {
            label: "Daily",
            body: "A rolling window on every dropped player. Keeps the wire live all week and rewards attention over planning.",
          },
        ]}
        matters="It sets the real deadline, which is the evening before the run rather than the morning of it. It also decides whether your league has one weekly decision point or seven small ones."
      />

      <KeyIdea>
        The system is a preseason decision you probably cannot undo. The budget, the minimum
        and the timing are all adjustable and none of them are worth arguing about for long.
      </KeyIdea>
    </section>
  );
}

function SleeperSection() {
  return (
    <section aria-labelledby="sleeper-heading" className="mt-12">
      <GuideSectionHeader
        id="sleeper-heading"
        eyebrow="Platform 1 of 4"
        heading="Sleeper"
        tone="cyan"
      />
      <Para>
        Sleeper puts all of this in the league settings under waivers, and it is the platform
        most likely to be on FAAB already: a lot of its league templates ship with a budget
        rather than a queue, which is part of why Sleeper leagues argue about bidding more
        than ESPN leagues do.
      </Para>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Waiver type</span> is the dropdown that
            chooses between a rolling priority queue, a reverse-standings queue and FAAB.
          </>,
          <>
            <span className="font-semibold text-ink">Waiver budget</span> is the season
            allowance per team when the type is FAAB. It does not refill.
          </>,
          <>
            <span className="font-semibold text-ink">Minimum bid</span> sets the floor under a
            claim. Leave it at zero and free adds stay free.
          </>,
          <>
            <span className="font-semibold text-ink">Waiver clear day and time</span> is when
            claims process. Wednesday early morning is the common setting; plenty of leagues
            move it to Tuesday night so the week starts sooner.
          </>,
          <>
            <span className="font-semibold text-ink">Waiver period on dropped players</span>{" "}
            decides how long somebody sits on waivers after being cut before becoming a free
            agent anybody can take.
          </>,
        ]}
      />
      <Para>
        Sleeper is also the platform this site can read. Connect a Sleeper league to{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>{" "}
        and every waiver claim in its history comes with what it actually cost, which turns
        the guesswork about what your specific league pays into a number.
      </Para>
      <PlatformSource
        name="Sleeper's own waivers article"
        href="https://support.sleeper.com/en/articles/3891585-waivers"
      />
    </section>
  );
}

function YahooSection() {
  return (
    <section aria-labelledby="yahoo-heading" className="mt-12">
      <GuideSectionHeader
        id="yahoo-heading"
        eyebrow="Platform 2 of 4"
        heading="Yahoo"
        tone="purple"
      />
      <Para>
        Yahoo is the platform people search settings questions about most, and the reason is
        its waiver TYPE menu: it offers three genuinely different systems under names that do
        not obviously explain themselves. Knowing which one your league is on is the single
        most useful thing on this page for a Yahoo manager.
      </Para>

      <GuideSubheading className="mt-8">The three waiver types, in plain terms</GuideSubheading>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Continual rolling list.</span> A queue
            that persists. Win a claim and you go to the back of it. Your position only
            improves when other managers use theirs, so priority is a currency and the
            question is always whether this player is worth spending it.
          </>,
          <>
            <span className="font-semibold text-ink">Reverse order of standings.</span> The
            queue is rebuilt from the table on a schedule, so a struggling team is near the
            front every week and winning a claim does not push them back for long. In this
            mode there is very little reason to sit on your priority.
          </>,
          <>
            <span className="font-semibold text-ink">FAAB.</span> The queue is replaced by a
            blind auction from a season budget. The queue survives only as the tiebreaker
            when two managers bid the same amount, which is exactly why odd numbers win
            claims that round numbers lose.
          </>,
        ]}
      />

      <Para>
        Yahoo leagues are not on FAAB unless somebody turned it on, so if you have never
        checked, assume you are on a queue. The budget and any minimum bid appear alongside
        the type once FAAB is selected.
      </Para>

      <KeyIdea>
        If you take one thing from the Yahoo section: find out whether your league is on a
        continual rolling list or on reverse standings. The right strategy in one is the
        wrong strategy in the other, and most managers have never looked.
      </KeyIdea>

      <Para>
        Yahoo also runs a waiver period on newly dropped players, so a cut player is not
        instantly free. That is the setting behind the common complaint that somebody
        &quot;could not add&quot; a player who was clearly available: he was on waivers, not
        in free agency, and the claim had to wait for the next run.
      </Para>
      <PlatformSource
        name="Yahoo's fantasy football waivers help page"
        href="https://help.yahoo.com/kb/fantasy-football/SLN6796.html"
      />
    </section>
  );
}

function EspnSection() {
  return (
    <section aria-labelledby="espn-heading" className="mt-12">
      <GuideSectionHeader
        id="espn-heading"
        eyebrow="Platform 3 of 4"
        heading="ESPN"
        tone="cyan"
      />
      <Para>
        ESPN leagues default to a waiver order rather than a budget, and its FAAB option is
        an alternative to that order rather than something layered on top. A league is on one
        or the other, never both.
      </Para>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Waiver order</span> is the queue, set
            initially from the reverse of the draft order or the standings depending on the
            league, with options for whether winning a claim sends you to the back.
          </>,
          <>
            <span className="font-semibold text-ink">Acquisition budget</span> is ESPN&apos;s
            name for FAAB. Turning it on replaces the order for the purpose of awarding
            claims; $100 is the usual starting figure.
          </>,
          <>
            <span className="font-semibold text-ink">Acquisition limits</span> are a separate
            setting worth knowing about: some ESPN leagues cap the total number of adds per
            team per season or per week, which is a constraint FAAB does not replace.
          </>,
        ]}
      />
      <Para>
        The acquisition limit catches people out more than the budget does. A manager who has
        hit their season cap cannot add anybody at any price, and the waiver page does not
        always make the reason obvious.
      </Para>
      <PlatformSource
        name="ESPN's waivers support article"
        href="https://support.espn.com/hc/en-us/articles/360000067592-Waivers"
      />
    </section>
  );
}

function NflSection() {
  return (
    <section aria-labelledby="nfl-heading" className="mt-12">
      <GuideSectionHeader
        id="nfl-heading"
        eyebrow="Platform 4 of 4"
        heading="NFL.com"
        tone="purple"
      />
      <Para>
        NFL.com leagues default to a reverse-standings priority that resets rather than rolls,
        which is the mode where holding priority back buys you the least. FAAB is available as
        an alternative in the same settings area.
      </Para>
      <Para>
        Because the order resets, a team near the bottom of the table is repeatedly first in
        line, and a team at the top is repeatedly last. That is a much bigger competitive
        effect than it sounds like over a full season, and it is the main argument for a
        league on this platform switching to a budget.
      </Para>
      <PlatformSource
        name="NFL.com's fantasy support"
        href="https://support.nfl.com/hc/en-us/articles/4408906134548"
      />
    </section>
  );
}

function MidseasonSection() {
  return (
    <section aria-labelledby="midseason-heading" className="mt-12">
      <GuideSectionHeader
        id="midseason-heading"
        eyebrow="The awkward part"
        heading="Changing it mid-season"
        tone="cyan"
      />
      <Para>
        The short answer is that you should not, and on most platforms you largely cannot.
        The waiver SYSTEM is generally locked once the season is under way, for the good
        reason that managers have been making decisions on the assumption it would not
        change. Somebody who spent their priority in week two on the understanding that it
        was a rolling queue has been robbed if it becomes reverse standings in week seven.
      </Para>
      <Para>
        The budget is the messier case. Where a platform allows it to be changed, the change
        usually applies to the remaining balance in a way nobody predicts, and it always
        advantages whoever has spent least. If a league genuinely needs to change it,
        changing it between seasons is the only version of that decision nobody can complain
        about.
      </Para>
      <KeyIdea>
        Treat the waiver system like the scoring settings. It is part of the contract everyone
        joined under, and the right time to argue about it is the week before the draft.
      </KeyIdea>
    </section>
  );
}

function CommissionerSection() {
  return (
    <section aria-labelledby="commissioner-heading" className="mt-12">
      <GuideSectionHeader
        id="commissioner-heading"
        eyebrow="If you run a league"
        heading="A commissioner's short list"
        tone="purple"
      />
      <Para>
        Setting up a new league, in the order that matters, with an opinion attached to each
        because a list of options with no recommendation is not much help.
      </Para>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Use FAAB.</span> It is more work to learn
            and it produces a fairer league. A queue hands the best available player to
            whoever happens to be at the front rather than to whoever wants him most.
          </>,
          <>
            <span className="font-semibold text-ink">$100, unless your league is
            experienced.</span> The extra granularity of $1,000 only helps people who are
            already bidding carefully.
          </>,
          <>
            <span className="font-semibold text-ink">Set the minimum bid to $1.</span> It
            costs nobody anything real and it stops the wire being churned for free.
          </>,
          <>
            <span className="font-semibold text-ink">Keep the run on Wednesday
            morning.</span> Everybody already expects it, and a league that moves it will
            spend the season reminding people.
          </>,
          <>
            <span className="font-semibold text-ink">Write the tiebreaker down.</span>{" "}
            Whatever your platform does with two identical bids, tell the league before it
            happens rather than after somebody loses a claim to it.
          </>,
        ]}
      />
      <div className="mt-8 rounded-card border border-line bg-surface/50 p-5">
        <h3 className="text-base font-semibold text-ink">Where to go from here</h3>
        <ul role="list" className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
          <li>
            <Link href="/waiver-wire" className={LINK_CLASS}>
              How the waiver wire works
            </Link>{" "}
            for the mechanics, plus this week&apos;s pickups.
          </li>
          <li>
            <Link href="/guides/faab-strategy" className={LINK_CLASS}>
              FAAB strategy
            </Link>{" "}
            for how much to bid once the settings are sorted.
          </li>
          <li>
            <Link href="/guides/idp-fantasy-football" className={LINK_CLASS}>
              IDP fantasy football
            </Link>{" "}
            if your league also starts defensive players.
          </li>
          <li>
            <Link href="/tools/faab" className={LINK_CLASS}>
              The FAAB calculator
            </Link>{" "}
            to price a claim against your own roster.
          </li>
        </ul>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="mt-12">
      <GuideSectionHeader id="faq-heading" eyebrow="FAQ" heading="Questions, answered" />
      <div className="mt-5">
        <FaqAccordion items={FAQ} />
      </div>
    </section>
  );
}
