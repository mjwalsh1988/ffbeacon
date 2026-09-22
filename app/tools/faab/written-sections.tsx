/**
 * The written half of the FAAB calculator page.
 *
 * The form above hydrates; these words do not wait for it. They are the part
 * of the page a crawler reads and the part a first-time visitor reads before
 * deciding whether to type anything. Every claim matches what the calculator
 * does (lib/faab/*): the goal toggle, the bid and its chance to win, the
 * walk-away line, the drop candidates, the rival table, and the chopped
 * branch.
 *
 * ONE ANSWER IS BUILT FROM LIVE DATA. "How much do people really bid?" quotes
 * the market cells the calculator itself prices against, passed in from the
 * page, with a figure-free fallback for an environment where the priors have
 * never been built. Everything else here is fixed copy, and no admin-editable
 * number is typed into it.
 */

import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Calculator,
  Layers,
  Scale,
  Scissors,
  Search,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";
import type { MarketFacts } from "./market-stats";

const CHOPPED_GUIDE = "/guides/chopped-league-strategy";

/** A share of the budget, without the float noise a quantile can carry. */
function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/**
 * The FAQ, with one answer read from the market.
 *
 * Built by a function rather than declared as a constant so the bidding
 * answer can quote live figures. The same array feeds the accordion and the
 * FAQPage structured data, so the schema can never claim a number the page
 * does not show.
 */
export function buildFaabFaq(market: MarketFacts | null): FaqAccordionItem[] {
  return [
    {
      question: "What is FAAB in fantasy football?",
      answer:
        "Free agent acquisition budget. Instead of a waiver order, every team gets the same imaginary budget for the season, usually $100 or $1,000, and bids on free agents in a blind auction. The highest bid wins and the money is gone for the year. The tension is that one big bid in September can leave you unable to afford the player you really need in November.",
    },
    {
      question: "How much of my FAAB budget should I bid on one player?",
      answer:
        "It depends on what he adds to your lineup, not on the hype. A starter you would play every week is worth a large share of what you have left; a bench stash is not. The calculator reads your roster and prices the claim in weeks started and points gained, then tells you where to stop.",
    },
    {
      question: "Why does the tool sometimes tell me to walk away?",
      answer:
        "Because the most expensive FAAB mistake is winning an auction you should have lost. Every dollar over what a player adds to your team is a dollar you will not have for the next one. The walk-away line is where the claim stops being worth it for your roster specifically, not for a roster in general.",
    },
    {
      question: "Does it work without connecting a Sleeper league?",
      answer:
        "Yes. Manual mode takes your league size, starter count, remaining budget and how badly you need the position, and prices the player against the best option you could already start. Connecting a league gets you the sharper version, with drop candidates, rival budgets and the teams who would actually start him.",
    },
    {
      question: "Is the FAAB calculator free?",
      answer:
        "Yes, and it stays that way. No account is needed. Signing in only saves your Sleeper username so the league loads by itself next time.",
    },
    {
      question: "Can you bid $0 in FAAB?",
      answer:
        "Yes on Sleeper, Yahoo, ESPN and Fleaflicker, and a $0 bid wins when nobody else bids. High-stakes leagues like the NFFC and FFPC set a $1 minimum. The calculator reads your league's minimum when it is connected.",
    },
    {
      question: "What happens when two FAAB bids tie?",
      answer:
        "Sleeper and Yahoo give it to the team higher in the rolling waiver order, and that team drops to the back. ESPN follows waiver order, Fleaflicker gives it to the worse team, and the FFPC gives it to the team with fewer points. The calculator counts your waiver position when it prices a tie.",
    },
    {
      question: "Is a $100 budget different from a $1,000 one?",
      answer:
        "Only in the numbers. Think in percentages: 12% is $12 of $100 and $120 of $1,000. Every figure here is a share of the league's full budget and converted to your dollars at the end.",
    },
    {
      question: "Should I spend my FAAB early?",
      answer:
        "In our synced leagues the most expensive stretch of the regular season is weeks 2 to 6, and prices jump again from week 14 when leftover budget is worth nothing. A starter who appears in September is often worth more than whoever appears in November, because you get him for more weeks.",
    },
    {
      question: "How much do people really bid?",
      answer: bidRealityAnswer(market),
    },
    {
      question: "How does FAAB work in dynasty?",
      answer: dynastyAnswer(market),
    },
    {
      question: "How is superflex different?",
      answer:
        "A second starting quarterback is scarce, and our data has quarterbacks going for the whole budget after an injury. Pick Superflex in the setup so the calculator prices quarterbacks against a superflex replacement level.",
    },
    {
      question: "How does FAAB work in chopped and guillotine leagues?",
      answer:
        "The lowest scorer is eliminated each week and the whole roster goes to waivers, so budgets are big and the goal is surviving the week. Prices fall as teams are eliminated because fewer rivals chase a pool full of starters. Connect a Sleeper chopped league or pick Chopped or guillotine in the setup, and read our chopped league strategy guide, linked under Where to go next.",
    },
  ];
}

