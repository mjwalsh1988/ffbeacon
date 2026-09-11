import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BookOpen,
  Calculator,
  CircleHelp,
  ClipboardCheck,
  Coins,
  Layers,
  Lightbulb,
  Scale,
  Users,
  Vote,
} from "lucide-react";
import type { SignalCheckSettings } from "@/lib/signal-check/types";
import { FeatureIconTile, FeatureSectionHeader, type FeatureTone } from "@/components/feature-section-header";
import { FaqAccordion } from "@/components/faq-accordion";
import { LinkTile } from "@/components/link-tile";

/**
 * The server-rendered prose that carries this page's SEO weight.
 *
 * Before this section existed the page had about 120 to 150 words of static
 * copy and no FAQ, on the site's highest commercial-intent landing page. Every
 * heading and paragraph below ships in the initial HTML: no AI crawler in wide
 * use today executes JavaScript (the Vercel and MERJ study, December 2024), so
 * anything that only appears after the builder hydrates is invisible to
 * ChatGPT, Claude, and Perplexity search. The builder above hydrates; the
 * words below it do not wait for it.
 *
 * Every factual claim here is checked against the engine it describes:
 * lib/signal-check/verdict.ts for the margin formula and the near-even guard,
 * lib/signal-check/format.ts and values.ts for value source and pick handling,
 * lib/signal-check/confidence.ts for the confidence figure, and
 * app/tools/trade-calculator/import-actions.ts for the Sleeper format match.
 * The numbers that can change in admin (the near-even and blowout thresholds,
 * the labels shown on screen) come in as props from the settings the page
 * already loaded, so this copy reads the same numbers the builder above it
 * uses rather than a second, hand-typed copy of them.
 *
 * THE DESIGN. Each h2 opens with FeatureSectionHeader (a large icon tile, an
 * eyebrow, the heading). The four grading paragraphs are four cards with an
 * h3 each, and the margin card carries a scale drawn from the same admin
 * thresholds the paragraph states, with a text legend under it that says
 * every band in words (the bar itself is aria-hidden). The two readings of
 * "fair" sit side by side. The FAQ sits beside its heading on a wide screen,
 * and the closing paragraph of links became three link tiles with the SAME
 * anchor text. The paragraphs themselves are unchanged, and the h2 ids are
 * unchanged, so in-page links and the FAQPage JSON-LD still match.
 */

export type TradeCalculatorFaqEntry = {
  question: string;
  answer: string;
};

/**
 * The visible FAQ, in the order the page renders it under "Trade calculator
 * questions, answered". Built from settings so an admin-edited threshold or
 * label cannot drift out of sync with this copy, and imported by page.tsx to
 * build the matching FAQPage JSON-LD from the exact same strings.
 */
export function buildTradeCalculatorFaq(
  settings: WrittenSectionsSettings,
): TradeCalculatorFaqEntry[] {
  return [
    {
      question: "Is it accurate?",
      answer: `It is only as accurate as the FF Beacon Values behind it, the same value set used across the site's rankings and other tools, and it stays quiet rather than guess on a trade that is too close to call: any margin under ${settings.neutralThresholdPct}% of the trade's total value reads as "${settings.neutralLabel}," with no side named the winner. It also reports a confidence level from low to high, built from how far apart the two sides land and whether any asset, most often a draft pick, was priced without a firm value.`,
    },
    {
      question: "Can I include picks?",
      answer:
        "Yes, but only in dynasty formats, since a redraft league has no picks to trade. Picks are priced from FF Beacon Values when FF Beacon has published a value for that pick; on a format FF Beacon has not priced a pick for yet, the calculator falls back automatically to KTC's published dynasty pick values instead of leaving it unpriced.",
    },
    {
      question: "Does it work for my league's scoring?",
      answer:
        "Yes. Switch the format in the site header to reprice every value under PPR, half PPR, or standard scoring, with superflex and TE premium variants, across both redraft and dynasty. Importing a trade from a synced Sleeper league matches its scoring to the closest format FF Beacon publishes values for; if your league's exact format is not published yet, the import says so and names the closest match it used instead.",
    },
    {
      question: "Why does it disagree with my league mates?",
      answer:
        "Most often because you are not both looking at the same format: values reprice under scoring type, superflex, and TE premium, so the identical trade can read differently for a reader on standard scoring than for one on PPR. FF Beacon Values also move with the market, so the same trade can grade a little differently a week apart even in the same format, and a league mate quoting a different calculator entirely is working from a different value scale altogether.",
    },
  ];
}

