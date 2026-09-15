/**
 * The written half of the League Pulse entry page.
 *
 * The page names Power Pulse, Positional WAR and the team status tags without
 * defining any of them, and a reader who has not typed a username sees a form
 * and three bullets. These words define the vocabulary, say what a Sleeper
 * username does and does not give away, and answer the questions the Discord
 * gets asked every week.
 *
 * Every claim matches lib/league-pulse.ts, lib/league-power-pulse.ts,
 * lib/league-positional-war.ts and lib/league-team-status.ts. Nothing here
 * is admin-editable, so nothing is passed in.
 */

import {
  Calculator,
  Gauge,
  LayoutList,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Tags,
  TrendingUp,
  UserSearch,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

export const LEAGUE_PULSE_FAQ: FaqAccordionItem[] = [
  {
    question: "Do I need a Sleeper account or a password?",
    answer:
      "You need a Sleeper username to look up, and nothing else. League Pulse reads the same public league data the Sleeper app shows anyone with the link. It never asks for a password and cannot change anything in your league.",
  },
  {
    question: "Can I look up a league I am not in?",
    answer:
      "Yes, if you know a username in it, because the data is public on Sleeper. The page is built for your own leagues, though, and the team status column only means something for a team you manage.",
  },
  {
    question: "Which scoring does it use?",
    answer:
      "Your league's own. Every number inside a league view is calculated from that league's actual scoring settings and roster slots, not from a generic PPR table. The only thing you choose is the value source used for player prices.",
  },
  {
    question: "Why does a league say my team has no standing yet?",
    answer:
      "The team status and the rankings are calculated the first time a league is opened, because calculating them for leagues nobody looks at would be wasted work. Open it once, or press Sync on the row, and it fills in.",
  },
  {
    question: "Does it work for ESPN or Yahoo leagues?",
    answer:
      "Not today. League Pulse reads Sleeper's public API, and Sleeper is the only major host that publishes league data openly. The manual tools on the site, the trade calculator, the FAAB calculator and the start/sit tool, work for any league.",
  },
];

export function WrittenSections() {
  return (
    <ToolExplainer
      id="league-pulse-explainer"
      icon={Workflow}
      eyebrow="The tool"
      title="What League Pulse shows you about your Sleeper league"
      intro="Sleeper's own app shows you one league at a time and one team at a time. League Pulse pulls every league your username is in onto one page, then opens each into a full read of the rosters, the trades, and who is really on course to win."
      steps={[
        {
          icon: Search,
          title: "Type a Sleeper username",
          body: "Yours, or anyone's. Sleeper's league data is public, so no account and no password are involved. Sign in once and your handle is saved, and the page loads by itself next time.",
        },
        {
          icon: LayoutList,
          title: "See every league at once",
          body: "Each row is a league: name, team count, roster shape and season. Once a league has been opened, the row also shows how your own team stands in it, so a six-league Sunday starts with the team that needs you most.",
        },
        {
          icon: Workflow,
          title: "Open the deep view",
          body: "Every roster with its values, every trade graded, the transaction feed, week by week schedules, and the lineup helper. Everything is read from your league's own scoring settings, so a superflex TE premium league is scored as one.",
        },
        {
          icon: Gauge,
          title: "Read the two rankings",
          body: "Two rankings, two questions. The trade-value ranking says who owns the most. Power Pulse says who should win the most games from here, built from weekly projections run against the real remaining schedule.",
        },
      ]}
      notes={[
        {
          icon: Sparkles,
          title: "Power Pulse, in one sentence",
          body: "A 1 to 99 score for how many games each team should win from here, ranked inside your league only. Draft picks are ignored on purpose: a 2028 first cannot start on Sunday.",
        },
        {
          icon: TrendingUp,
          title: "Positional WAR, in one sentence",
          body: "Positional WAR shows how fast each position runs out in your league. A steep line means the drop from the best starter to the next one is big, which is where your budget and your trades should go.",
          tone: "cyan",
        },
        {
          icon: Tags,
          title: "Contender, Loaded, Bubble, Rebuilder",
          body: "Each of your teams gets a one-word status from its projected wins and what its roster is worth, so the list sorts the teams that can win this year to the top. A one-year league reads Longshot where a dynasty one reads Rebuilder.",
          tone: "success",
        },
        {
          icon: RefreshCw,
          title: "Fresh, without hammering Sleeper",
          body: "A league is refreshed from Sleeper when you open it and then held for a while, so a reload is instant. Commissioners get a refresh button for the moment a trade goes through.",
          tone: "cyan",
        },
      ]}
      faq={LEAGUE_PULSE_FAQ}
      faqTitle="League Pulse questions, answered"
      next={[
        {
          href: "/tools/faab",
          icon: Calculator,
          title: "FAAB calculator",
          body: "What to bid on a waiver claim, priced against the roster you just looked at.",
        },
        {
          href: "/tools/manager-pulse",
          icon: UserSearch,
          title: "Scout a manager",
          body: "Four seasons of how a rival actually plays, before you send the offer.",
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
