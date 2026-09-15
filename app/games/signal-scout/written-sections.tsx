/**
 * The written half of the Signal Scout page.
 *
 * The game is a client component, and the How It Works panel in the rail is a
 * collapsed disclosure. These words are open by default, sit under the game,
 * and say what the game is to someone who has not started a round: a reader
 * arriving from a search, or a reviewer deciding whether the page has content.
 *
 * EVERY NUMBER IS PASSED IN FROM LIVE SETTINGS, the same rule how-it-works.tsx
 * follows: if an admin changes a cost, this copy must reflect it on the next
 * page load. The tier names come from TIER_DISPLAY_NAMES so this section and
 * the clue chips on the board cannot call the same tier two different things.
 */

import {
  Database,
  Flame,
  Radar,
  Scale,
  Search,
  Trophy,
  Users,
  Vote,
  Workflow,
  Zap,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";
import { TIER_DISPLAY_NAMES } from "./clue-grid";

export type SignalScoutWrittenProps = {
  startingScore: number;
  /** Whether guests may play at all. When false, guestDailyLimit is moot. */
  guestPlayEnabled: boolean;
  guestDailyLimit: number;
  maxWrongGuesses: number;
  wrongGuessPenalty: number;
  tierCosts: {
    weak: number;
    clear: number;
    ping: number;
    scan: number;
  };
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function guestsMayPlay(p: SignalScoutWrittenProps): boolean {
  return p.guestPlayEnabled && p.guestDailyLimit > 0;
}

export function buildSignalScoutFaq(p: SignalScoutWrittenProps): FaqAccordionItem[] {
  return [
    {
      question: "Is Signal Scout free?",
      answer: guestsMayPlay(p)
        ? `Yes. Guests get ${p.guestDailyLimit} ${plural(p.guestDailyLimit, "round", "rounds")} a day with no account at all. An account is free and removes the daily cap.`
        : "Yes. An account is free, and it is what lets your streaks and scores be saved.",
    },
    {
      question: "How is the score calculated?",
      answer: `Each round starts at ${p.startingScore.toLocaleString()} points. Every hint you buy and every wrong guess is subtracted. What is left when you name the player is your score. Give up or run out of guesses and the round scores zero.`,
    },
    {
      question: "What is the difference between the two streaks?",
      answer:
        "Signal Streak counts rounds in a row you solved with points left. Daily Scout Streak counts days in a row you completed at least one round. A skipped round or a burned-out round resets the first; a missed day resets the second.",
    },
    {
      question: "Who is on the leaderboards?",
      answer:
        "Signed-in players. An account is what puts your scores and streaks on the boards, and whichever boards are switched on sit beside the game.",
    },
    {
      question: "Where do the clues come from?",
      answer:
        "The same player data behind the rankings: age, college, position, team, jersey number and positional finishes. Nothing is invented for the game, so being good at Signal Scout is the same thing as knowing the player pool.",
    },
  ];
}

export function WrittenSections(p: SignalScoutWrittenProps) {
  return (
    <ToolExplainer
      id="signal-scout-explainer"
      icon={Radar}
      eyebrow="The game"
      title="How to play Signal Scout"
      intro="A hidden NFL player, a card of clues, and a search box. Every clue you buy costs points from the round's signal, and every wrong guess costs more. Name the player with signal to spare and you bank what is left."
      steps={[
        {
          icon: Radar,
          title: "Read the starter clues",
          body: "Each round opens with a few free clues on the mystery profile, the kind of thing a fantasy manager already half knows. Some rounds those are enough.",
        },
        {
          icon: Zap,
          title: "Buy a hint, or do not",
          body: `Four tiers, each dearer and each more revealing: ${TIER_DISPLAY_NAMES.weak} (${p.tierCosts.weak} points), ${TIER_DISPLAY_NAMES.clear} (${p.tierCosts.clear}), ${TIER_DISPLAY_NAMES.ping} (${p.tierCosts.ping}) and ${TIER_DISPLAY_NAMES.scan} (${p.tierCosts.scan}). The round starts at ${p.startingScore.toLocaleString()} points, so every hint is a bet that the clue is worth more than the points.`,
        },
        {
          icon: Search,
          title: "Name the player",
          body: `Type the name and lock it in. A wrong guess is a Bad Read and costs ${p.wrongGuessPenalty} points, and ${p.maxWrongGuesses} of them ${plural(p.maxWrongGuesses, "ends", "end")} the round.`,
        },
        {
          icon: Trophy,
          title: "Bank what is left",
          body: "Solve it and the remaining signal is your score for the round. Keep solving rounds with points left and your Signal Streak climbs. Play at least one round a day and your Daily Scout Streak does too.",
        },
      ]}
      notes={[
        {
          icon: Flame,
          title: "Burning out",
          body: "Buy a hint you cannot afford and the signal burns to zero. You can still guess, but the round cannot score and your Signal Streak resets. The game asks before it lets you do it.",
        },
        {
          icon: Users,
          title: "Guests play too",
          body: guestsMayPlay(p)
            ? `${p.guestDailyLimit} free ${plural(p.guestDailyLimit, "round", "rounds")} a day, Eastern time, without an account. Signing in unlocks unlimited rounds, saved streaks and the leaderboards.`
            : "Sign in to play. An account is free, and it is what saves your streaks and puts you on the leaderboards.",
          tone: "cyan",
        },
        {
          icon: Database,
          title: "Real profiles, not trivia",
          body: "Every clue comes from the same player data behind the rankings. Good at Signal Scout is the same thing as knowing the player pool.",
          tone: "success",
        },
      ]}
      faq={buildSignalScoutFaq(p)}
      faqTitle="Signal Scout questions, answered"
      next={[
        {
          href: "/games/would-you-rather",
          icon: Vote,
          title: "Would You Rather?",
          body: "The other game. A real trade, the names taken off, and your call on who won.",
        },
        {
          href: "/tools/trade-calculator",
          icon: Scale,
          title: "Grade a trade",
          body: "Both sides in, a verdict out, weighted for your league's format.",
          accent: "purple",
        },
        {
          href: "/tools/league-pulse",
          icon: Workflow,
          title: "Your leagues, one page",
          body: "Every roster, trade and waiver move in your Sleeper league.",
        },
      ]}
    />
  );
}
