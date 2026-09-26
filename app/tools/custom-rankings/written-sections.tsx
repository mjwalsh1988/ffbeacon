/**
 * The written half of the custom rankings page: what Beacon Ranker does, how a
 * run works, and the questions a reader asks before starting one. This is where
 * the page's search phrases live (plan section 4): custom rankings, make your
 * own, tiers, rank players head to head.
 *
 * Every number here comes from the settings row, never typed in, so the guest
 * cap and the deletion time on this page are the ones the tool enforces.
 */

import {
  Crown,
  GitCompare,
  Layers,
  ListOrdered,
  Scale,
  Share2,
  Shield,
  Users,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

export type RankerWrittenProps = {
  winsBeforePrompt: number;
  guestCapMulti: number;
  guestCapSingle: number;
  retentionHours: number;
  defaultDepthMulti: number;
  defaultDepthSingle: number;
};

export function buildRankerFaq(p: RankerWrittenProps): FaqAccordionItem[] {
  return [
    {
      question: "How do I make my own fantasy football rankings?",
      answer: `Pick the rankings to start from and which players you want to rank, then answer one question at a time: which of these two would you rather have? Each new player starts at the bottom of your board and climbs until you keep the player above him. When you finish, the board is your custom rankings, saved to your account.`,
    },
    {
      question: "Why head to head instead of dragging players around?",
      answer:
        "Dragging a list of a hundred players means holding the whole list in your head. A two-player question is one decision you can actually make, and a reader who mostly agrees with the starting rankings answers about one question per player.",
    },
    {
      question: "What if I think a player belongs much higher?",
      answer: `After ${p.winsBeforePrompt} straight wins the builder asks whether to place him at a rank you pick or keep comparing one at a time. You can also use Put him at on any question without waiting.`,
    },
    {
      question: "Can I make tiers?",
      answer:
        "Yes. When a run finishes, the tier pass asks about each gap in turn: is there a real drop-off between these two? Yes draws a tier line. In the board editor you can add, move and remove tier lines whenever you like.",
    },
    {
      question: "Can I rank IDP players?",
      answer:
        "Yes. Pick one defensive position or all defenders, or switch defenders on for an overall board, where they join after the offensive players and climb from the bottom. No rankings source ranks defenders, so their starting order is our projected points for the rest of the season, or last season's points before projections exist.",
    },
    {
      question: "Do I need an account?",
      answer: `No. A guest can rank their top ${p.guestCapMulti} (top ${p.guestCapSingle} for one position). A guest board is deleted ${p.retentionHours} hours after its last change, and signing up or logging in keeps it, removes the limit, and adds tiers and a share link.`,
    },
    {
      question: "What does vs FF Beacon mean on my board?",
      answer:
        "How far your placement is from FF Beacon's own rankings today, in spots. 4 higher means you have the player four spots above where FF Beacon ranks him. It compares with FF Beacon whichever rankings you started from.",
    },
    {
      question: "Is it free?",
      answer: "Yes. Everything on FF Beacon is free.",
    },
  ];
}

export function WrittenSections(props: RankerWrittenProps) {
  return (
    <ToolExplainer
      id="custom-rankings-explainer"
      icon={ListOrdered}
      eyebrow="Beacon Ranker"
      title="How the custom rankings builder works"
      intro={`Build your own fantasy football rankings by answering one question at a time: which of these two players would you rather have? Your board assembles itself from the answers. Start from FF Beacon's rankings or another source, rank the top ${props.defaultDepthMulti} overall or the top ${props.defaultDepthSingle} at one position, and keep going past that whenever you like.`}
      steps={[
        {
          icon: Workflow,
          title: "Pick a start",
          body: "Choose the rankings to start from, the format and which players you are ranking. The choice belongs to this board only: your site-wide source and format do not change.",
        },
        {
          icon: GitCompare,
          title: "Answer two at a time",
          body: "Each question shows two players with their team, age and last three positional finishes. No rankings are shown while you choose, so the answer is yours.",
        },
        {
          icon: Share2,
          title: "Share it",
          body: "Draw tiers, see where you disagree most with FF Beacon, and put the board on your profile with its own link and social card.",
        },
      ]}
      notes={[
        {
          icon: Scale,
          title: "Compared with FF Beacon",
          body: "Every placement shows how far you are from FF Beacon's rankings today, in spots, up or down.",
        },
        {
          icon: Layers,
          title: "Tier lines",
          body: "A tier is a line drawn after a rank. It stays at that rank when players move, so moving a player never quietly changes a tier.",
          tone: "cyan",
        },
        {
          icon: Shield,
          title: "IDP included",
          body: "Linemen, linebackers and defensive backs can be ranked on their own boards or added to an overall board.",
          tone: "success",
        },
        {
          icon: Users,
          title: "Community rankings",
          body: "Saved boards are merged into community rankings for each format, and no single board is ever shown. You can opt a board out from its settings.",
        },
      ]}
      faq={buildRankerFaq(props)}
      faqTitle="Custom rankings questions, answered"
      next={[
        {
          href: "/rankings",
          icon: Crown,
          title: "FF Beacon rankings",
          body: "The rankings every board compares with.",
        },
        {
          href: "/rankings/community",
          icon: Users,
          title: "Community fantasy football rankings",
          body: "Everyone's boards, merged into one ranking per format.",
          accent: "purple",
        },
        {
          href: "/my-beacon/rankings",
          icon: ListOrdered,
          title: "Your boards",
          body: "Every board you have built, with the full editor.",
        },
      ]}
    />
  );
}