/**
 * The dynasty answer, with the comparison in it when we can make one.
 *
 * This used to be four sentences of mechanics with no number in them, which is
 * why the page ranked several positions worse for "dynasty faab calculator"
 * than for the chopped equivalent: the chopped answer had a table behind it and
 * this one did not. The figures come from the same cells the section below
 * draws, so the FAQ and the chart can never disagree.
 */
function dynastyAnswer(market: MarketFacts | null): string {
  const mechanics =
    "Budgets do not roll over or reset on Sleeper unless the commissioner does it by hand, waivers often run through the offseason, and a young player's long-term value counts as well as his next start. With a dynasty league connected the calculator blends his market value into the bid, more for a rebuilding team than for a contender.";

  const dynasty = market?.dynastyByBidders.filter((row) => row.enough) ?? [];
  const redraft = new Map(
    (market?.redraftByBidders ?? []).filter((row) => row.enough).map((row) => [row.label, row]),
  );
  // The most contested pair we can publish both halves of. Without one the
  // answer is the mechanics alone rather than an invented comparison.
  const contested = [...dynasty].reverse().find((row) => redraft.has(row.label));
  const against = contested ? redraft.get(contested.label) : undefined;
  if (!contested || !against || against.median <= 0) return mechanics;

  const ratio = Math.round((contested.median / against.median) * 10) / 10;
  return `It costs more, but only when somebody else wants the player. With ${contested.label.toLowerCase()} bidding, the median winning claim in our synced dynasty and keeper leagues is ${pct(contested.median)} of budget against ${pct(against.median)} in redraft, about ${ratio} times the price. Unopposed claims go for nothing in both. ${mechanics}`;
}

/**
 * The one answer with live figures in it.
 *
 * Every number is read from the market cells and carries its own sample size
 * in the section above. When the priors have never been built there is a
 * sentence with no figures in it rather than an invented one.
 */
function bidRealityAnswer(market: MarketFacts | null): string {
  const bidders = market?.byBidders.filter((row) => row.enough) ?? [];
  if (!market || bidders.length === 0) {
    return "Less than most people expect. Half of all winning claims go for almost nothing, because most of them are uncontested, and the expensive ones are the handful of players several teams chase at once. The section above breaks down what our synced leagues have paid as soon as we have enough auctions to publish.";
  }

  const parts = bidders.map((row) => `${row.label.toLowerCase()}, ${pct(row.median)}`);
  const ratioClause =
    market.runnerUpRatio === null
      ? ""
      : ` Winners paid a median of ${Math.round(market.runnerUpRatio * 10) / 10} times the second-highest bid, so the number that wins is set by the competition rather than by the player.`;

  return `Less than most people expect, until somebody else wants the same player. Across ${market.auctions.toLocaleString()} winning bids from ${market.leagues.toLocaleString()} synced Sleeper leagues, the median claim by number of bidders runs ${parts.join("; ")}, as a share of the league's budget.${ratioClause} The tables above break it down by week, position and league type.`;
}

const LINK_CLASS =
  "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/**
 * The calculator and /guides/faab-strategy link to each other on purpose. The
 * calculator answers one claim; the guide is the season-long reasoning behind
 * its answers. The chopped guide sits beside it for the readers whose league
 * eliminates somebody every week, because almost none of the standard FAAB
 * reasoning survives that format.
 */
