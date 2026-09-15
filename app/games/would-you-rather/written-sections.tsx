/**
 * The written half of the Would You Rather page.
 *
 * The main column is a client component and the rail's "How this works" is
 * four short steps. These words sit beneath both columns and explain the game
 * to a reader who has not voted yet.
 *
 * THE ONE RULE THAT MATTERS HERE (CLAUDE.md, "Would You Rather"): nothing that
 * hints at the answer may reach the browser before the vote is recorded. This
 * section is GENERIC on purpose. It names no trade, quotes no value, margin,
 * verdict, confidence or tally, and takes no review-shaped prop. The only live
 * number it carries is the guest vote allowance, which is a setting, not an
 * answer.
 *
 * The managers are Team A and Team B here, as everywhere else. Never "Side A".
 */

import {
  BarChart3,
  EyeOff,
  Radar,
  Scale,
  ShieldCheck,
  Users,
  Vote,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

export type WouldYouRatherWrittenProps = {
  guestVoteLimit: number;
  /** Whether trades are also posted as Discord polls. Off until an admin turns it on. */
  discordEnabled: boolean;
};

export function buildWouldYouRatherFaq(discordEnabled: boolean): FaqAccordionItem[] {
  const faq: FaqAccordionItem[] = [
    {
      question: "Where do the trades come from?",
      answer:
        "Real trades in Sleeper leagues that FF Beacon has synced through League Pulse. Only trades Signal Check has already graded make the pool, so every reveal has a verdict behind it.",
    },
    {
      question: "Why can't I see the values before I vote?",
      answer:
        "Because that is the game. A value on the board would turn a judgement call into a reading exercise. The board carries names, positions, pick slots and the league's format, and nothing else, until your vote is recorded.",
    },
    {
      question: "What does it mean when the room and Signal Check disagree?",
      answer:
        "It means the trade is interesting. The crowd prices names and reputation; the calculator prices production and scarcity in that league's format. When they split, one of them is usually early on a player, and the league context panel is where to look for which.",
    },
  ];
  if (discordEnabled) {
    faq.push({
      question: "Do the Discord votes count?",
      answer:
        "Yes. The same trade is posted as a poll in the FF Beacon Discord, and each Discord voter is counted once per trade, the same way a site vote is. The room you see after voting is both together.",
    });
  }
  faq.push({
    question: "Is it free?",
    answer:
      "Yes. Everything on FF Beacon is free, and this game only asks for a sign-in so that a vote can be counted once per person.",
  });
  return faq;
}

function guestNote(limit: number): string {
  if (limit <= 0) {
    return "Voting needs an account, so that one person can be counted once. That is what makes the percentages worth reading.";
  }
  const trades = limit === 1 ? "one trade" : `${limit} trades`;
  return `You get ${trades} without an account, so you can see what the game is before deciding. After that a sign-in is what lets one person count once, which is what makes the percentages worth reading.`;
}

export function WrittenSections({
  guestVoteLimit,
  discordEnabled,
}: WouldYouRatherWrittenProps) {
  return (
    <ToolExplainer
      id="would-you-rather-explainer"
      icon={Vote}
      eyebrow="The game"
      title="How Would You Rather works"
      intro="A real trade from a real Sleeper league, with the managers' names taken off. You call the winner cold. Then you find out how everyone else called it, what Signal Check says, and what that league's own numbers know about the pieces."
      steps={[
        {
          icon: Vote,
          title: "Call it",
          body: "Two sides, Team A and Team B, with the league's format shown because the same players are a different deal in superflex than in standard. Nothing on the board hints at the answer. Pick the side you would rather have.",
        },
        {
          icon: Users,
          title: "See the room",
          body: discordEnabled
            ? "The tally of every vote on this trade, from the site and from the FF Beacon Discord, with your pick marked. Sometimes the room is split down the middle. Sometimes you are the only one who saw it."
            : "The tally of every vote on this trade, with your pick marked. Sometimes the room is split down the middle. Sometimes you are the only one who saw it.",
        },
        {
          icon: Scale,
          title: "Read the Signal Check grade",
          body: "The same verdict the trade calculator would give this trade in this league's format: who won, by what margin, and how confident the grade is. It is hidden until you vote so it cannot lead you.",
        },
        {
          icon: BarChart3,
          title: "Read the league context",
          body: "Positional WAR, projections and value movement for every player who moved, and each team's Power Pulse rank and playoff odds, read from the league the trade actually happened in.",
        },
      ]}
      notes={[
        {
          icon: EyeOff,
          title: "Nobody is named",
          body: discordEnabled
            ? "The two managers are Team A and Team B here, in the Discord poll and in every sentence of the review. The league is named; the people never are."
            : "The two managers are Team A and Team B here and in every sentence of the review. The league is named; the people never are.",
        },
        {
          icon: ShieldCheck,
          title: "One vote per person per trade",
          body: "Your vote on a trade is counted once, forever. Come back to the same trade and you see the reveal for the side you originally picked, and it costs you nothing.",
          tone: "cyan",
        },
        {
          icon: Users,
          title: "Guests can play",
          body: guestNote(guestVoteLimit),
          tone: "success",
        },
      ]}
      faq={buildWouldYouRatherFaq(discordEnabled)}
      faqTitle="Would You Rather questions, answered"
      next={[
        {
          href: "/tools/trade-calculator",
          icon: Scale,
          title: "Grade your own trade",
          body: "The same pipeline behind the reveal, on a trade you are actually considering.",
        },
        {
          href: "/tools/league-pulse",
          icon: Workflow,
          title: "Your leagues, one page",
          body: "Every roster, trade and waiver move in your Sleeper league.",
          accent: "purple",
        },
        {
          href: "/games/signal-scout",
          icon: Radar,
          title: "Signal Scout",
          body: "The other game. A hidden player, a handful of clues, and a score to protect.",
        },
      ]}
    />
  );
}
