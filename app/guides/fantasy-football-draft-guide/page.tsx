import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveFormatSlug } from "@/lib/preferences";
import { SITE } from "@/lib/site";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { findPublishedGuide } from "@/lib/guides/published";
import {
  loadBoardBuckets,
  loadFormatsWithBoards,
  marketLabel,
  type BoardEntry,
} from "@/lib/draft-value/guide-data";
import { StealRow } from "./steal-row";

/**
 * /guides/fantasy-football-draft-guide
 *
 * The launch surface for Beacon Steals. Evergreen draft strategy wrapped around
 * three auto-updating lists pulled from draft_value_targets, which the nightly
 * job rebuilds. The prose is written once; the names refresh themselves all
 * preseason without anyone editing this file.
 *
 * NO YEAR IN THE URL, deliberately, for the same reason the glossary documents:
 * a dated slug has to be redirected every August, and this page describes a
 * method that does not expire even though its examples do.
 *
 * FORMAT IS A REAL LINK, NOT A JS CONTROL. The switcher is a set of anchors
 * carrying ?format=, so it works without JavaScript, is keyboard navigable by
 * default, gives every format a shareable URL, and lets a screen reader move
 * through it as the list of links it actually is. The current format is marked
 * with aria-current="page".
 *
 * The verdict sentence is the PRIMARY content of every row and the numbers are
 * secondary, so the page reads the same by ear as by eye: nobody has to
 * assemble four table cells into a conclusion.
 */

const SLUG = "fantasy-football-draft-guide";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-08-12T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Fantasy Football Draft Guide: Steals, Swings, and Fades";
const DESCRIPTION =
  "The players going later than they should, by format, plus a plain-English explainer on tier-based drafting. We compare FF Beacon values and projected points above a replacement starter against real draft ADP, then show the gap.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "fantasy football draft guide",
    "fantasy football sleepers",
    "fantasy football value picks",
    "late round fantasy football picks",
    "players to avoid fantasy football",
    "dynasty draft guide",
    "superflex draft guide",
    "ADP value picks",
    "tier based drafting",
    "fantasy football tiers explained",
    "what is a tier break",
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

