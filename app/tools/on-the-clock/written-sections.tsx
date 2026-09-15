/**
 * The written half of the On The Clock page.
 *
 * The cockpit is a client component and carries almost no static prose: about
 * 130 words on the whole page before this section existed. These words say
 * what the room does, define Best Available and Team Need (the two signals the
 * page shows without explaining), and answer the questions people ask before
 * connecting a draft.
 *
 * The sync cooldown and refresh interval are admin-editable and are therefore
 * not stated here. Every claim matches lib/on-the-clock/* and the page's own
 * marquee.
 */

import {
  BarChart3,
  Bell,
  Headphones,
  ListOrdered,
  Scale,
  Search,
  Settings2,
  Sparkles,
  Timer,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

export const ON_THE_CLOCK_FAQ: FaqAccordionItem[] = [
  {
    question: "Does On The Clock make the pick for me?",
    answer:
      "No. It tells you who is worth the pick and why. You still make the pick in Sleeper, which keeps the draft room the only place a pick can happen.",
  },
  {
    question: "What is the difference between Best Available and Team Need?",
    answer:
      "Best Available is pure value: the best player left, regardless of your roster. Team Need is that same value adjusted for what your lineup is missing and what your format rewards. Early in a draft they usually agree. Late, when you have three receivers and no quarterback in a superflex league, Team Need is the one to listen to.",
  },
  {
    question: "Does it work for best ball, startup and rookie drafts?",
    answer:
      "It works for any Sleeper draft your username is part of, including best ball, dynasty startups and rookie drafts. Sleeper mock drafts are not tied to a league, so those do not appear in the list.",
  },
  {
    question: "Can the other managers in my league tell I am using it?",
    answer:
      "No. On The Clock reads the draft the same way the Sleeper app does, and it never posts anything. Nothing in your league changes because you opened it.",
  },
  {
    question: "Is it free?",
    answer:
      "Yes. No account is needed to connect a draft. Signing in only saves your Sleeper username so next draft night is one click.",
  },
];

export function WrittenSections() {
  return (
    <ToolExplainer
      id="on-the-clock-explainer"
      icon={Timer}
      eyebrow="The tool"
      title="How On The Clock helps you draft"
      intro="A live draft moves faster than any rankings sheet. On The Clock connects to your Sleeper draft as it happens, crosses off every player the moment they are taken, and tells you who is worth your pick when the clock is on you."
      steps={[
        {
          icon: Search,
          title: "Connect your Sleeper username",
          body: "Type it once and every league you are drafting in appears, grouped by drafting now, pre-draft, and done. Sign in and it is saved, so next draft night is one click.",
        },
        {
          icon: Timer,
          title: "Sync the room",
          body: "The draft board fills in from Sleeper and keeps itself current. Everyone watching the same draft shares one refresh, so a room of twelve managers does not hit Sleeper twelve times.",
        },
        {
          icon: Sparkles,
          title: "Read the two signals",
          body: "Best Available is the highest FF Beacon value still on the board. Team Need re-weights that value by the holes in your lineup and your league's format. When they agree, take the player. When they split, you know exactly what you are choosing between.",
        },
        {
          icon: Bell,
          title: "Watch for runs and cliffs",
          body: "When a position gets drafted in a burst, or the next tier at a position is about to empty, the room says so before it is your turn, so you are not the one left holding the last tight end.",
        },
      ]}
      notes={[
        {
          icon: Scale,
          title: "Trade while you draft",
          body: "Startup and rookie drafts are where picks move. Click the board to build an offer, and the analyzer grades it on the spot with the same values the board uses.",
        },
        {
          icon: BarChart3,
          title: "Every roster, a live power ranking",
          body: "Open any team in the draft, see the full trade history, and watch the power rankings and draft grades update as the picks land.",
          tone: "cyan",
        },
        {
          icon: Headphones,
          title: "Built to be heard",
          body: "Every pick, alert and recommendation is announced in words, so a screen reader user drafts with the same information at the same moment as everyone else.",
          tone: "success",
        },
        {
          icon: Settings2,
          title: "FF Beacon values, your league's format",
          body: "There is no source toggle here on purpose. The board uses FF Beacon values, and the format is read from your league's own Sleeper settings, so a superflex draft is priced as one.",
          tone: "cyan",
        },
      ]}
      faq={ON_THE_CLOCK_FAQ}
      faqTitle="Draft room questions, answered"
      next={[
        {
          href: "/guides/fantasy-football-draft-guide",
          icon: ListOrdered,
          title: "The draft guide",
          body: "Steals, swings and fades in every format, rebuilt nightly. Read it before the room opens.",
        },
        {
          href: "/tools/trade-calculator",
          icon: Scale,
          title: "Grade a pick trade",
          body: "Picks and players on both sides, a verdict out, in dynasty formats.",
          accent: "purple",
        },
        {
          href: "/tools/league-pulse",
          icon: Workflow,
          title: "After the draft",
          body: "Open the league and see how the rosters came out, with a power ranking on each.",
        },
      ]}
    />
  );
}
