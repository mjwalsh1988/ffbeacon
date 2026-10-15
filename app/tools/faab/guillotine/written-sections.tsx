/**
 * The written half of the guillotine FAAB calculator page.
 *
 * Its own words on purpose. The general page's WrittenSections, MarketStats
 * and DynastySection are not rendered here, and none of their sentences are
 * reused, because two URLs carrying the same body copy read as one page to a
 * search engine. The plan of record is
 * docs/seo-audit/gsc-growth-plan-2026-10-15.md, section 3.5.
 *
 * The four headings, in order: the main heading (how the format changes a
 * claim), "What this calculator reads" (the steps), "Platform differences
 * that change a bid" (one note pointing at the platform table under the
 * market figures) and the FAQ. Every claim matches what the manual chopped
 * mode does (app/tools/faab/manual-setup.ts, lib/faab/*).
 */

import Link from "next/link";
import {
  Calculator,
  Layers,
  ListChecks,
  Scissors,
  SlidersHorizontal,
  Swords,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

const CHOPPED_GUIDE = "/guides/chopped-league-strategy";

/** The id of the platform table in chopped-market-table.tsx. */
export const PLATFORM_TABLE_ID = "chopped-platforms";

const LINK_CLASS =
  "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/**
 * Six questions, the ones section 3.5 of the plan names. ToolExplainer builds
 * both the accordion and the FAQPage JSON-LD from this one list, so the schema
 * can never claim an answer the page does not show.
 */
export const GUILLOTINE_FAQ: FaqAccordionItem[] = [
  {
    question: "How much FAAB should I spend in a guillotine league?",
    answer:
      "It depends on where you stand this week more than on the player. The calculator steps the bid up through four answers: safe, middle of the pack, near the cut and bottom two. The bottom-two price for the same player is about double the safe one. Our chopped league strategy guide, linked below, walks through that ladder and when to hold the money instead.",
  },
  {
    question: "Is a chopped league the same as a guillotine league?",
    answer:
      "In how it plays, yes: the lowest score each week is eliminated and that roster goes back to waivers. Chopped is the name Sleeper has used since August 2025, Yahoo calls it a death league and ESPN a knockout league. The calculator treats them alike and asks for your platform, because the rules on minimum bids and released rosters differ.",
  },
  {
    question: "When do chopped players hit waivers?",
    answer:
      "Once the week's chop is settled. The eliminated team's players are released into the pool and can be claimed on the next waiver run. FFPC and Fantasy Life stop releasing rosters after week 14, so from then on the wire only gets thinner.",
  },
  {
    question: "Should I save FAAB for the end?",
    answer:
      "Some of it. Fewer teams means fewer bidders late in the season, but every roster still standing is a strong one, and a budget does you no good once you are out. With a league connected, the result's pace line compares the share of your budget you still hold with a target for this week and says whether you are ahead of it or behind.",
  },
  {
    question: "Can I connect my Sleeper chopped league?",
    answer:
      "Yes. Enter your Sleeper username and pick the league. The calculator reads every roster, estimates how likely you are to be cut this week if you add him and if you do not, and prices the claim mostly on the gap between the two.",
  },
  {
    question: "Does this work for a 10-team league?",
    answer:
      "Yes. The inputs are the size of the field at the draft and how many teams are left, so a 10-team league works the same way as 12, 16 or 18 teams, which are the other common sizes.",
  },
];

export function GuillotineWrittenSections() {
  return (
    <ToolExplainer
      id="guillotine-explainer"
      icon={Scissors}
      eyebrow="Chopped league bidding"
      title="How a chopped league changes what a claim is worth"
      intro={
        <>
          {/* Three short paragraphs inside the header's one <p>: blocks rather
              than nested paragraphs, which HTML does not allow. */}
          <span className="block">
            A chopped league has no head-to-head opponent. Every week the lowest score is cut, so
            the only team you are playing is whoever finishes last, and a waiver claim is a bid
            against finishing there.
          </span>
          <span className="mt-3 block">
            That changes the price of a player. The one who keeps you off the bottom on Sunday is
            worth more to you this week than his rest-of-season numbers suggest, and a team near
            the cut should pay more for him than a team sitting comfortably in the middle.
          </span>
          <span className="mt-3 block">
            The wire also refills. Each chopped roster goes back into the pool after the cut, so
            the players on offer next week are usually better than the ones on offer now, and a
            dollar you hold today often buys more later.
          </span>
        </>
      }
      stepsHeading="What this calculator reads"
      steps={[
        {
          icon: Users,
          title: "Teams at the draft and teams left",
          body: "How many teams the league started with and how many are still alive. The share of the field still standing sets how many teams are likely to bid against you and how far chopped-league prices have fallen by now.",
        },
        {
          icon: Target,
          title: "Where you stand this week",
          body: (
            <>
              Four answers, from bottom two to safe. This is the biggest single input on the page:
              from one end of the scale to the other it moves the bid to about twice the money
              for the same player in the same week. The ladder behind that figure is in our guide
              on{" "}
              <Link href={`${CHOPPED_GUIDE}#how-much-heading`} className={LINK_CLASS}>
                how much to bid in a chopped league
              </Link>
              .
            </>
          ),
        },
        {
          icon: SlidersHorizontal,
          title: "Your platform",
          body: "Sleeper, Yahoo, ESPN, FFPC and Fantasy Life each run the format with their own rules. The minimum bid sets the floor of a claim, and the platform table further down this page lists it for each one, along with the week each stops releasing chopped rosters.",
        },
        {
          icon: Wallet,
          title: "Your budget and the league's",
          body: "What you have left to spend and what every team started the season with. Each price is worked out as a share of the full budget, then turned back into your dollars.",
        },
      ]}
      notesHeading="Platform differences that change a bid"
      notes={[
        {
          icon: Layers,
          title: "Minimum bids and release cutoffs",
          body: (
            <>
              The{" "}
              <Link href={`#${PLATFORM_TABLE_ID}`} className={LINK_CLASS}>
                platform table
              </Link>{" "}
              under the market figures lists the two rules that differ: the smallest claim each
              platform accepts, which sets the floor of a bid, and the last week a chopped roster
              goes back to waivers, after which the wire stops refilling.
            </>
          ),
          tone: "purple",
        },
      ]}
      faq={GUILLOTINE_FAQ}
      faqTitle="Guillotine league FAAB questions"
      next={[
        {
          href: CHOPPED_GUIDE,
          icon: Scissors,
          title: "Chopped league strategy",
          body: "When to hold your budget, when to spend it, and how the danger ladder works.",
          accent: "purple",
        },
        {
          href: "/waiver-wire",
          icon: ListChecks,
          title: "This week's waiver wire",
          body: "Players still out there this week, with a bid range beside each.",
          accent: "cyan",
        },
        {
          href: "/tools/faab",
          icon: Calculator,
          title: "FAAB calculator",
          body: "Redraft and dynasty claims, priced against your own roster.",
        },
        {
          href: "/tools/who-should-i-start",
          icon: Swords,
          title: "Who should I start",
          body: "A start or sit call on your players, with a confidence figure.",
        },
        {
          href: "/guides/faab-settings-by-platform",
          icon: SlidersHorizontal,
          title: "FAAB settings by platform",
          body: "Each platform's budgets, minimum bids and waiver rules, side by side.",
        },
      ]}
    />
  );
}