export default async function DraftGuidePage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [formatResolution, boardFormats, isMember] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    loadFormatsWithBoards(supabase),
    isDiscordMember(),
  ]);
  const { formats, season } = boardFormats;

  // The reader's format wins when it has a board. When it does not (a format we
  // rank but have no ADP market for), fall to the first format that does rather
  // than showing an empty page, and say so.
  const hasBoard = formats.some((f) => f.slug === formatResolution.slug);
  const activeSlug = hasBoard ? formatResolution.slug : (formats[0]?.slug ?? formatResolution.slug);
  const activeFormat = formats.find((f) => f.slug === activeSlug);
  const fellBack = !hasBoard && formats.length > 0;

  const board =
    season === null
      ? await loadBoardBuckets(supabase, { formatSlug: activeSlug, season: 0 })
      : await loadBoardBuckets(supabase, { formatSlug: activeSlug, season });
  const market = marketLabel(board.marketSource, board.marketAdpKey);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      datePublished: PUBLISHED_AT,
      dateModified: board.computedAt ?? UPDATED_AT,
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
      about: { "@type": "Thing", name: "Fantasy football drafts" },
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

      <PageBody width="reading">
        <article>
          {/* The headline is a single text node now rather than two
              gradient-split spans, so the aria-label that used to collapse them
              is gone: the announced name and the visible text are the same. */}
          <PageMasthead
            eyebrow="Guides"
            title="The draft guide: who the room is late on"
            chips={[
              { label: "Guide", tone: "cyan" },
              { label: activeFormat?.display ?? activeSlug, tone: "purple" },
            ]}
            stats={[
              { label: "Steals", value: String(board.steals.length), accent: "cyan" },
              { label: "Swings", value: String(board.swings.length), accent: "purple" },
              { label: "Fades", value: String(board.fades.length) },
            ]}
          >
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
              <time dateTime={PUBLISHED_AT}>{formatEasternDate(PUBLISHED_AT)}</time>
              {board.computedAt ? (
                <time dateTime={board.computedAt}>
                  Board rebuilt {formatEastern(board.computedAt)}
                </time>
              ) : null}
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

          <TheShortVersion market={market} format={activeFormat?.display ?? activeSlug} />

          <FormatSwitcher formats={formats} activeSlug={activeSlug} fellBack={fellBack} />

          <div className="text-[15px] sm:text-base">
            <HowThisWorks market={market} />

            <BoardSection
              id="steals"
              eyebrow="The board"
              heading="Steals"
              blurb="Players our board wants earlier than the room takes them, measured against how the room prices their position, and only where we have enough data on both sides to mean it."
              entries={board.steals}
              emptyText="No steals clear the confidence bar in this format right now. That is a real answer, not a missing one."
            />

            <BoardSection
              id="swings"
              eyebrow="The board"
              heading="Late-round swings"
              blurb="Available after pick 100, projects above a replacement starter, and the read is thinner. These are darts, and they are supposed to be."
              entries={board.swings}
              emptyText="Nothing in this format currently qualifies as a late-round swing."
            />

            <BoardSection
              id="fades"
              eyebrow="The board"
              heading="Fades"
              blurb="The other direction. The room is spending earlier on these players than our board says they are worth."
              entries={board.fades}
              emptyText="No fades clear the confidence bar in this format right now."
            />

            <Tiers />
            <Strategy />
            <Closing />
          </div>
        </article>
      </PageBody>

      <DiscordCtaSection
        eyebrow="Drafting this week?"
        heading="Bring the board into the room."
        body="On The Clock connects to your live Sleeper draft and tells you who is falling while you are on the clock, using the same numbers as this page. Free, and built to work by ear."
        isMember={isMember}
        memberHeading="You already have the crew. Take the board with you."
        memberBody="On The Clock runs these numbers live inside your Sleeper draft, so the player falling past his slot gets flagged while you are still on the clock."
        memberCtaHref="/tools/on-the-clock"
        memberCtaLabel="Open On The Clock"
      />
    </main>
  );
}

/* ---------- Summary card ---------- */

/**
 * The summary card.
 *
 * Colors are set explicitly rather than through the translucent
 * `bg-white/[0.03]` wash the section headings use, matching the same block on
 * /guides/fantasy-football-terms. A near-transparent fill takes whatever is
 * behind it, and this card sits high on the page where that is not always the
 * dark page ground, which left the copy rendering black on a near-white panel.
 * An opaque surface plus an explicit ink color cannot land in that state.
 */
function TheShortVersion({ market, format }: { market: string; format: string }) {
  return (
    <section
      aria-labelledby="short-version"
      className="mt-8 rounded-card p-px"
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
        <p
          className="mt-2 text-[15px] leading-relaxed sm:text-base"
          style={{ color: "#F4F4F8" }}
        >
          We work out where each player should come off the board in {format}, using what he is
          worth as an asset and how many points he projects above the last starter a league
          actually needs at his position. Then we compare that to {market}. The players below are
          the ones where those two numbers disagree most, in both directions.
        </p>
      </div>
    </section>
  );
}

/* ---------- Format switcher ---------- */