export function WrittenSections({ market = null }: { market?: MarketFacts | null }) {
  return (
    <ToolExplainer
      id="faab-explainer"
      icon={Calculator}
      eyebrow="The method"
      title="How the FAAB calculator decides what to bid"
      intro={
        <>
          FAAB stands for free agent acquisition budget: the fake money your league gives every
          team to bid on waiver pickups. This tool turns the question of how much to bid into a
          number, a chance of winning it and a line to walk away at, and it prices the player
          against your roster rather than against a rumor.{" "}
          {/* One line on purpose: this phrase is the one the chopped guide points readers here
              for, and splitting it across source lines makes it harder to find again. */}
          It doubles as a chopped league FAAB calculator, where the whole league is the opponent and the money works differently.{" "}
          The reasoning behind every number is written out step by step in our{" "}
          <Link href="/guides/faab-strategy" className={LINK_CLASS}>
            FAAB strategy guide
          </Link>
          .
        </>
      }
      steps={[
        {
          icon: Search,
          title: "Pick the player",
          body: "Type the free agent you are chasing. With a Sleeper league connected, the tool already knows your roster, your remaining budget and who else in the league can outbid you. Without one, tell it your league type, size, starters and budget by hand.",
        },
        {
          icon: BarChart3,
          title: "Measure what he actually adds",
          body: "The question is never how good he is in the abstract. It is how many weeks he would start for you over the rest of the season, how many points he adds after the player you would cut, and what that does to your playoff odds. In a chopped league it is what he does to your chance of surviving the week.",
        },
        {
          icon: Users,
          title: "Read the room",
          body: "What a claim costs is set by how many other teams file one and how much they hold, so the tool names the teams who would start him and what each can spend. Then it simulates the auction against our own record of what leagues pay.",
        },
        {
          icon: Target,
          title: "Pick your goal, get a number and a chance",
          body: (
            <>
              Good value is the cheapest bid that usually wins him. Make sure I win pays up to end
              the argument. Either way you get the chance that bid actually wins, and the price
              above which winning the claim becomes the mistake.{" "}
              <Link href="/guides/faab-strategy#room-heading" className={LINK_CLASS}>
                How the bid ladder is built
              </Link>
              .
            </>
          ),
        },
      ]}
      notes={[
        {
          icon: Scissors,
          title: "It tells you who to cut",
          body: "Up to four players your lineup would miss least, cheapest first. A pickup you cannot fit on the roster is not a pickup.",
        },
        {
          icon: Layers,
          title: "Works for chopped and guillotine leagues",
          body: (
            <>
              The lowest score goes out every week and the whole roster hits waivers, so worth is
              measured in survival and prices fall as the field shrinks. Connect one, or pick
              Chopped or guillotine in the setup.{" "}
              <Link href={CHOPPED_GUIDE} className={LINK_CLASS}>
                chopped league strategy
              </Link>
              .
            </>
          ),
          tone: "purple",
        },
        {
          icon: SlidersHorizontal,
          title: "It follows your format and values",
          body: "The chips at the top follow the site header, so a superflex league and a standard one get different answers for the same player.",
          tone: "cyan",
        },
        {
          icon: ShieldCheck,
          title: "Free, no account needed",
          body: "Manual mode needs nothing. Connecting a league needs only a Sleeper username, and saving it is optional.",
          tone: "success",
        },
      ]}
      faq={buildFaabFaq(market)}
      faqTitle="FAAB questions, answered"
      next={[
        {
          // First on the list on purpose. A reader who arrived on "faab
          // calculator" has already decided WHO they are bidding on; a reader
          // who has not is one click from the board that answers it.
          href: "/waiver-wire",
          icon: ListChecks,
          title: "This week's waiver wire",
          body: "Who is actually still available, whose role just changed, and a bid range for each.",
          accent: "cyan",
        },
        {
          href: "/guides/faab-strategy",
          icon: BookOpen,
          title: "FAAB strategy guide",
          body: "How much to bid on each kind of pickup, when to spend it all, and who to drop.",
          accent: "purple",
        },
        {
          href: CHOPPED_GUIDE,
          icon: Scissors,
          title: "Chopped league strategy",
          body: "Surviving a guillotine league: what to hold, when to spend it, and why prices fall.",
        },
        {
          href: "/tools/league-pulse",
          icon: Workflow,
          title: "See your whole league",
          body: "Every roster, trade and waiver move in your Sleeper league, on one page.",
        },
        {
          href: "/tools/who-should-i-start",
          icon: Swords,
          title: "Who should I start this week",
          body: "Put in your players and get a start/sit verdict with a confidence figure.",
          accent: "purple",
        },
        {
          href: "/guides/faab-settings-by-platform",
          icon: SlidersHorizontal,
          title: "FAAB settings by platform",
          body: "Budgets, minimum bids and waiver types on Sleeper, Yahoo, ESPN and NFL.com.",
        },
        {
          href: "/tools/trade-calculator",
          icon: Scale,
          title: "Grade a trade",
          body: "Both sides in, a verdict out, weighted for your league's format.",
        },
      ]}
    />
  );
}
