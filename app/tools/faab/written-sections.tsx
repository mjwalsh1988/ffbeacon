/**
 * The written half of the FAAB calculator page.
 *
 * The form above hydrates; these words do not wait for it. They are the part
 * of the page a crawler reads and the part a first-time visitor reads before
 * deciding whether to type anything. Every claim matches what the calculator
 * does (lib/faab/*): the three-rung ladder, the drop candidates, the roster
 * need, the market read, and the format and source chips.
 *
 * No numbers here are admin-editable, so nothing is passed in from settings.
 */

import {
  BarChart3,
  Calculator,
  Layers,
  Scale,
  Scissors,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Users,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

export const FAAB_FAQ: FaqAccordionItem[] = [
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
      "Yes. Manual mode takes your league size, starter count, remaining budget and how badly you need the position, and prices the player against the best option you could already start. Connecting a league gets you the sharper version, with drop candidates, rival budgets and your league's own past winning bids.",
  },
  {
    question: "Is the FAAB calculator free?",
    answer:
      "Yes, and it stays that way. No account is needed. Signing in only saves your Sleeper username so the league loads by itself next time.",
  },
];

export function WrittenSections() {
  return (
    <ToolExplainer
      id="faab-explainer"
      icon={Calculator}
      eyebrow="The method"
      title="How the FAAB calculator decides what to bid"
      intro="FAAB stands for free agent acquisition budget: the fake money your league gives every team to bid on waiver pickups. This tool turns the question of how much to bid into three numbers, and it prices the player against your roster rather than against a rumor."
      steps={[
        {
          icon: Search,
          title: "Pick the player",
          body: "Type the free agent you are chasing. With a Sleeper league connected, the tool already knows your roster, your remaining budget and who else in the league can outbid you. Without one, tell it your league size, starters and budget by hand.",
        },
        {
          icon: BarChart3,
          title: "Measure what he actually adds",
          body: "The question is never how good he is in the abstract. It is how many weeks he would start for you over the rest of the season, how many points he adds after the player you would cut, and what that does to your playoff odds.",
        },
        {
          icon: Users,
          title: "Read the room",
          body: "A player is worth more to a team that needs a starter than to one stacking its bench, and a bid is cheaper when nobody else has the money to compete. The tool weighs both, and it weighs the calendar: unspent budget is worth nothing in January.",
        },
        {
          icon: Layers,
          title: "Get a ladder, not a number",
          body: "You get three rungs. Bid this is the number that usually wins. To be sure is what it takes when you cannot afford to lose him. Walk away above is the price at which winning the claim becomes the mistake.",
        },
      ]}
      notes={[
        {
          icon: Scissors,
          title: "It tells you who to cut",
          body: "Up to four players your lineup would miss least, cheapest first. A pickup you cannot fit on the roster is not a pickup.",
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
      faq={FAAB_FAQ}
      faqTitle="FAAB questions, answered"
      next={[
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
          href: "/tools/trade-calculator",
          icon: Scale,
          title: "Grade a trade",
          body: "Both sides in, a verdict out, weighted for your league's format.",
        },
      ]}
    />
  );
}