function FormatSwitcher({
  formats,
  activeSlug,
  fellBack,
}: {
  formats: { slug: string; display: string }[];
  activeSlug: string;
  fellBack: boolean;
}) {
  if (formats.length === 0) return null;
  return (
    <nav aria-labelledby="format-switcher-heading" className="mt-8">
      <h2
        id="format-switcher-heading"
        className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted"
      >
        Pick your format
      </h2>
      {fellBack ? (
        <p className="mt-2 text-sm text-ink-muted">
          Your saved format has no draft market we can grade against, so this is showing{" "}
          {formats[0]?.display}. Your saved preference has not been changed.
        </p>
      ) : null}
      <ul className="mt-3 flex flex-wrap gap-2">
        {formats.map((format) => {
          const isActive = format.slug === activeSlug;
          return (
            <li key={format.slug}>
              <Link
                href={`/guides/fantasy-football-draft-guide?format=${format.slug}`}
                aria-current={isActive ? "page" : undefined}
                className={
                  isActive
                    ? "inline-flex min-h-[44px] items-center rounded-full border border-brand-cyan bg-brand-cyan/15 px-4 py-2 text-sm font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    : "inline-flex min-h-[44px] items-center rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-ink-muted hover:border-brand-cyan/50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                }
              >
                {format.display}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ---------- Method ---------- */

function HowThisWorks({ market }: { market: string }) {
  return (
    <section aria-labelledby="how-this-works" className="mt-14">
      <SectionHeader
        id="how-this-works"
        eyebrow="The method"
        heading="How the gap is worked out"
        tone="purple"
      />
      <p className="mt-4 leading-relaxed text-ink-muted">
        Comparing a ranking to an ADP straight across does not work, and it fails in a way that
        looks convincing. A ranking places every player against every other player. An ADP prices
        scarcity. In a one-quarterback league nobody spends pick 50 on the eighth-best quarterback
        no matter how good he is, so those two numbers disagree about every quarterback, every
        year, and a naive comparison hands you a list of them and calls it a discovery.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        So we put both sides in the same unit before comparing them. For each position we work out
        how many starters a league actually needs, including its share of the flex, and find what
        the last of those starters projects to score. Everything above that line is a real edge;
        everything below it is replaceable. That gives an order of preference, which we then lay
        over the pick slots the market genuinely spends. The result is a pick number for every
        player: where he would go if the room drafted the same names in our order.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        The gap is that pick number against {market}. Positive means he lasts longer than we would
        wait. Two more things shape the list. Every player carries a confidence score that falls
        away as both numbers get less reliable, so a name 300 picks deep cannot top the board on the
        strength of two guesses disagreeing. And each position has its own median gap subtracted
        before ranking, because a model-wide argument about whether quarterbacks go too late is a
        strategy question, not something to repeat in thirty rows.
      </p>
    </section>
  );
}

/* ---------- Section header ---------- */

/**
 * The divider that starts every major section.
 *
 * A full-bleed beacon rule, a small colored eyebrow naming what kind of section
 * it is, then the heading at a size that actually separates it from body copy.
 * The rule and the eyebrow are decorative; the heading carries the meaning and
 * is what the section's aria-labelledby points at.
 */
function SectionHeader({
  id,
  eyebrow,
  heading,
  tone = "cyan",
}: {
  id: string;
  eyebrow: string;
  heading: string;
  tone?: "cyan" | "purple";
}) {
  const color = tone === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <>
      <div
        aria-hidden="true"
        className="h-px w-full"
        style={{
          backgroundImage: `linear-gradient(90deg, ${color} 0%, ${color}33 45%, transparent 100%)`,
        }}
      />
      <p
        aria-hidden="true"
        className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color }}
      >
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-1.5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
      >
        {heading}
      </h2>
    </>
  );
}

/* ---------- Board sections ---------- */

function BoardSection({
  id,
  eyebrow,
  heading,
  blurb,
  entries,
  emptyText,
}: {
  id: string;
  eyebrow: string;
  heading: string;
  blurb: string;
  entries: BoardEntry[];
  emptyText: string;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-14">
      <SectionHeader id={`${id}-heading`} eyebrow={eyebrow} heading={heading} />
      <p className="mt-3 leading-relaxed text-ink-muted">{blurb}</p>

      {entries.length === 0 ? (
        <p className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-ink-muted">
          {emptyText}
        </p>
      ) : (
        // role="list" because Tailwind preflight sets list-style:none, and
        // Safari/VoiceOver drops list semantics from an unstyled list. The order
        // is meaningful here, so losing it loses data.
        <ol role="list" className="mt-6 space-y-3">
          {entries.map((entry, index) => (
            <li key={entry.playerId}>
              <StealRow entry={entry} rank={index + 1} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------- Tier-based drafting ---------- */

/**
 * The evergreen explainer.
 *
 * Sourced from the tier-drafting literature rather than written from memory:
 * The Fantasy Footballers' tiered-rankings guide, FantasyPros' 2026 tiers
 * strategy piece, Lindy's and Athlon's beginner explainers, and Yahoo's
 * positional-scarcity primer. The two ideas that every one of them lands on are
 * the ones this section is built around: a tier break is a cliff, and the count
 * of names left in a tier is what tells you whether you can wait.
 */
function Tiers() {
  return (
    <section aria-labelledby="tiers-heading" className="mt-14">
      <SectionHeader
        id="tiers-heading"
        eyebrow="Draft strategy"
        heading="Tier-based drafting, explained properly"
        tone="purple"
      />

      <p className="mt-4 leading-relaxed text-ink-muted">
        A ranking list is a single file: player 14, player 15, player 16, all the way down. It
        looks precise, and that is the problem. Nobody can honestly tell you the 15th best player
        is better than the 16th. What they can tell you is that a group of six players are all
        roughly the same, and then there is a real drop.
      </p>
      <p className="mt-4 leading-relaxed text-ink-muted">
        Tiers are that idea written down. Instead of one list of a hundred names you get maybe
        twelve groups, and inside a group the order barely matters. Between groups it matters a
        lot. That single change is what turns a ranking into something you can actually draft off.
      </p>

      <h3 className="mt-8 text-lg font-semibold text-ink">The cliff is the whole point</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        The gap between the last player in one tier and the first player in the next is called a
        tier break, and people also call it a cliff, which is the more useful word. Inside a tier
        you are choosing between players who will probably finish near each other. Step over the
        break and you are taking a genuine downgrade.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        So the rule that falls out of it: taking any player from the tier you are in is fine, even
        the one ranked lowest in it. Reaching across a break to take someone from a tier below is
        the move to avoid, and it is the one a plain ranking list quietly encourages, because on a
        flat list a two-spot difference looks the same everywhere.
      </p>

      <h3 className="mt-8 text-lg font-semibold text-ink">Counting is the skill</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Here is the habit that makes tiers pay off, and it takes about four seconds per pick. When
        you are on the clock, look at the tier you want a player from and count how many names are
        still in it. Then work out how many picks happen before your next turn.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        If eight names are left in that tier and only fourteen picks separate you from your next
        one, some of those eight will still be there. You can spend this pick somewhere else and
        come back. If two names are left, they will be gone, and now you have a real decision: pay
        for one of them now, or accept the drop to the next tier.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        That is the entire method. The question stops being which player is ranked highest and
        becomes which cliff you are about to fall off, and which one you can still walk back from.
      </p>

      <h3 className="mt-8 text-lg font-semibold text-ink">Where it saves you: the positional run</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Four running backs go in five picks and the room tenses up. Everyone feels behind, and the
        next three drafters take a running back they had not planned on. This is the single most
        common way a draft gets away from people.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Tiers answer it directly. If the run has emptied the running back tier you wanted, the
        players left are from the tier below, and reaching for one is exactly the mistake. Meanwhile
        the run means nobody has been taking receivers, so a receiver from a tier you rate highly
        may have slid to you. The run created value somewhere else in the room, and counting is how
        you see it while everyone else is panicking.
      </p>

      <h3 className="mt-8 text-lg font-semibold text-ink">Scarcity is not a reason to reach</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Positional scarcity gets misused constantly. It does not mean "draft this position early".
        It means the drop-off at that position arrives sooner, so the cost of waiting is higher
        there than elsewhere. Running back tends to feel scarce because the workload concentrates
        in fewer players; receiver usually stays deeper further into the middle rounds.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        A weak player does not become a good pick because his position is thinning out. If the
        remaining names at a scarce position are all from a tier you do not want, the answer is to
        take the better player elsewhere and solve that position later, not to buy the best of a
        bad group at full price.
      </p>

      <h3 className="mt-8 text-lg font-semibold text-ink">Tiers do not transfer across positions</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        A tier 1 quarterback and a tier 1 running back are not worth the same thing, and tier 2
        receivers can be worth more than tier 2 backs. The number labels a group within its own
        position; it is not a currency you can spend across the board. Compare the size of the drop
        you are avoiding, not the tier numbers.
      </p>

      <h3 className="mt-8 text-lg font-semibold text-ink">How this page fits</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        The lists above are the tier idea aimed at one specific question. A steal is a player whose
        cliff sits well below where the room is drafting him, which is another way of saying you
        can wait on him and still get the tier. A fade is the reverse: you are being asked to pay a
        tier early. Working out where the cliffs are is the job; this page does the arithmetic for
        the format you picked.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        If you want the tiers themselves rather than the ends of the list,{" "}
        <Link
          href="/rankings"
          className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          the rankings board
        </Link>{" "}
        carries a tier on every player, and{" "}
        <Link
          href="/tools/on-the-clock"
          className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          On The Clock
        </Link>{" "}
        does the counting for you during a live draft, including calling out a run while it is
        happening.
      </p>
    </section>
  );
}

/* ---------- Evergreen strategy ---------- */

function Strategy() {
  return (
    <section aria-labelledby="strategy-heading" className="mt-14">
      <SectionHeader
        id="strategy-heading"
        eyebrow="Draft day"
        heading="What to do with this on draft day"
        tone="purple"
      />

      <h3 className="mt-6 text-lg font-semibold text-ink">Do not reach for a steal</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        A player on the steals list is worth having because he lasts. Taking him two rounds before
        his ADP throws away the entire reason he is on the list. Note the pick he usually goes at,
        take him a few picks before that, and spend the earlier rounds on players whose price and
        value already agree.
      </p>

      <h3 className="mt-6 text-lg font-semibold text-ink">Swings are supposed to fail</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        The late-round swings have thinner evidence than the steals, and that is the point of a late
        pick. One of them hitting pays for the rest missing. Take two or three of them at the end of
        a draft; do not build a starting lineup out of them.
      </p>

      <h3 className="mt-6 text-lg font-semibold text-ink">A fade is not a warning about the player</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Nobody on the fades list is bad. Each of them is priced ahead of what our board says he is
        worth, which usually means the room is paying for last season, for name recognition, or for
        a role that has not been confirmed. If one falls a round or two past his ADP, he stops being
        a fade and becomes a fine pick.
      </p>

      <h3 className="mt-6 text-lg font-semibold text-ink">Format changes the answer more than people expect</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Switching between the formats above is not cosmetic. A superflex league needs twice as many
        starting quarterbacks, which moves every quarterback and, because the picks have to come
        from somewhere, every other position too. A tight end premium does the same thing to tight
        ends. Read the list for the league you are actually in.
      </p>

      <h3 className="mt-6 text-lg font-semibold text-ink">When your board falls apart</h3>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Runs happen. Three teams take a quarterback in four picks and the plan you wrote down stops
        applying. The useful habit is to stop thinking about the position you meant to fill and go
        back to the question this whole page is built on: which player available right now is
        furthest ahead of where he should be going. That is usually not the position that just ran.
      </p>
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="closing-heading" className="mt-12 border-t border-white/10 pt-8">
      <h2 id="closing-heading" className="text-lg font-semibold text-ink">
        Where these numbers come from
      </h2>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Values are FF Beacon&apos;s own, rebuilt daily. Projections are Sleeper&apos;s weekly
        numbers, rescored under each format&apos;s rules rather than read off a generic column, so a
        tight end premium actually counts. Reliability comes from how often each player has beaten
        his own weekly projection in seasons we have graded. The market side is public ADP, plus a
        second read from the real Sleeper drafts synced through League Pulse and On The Clock.
      </p>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Everything here is free.{" "}
        <Link
          href="/rankings"
          className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          The full rankings board
        </Link>{" "}
        shows every player rather than the ends of the list, and{" "}
        <Link
          href="/tools/on-the-clock"
          className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          On The Clock
        </Link>{" "}
        runs the same comparison live inside your Sleeper draft.
      </p>
    </section>
  );
}