export type WrittenSectionsSettings = Pick<
  SignalCheckSettings,
  "resultLabel" | "neutralLabel" | "neutralThresholdPct" | "blowoutLabel" | "blowoutThresholdPct"
>;

const LINK_CLASS = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

export function WrittenSections({ settings }: { settings: WrittenSectionsSettings }) {
  const faq = buildTradeCalculatorFaq(settings);

  return (
    <div className="mx-auto mt-20 max-w-5xl space-y-16 sm:space-y-20">
      <HowGradedSection settings={settings} />
      <WhatCountsAsFairSection settings={settings} />
      <FaqSection faq={faq} />
    </div>
  );
}

/* ---------- Shared card ---------- */

function InfoCard({
  icon,
  title,
  tone = "cyan",
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone?: FeatureTone;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-modal border border-line bg-surface/40 p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <FeatureIconTile icon={icon} tone={tone} size="md" />
        <h3 className="text-base font-semibold leading-tight text-ink sm:text-lg">{title}</h3>
      </div>
      <div className="mt-4 flex-1 space-y-4 leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

/* ---------- How the trade calculator grades a trade ---------- */

function HowGradedSection({ settings }: { settings: WrittenSectionsSettings }) {
  return (
    <section aria-labelledby="trade-calculator-graded" className="space-y-6">
      <FeatureSectionHeader
        id="trade-calculator-graded"
        icon={Scale}
        eyebrow="The method"
        title="How the trade calculator grades a trade"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard icon={Coins} title="Pricing each asset">
          <p>
            Every player and pick is priced from FF Beacon Values, the same value set used across the site&apos;s
            rankings, under whichever league format is set in the site header. Switching format reprices the whole
            trade, both sides at once, rather than adjusting one side and leaving the other on the old scale. When
            one side sends a single valuable asset for a package of several lesser pieces, the calculator also
            credits that side for holding the harder-to-replace asset, since concentrated value is worth more than
            the same total spread across a handful of role players.
          </p>
        </InfoCard>

        <InfoCard icon={Scale} tone="purple" title="The margin">
          <p>
            The margin is the gap between the two side totals, expressed as a share of the trade&apos;s whole value:
            add both sides together, divide the difference between them by that sum. A margin under{" "}
            {settings.neutralThresholdPct}% reads as &quot;{settings.neutralLabel},&quot; and the calculator declines
            to name a winner at all, because a gap that small sits inside the noise of the values themselves. A
            margin of {settings.blowoutThresholdPct}% or more is called &quot;{settings.blowoutLabel}.&quot;
            Everything between those two lines gets the {settings.resultLabel}: a named side, the margin, and a
            plain-language reason for it.
          </p>
          <MarginScale settings={settings} />
        </InfoCard>

        <InfoCard icon={Layers} title="Draft picks">
          <p>
            Draft picks price only in dynasty formats, since a redraft league has no picks to trade. A dynasty trade
            can mix players and picks freely on either side, and each pick is priced on its own season, round, and
            slot when a slot is known, or on the average of that season and round when it is not.
          </p>
        </InfoCard>

        <InfoCard icon={BookOpen} tone="purple" title="Where the values come from">
          <p>
            FF Beacon Values are one part of a larger, shared engine.{" "}
            <Link href="/guides/how-ff-beacon-works" className={LINK_CLASS}>
              Read the full methodology behind every number on the site
            </Link>
            , including the weekly projections and matchup model this calculator does not use.
          </p>
        </InfoCard>
      </div>
    </section>
  );
}

/**
 * The three bands a margin can land in, drawn to scale from the admin
 * thresholds. The top of the scale is one and a half times the blowout line,
 * so the blowout band always has visible width. The bar is aria-hidden; the
 * list under it states every band in words, with a swatch beside each one so
 * identity never rests on colour alone.
 */
function MarginScale({ settings }: { settings: WrittenSectionsSettings }) {
  const neutral = Math.max(0, settings.neutralThresholdPct);
  const blowout = Math.max(neutral, settings.blowoutThresholdPct);
  const top = Math.max(blowout * 1.5, neutral + 1, 1);
  const nearEvenWidth = (neutral / top) * 100;
  const resultWidth = ((blowout - neutral) / top) * 100;

  return (
    <figure className="rounded-card border border-line bg-base/40 p-4">
      <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        How a margin reads
      </figcaption>
      <div aria-hidden="true" className="pointer-events-none mt-3 flex h-3 gap-[2px]">
        <span className="rounded-l-full bg-ink-subtle/60" style={{ width: `${nearEvenWidth}%` }} />
        <span className="bg-brand-cyan" style={{ width: `${resultWidth}%` }} />
        <span className="flex-1 rounded-r-full bg-brand-purple" />
      </div>
      <ul role="list" className="mt-3 space-y-1.5 text-sm">
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-ink-subtle/60" />
          <span>
            <span className="font-mono font-semibold tabular-nums text-ink">Under {neutral}%</span>
            <span className="text-ink-muted">: {settings.neutralLabel}, no winner named</span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-brand-cyan" />
          <span>
            <span className="font-mono font-semibold tabular-nums text-ink">
              {neutral}% to under {blowout}%
            </span>
            <span className="text-ink-muted">: the {settings.resultLabel} names a side</span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-brand-purple" />
          <span>
            <span className="font-mono font-semibold tabular-nums text-ink">{blowout}% and up</span>
            <span className="text-ink-muted">: {settings.blowoutLabel}, a side is still named</span>
          </span>
        </li>
      </ul>
    </figure>
  );
}

/* ---------- What counts as a fair fantasy football trade? ---------- */

function WhatCountsAsFairSection({ settings }: { settings: WrittenSectionsSettings }) {
  return (
    <section aria-labelledby="trade-calculator-fair" className="space-y-6">
      <FeatureSectionHeader
        id="trade-calculator-fair"
        icon={BadgeCheck}
        tone="purple"
        eyebrow="Fairness"
        title="What counts as a fair fantasy football trade?"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard icon={Users} title="Fair for both rosters">
          <p>
            In the plain sense, a fair trade is one that leaves both rosters better positioned for whatever each
            team is trying to do this season, and that is a roster-need question this calculator does not try to
            answer. It prices what is actually changing hands, nothing about which team is rebuilding, which one is
            chasing a title this year, or which one is thin at a position the other can afford to sell from.
          </p>
        </InfoCard>

        <InfoCard icon={Calculator} tone="purple" title="Fair to the calculator">
          <p>
            To the calculator, fair means close, not identical. A trade landing inside the near-even band above is
            not a tie in any real sense, it is a gap too small for the numbers behind it to be trusted to call a
            winner. A small, consistent edge is still worth taking over a full season even when it is nowhere near a
            blowout, so read a {settings.resultLabel} with a modest margin as a real lean, not as noise the
            calculator failed to filter out.
          </p>
        </InfoCard>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

function FaqSection({ faq }: { faq: TradeCalculatorFaqEntry[] }) {
  return (
    <section aria-labelledby="trade-calculator-faq" className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <FeatureSectionHeader
            id="trade-calculator-faq"
            layout="stacked"
            icon={CircleHelp}
            eyebrow="FAQ"
            title="Trade calculator questions, answered"
          />
        </div>
        <FaqAccordion items={faq} />
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">Where to go next</h3>
        <ul role="list" className="mt-3 grid gap-3 md:grid-cols-3">
          <li>
            <LinkTile
              href="/tools/league-pulse"
              icon={Lightbulb}
              title="Trade suggestions for your league"
              body="Sync a Sleeper league for more ideas on the same two rosters."
            />
          </li>
          <li>
            <LinkTile
              href="/games/would-you-rather"
              icon={Vote}
              accent="purple"
              title="Vote on real trades in Would You Rather"
              body="See how other managers call the same kind of decision."
            />
          </li>
          <li>
            <LinkTile
              href="/tools/who-should-i-start"
              icon={ClipboardCheck}
              title="Who should I start this week"
              body="Not a trade question? Beacon Breakdown answers that one instead."
            />
          </li>
        </ul>
      </div>
    </section>
  );
}
