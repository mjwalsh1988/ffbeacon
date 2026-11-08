/**
 * The written half of the Long Shot page: what the game is, for a reader who
 * has not played and for a crawler. Every number comes from live settings,
 * so an admin change shows here on the next load.
 */

import { Clapperboard, Crosshair, Flame, Radar, RadioTower, Target, Trophy, Vote, Zap } from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";
import type { LongShotSettings } from "@/lib/long-shot/types";

export function buildLongShotFaq(s: LongShotSettings): FaqAccordionItem[] {
  const p = s.tiers.points;
  return [
    {
      question: "Is Long Shot free?",
      answer: "Yes. It needs a free account, because the five prompts are the same for everyone and an account is what keeps one person to one Hurry-Up a day.",
    },
    {
      question: "How are points decided?",
      answer: `Every correct answer is ranked by how many of our redraft leagues roster that player. The most rostered quarter of answers are Chalk (${p.chalk} points), then Field (${p.field}), Deep (${p.deep}), Sleeper (${p.sleeper}), and the rarest tenth are Long Shots (${p.long_shot}). A wrong answer or a timeout scores 0.`,
    },
    {
      question: "What is a Lone Signal?",
      answer: `A correct answer given by fewer than ${Math.round(s.bonus.lone_share * 100)} percent of the day's Hurry-Up players earns ${s.bonus.points} bonus points, paid overnight once the day ends, on days with at least ${s.bonus.min_room} finished players.`,
    },
    {
      question: "When does a new puzzle start?",
      answer: "At midnight Eastern time, every day.",
    },
    {
      question: "Can I play without the clock?",
      answer: "Yes. Film Room plays every prompt with no clock and records nothing. It opens on today's puzzle once your Hurry-Up is done, and plays a past day before that.",
    },
  ];
}

export function WrittenSections({ settings }: { settings: LongShotSettings }) {
  const p = settings.tiers.points;
  return (
    <ToolExplainer
      id="long-shot-explainer"
      icon={Crosshair}
      eyebrow="The game"
      title="How to play Long Shot"
      intro="Five fantasy prompts a day, the same five for everyone. Each one has many right answers. Name a player who fits, and the fewer people who roster him, the more he is worth."
      steps={[
        { icon: Target, title: "Read the prompt", body: "Something like a running back with 100 rushing yards and a touchdown in one game this season. There are always at least eight correct players." },
        { icon: Zap, title: "Beat the clock", body: `Hurry-Up gives you ${settings.timer.seconds} seconds a prompt. Pick a player from the search and press Answer.` },
        { icon: Flame, title: "Go deep", body: `The obvious answer scores ${p.chalk}. The one nobody rosters scores ${p.long_shot}. The tier depends on how many of our leagues roster him.` },
        { icon: Trophy, title: "Come back tomorrow", body: "Your total goes on the daily board, your streak grows a day, and a new puzzle is up at midnight Eastern." },
      ]}
      notes={[
        { icon: RadioTower, title: "Lone Signal", body: `Give an answer almost nobody else did and earn ${settings.bonus.points} bonus points, settled overnight.`, tone: "cyan" },
        { icon: Clapperboard, title: "Film Room", body: "No clock and nothing recorded: practice on a past day, or replay today once your Hurry-Up is in.", tone: "purple" },
        { icon: Radar, title: "Built from our own data", body: "Every answer set is computed from FF Beacon's stats, finishes, rankings and league data when the day's puzzle is built.", tone: "success" },
      ]}
      faq={buildLongShotFaq(settings)}
      faqTitle="Long Shot questions, answered"
      next={[
        { href: "/games/signal-scout", icon: Radar, title: "Signal Scout", body: "One hidden player, a card of clues. How few do you need?" },
        { href: "/games/would-you-rather", icon: Vote, title: "Would You Rather?", body: "A real trade with the names taken off. Who won it?", accent: "purple" },
      ]}
    />
  );
}
