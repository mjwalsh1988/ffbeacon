/**
 * The written half of the Manager Pulse entry page.
 *
 * Rendered on BOTH returns of the page (signed in and signed out), because an
 * explainer on one branch is invisible to half the audience. The signed-out
 * branch is the one search engines see (every report is noindex); the
 * signed-in branch is where a reader actually meets the words capture,
 * league-season and lens, so both need it.
 *
 * Numbers that an admin can change (the season window, the hourly budget, the
 * lookup rate limits) are deliberately NOT stated here. Every claim matches
 * lib/manager-pulse/* and the CLAUDE.md section on Manager Pulse.
 */

import {
  Database,
  FileText,
  Filter,
  Lock,
  Scale,
  Timer,
  UserSearch,
  Vote,
  Workflow,
} from "lucide-react";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";

export const MANAGER_PULSE_FAQ: FaqAccordionItem[] = [
  {
    question: "What can I learn about a fantasy manager from their Sleeper history?",
    answer:
      "More than you would guess. Whether their record is skill or one lucky year. Whether they reach on rookies or wait on quarterbacks. Which players they have rostered season after season, and which they have never touched. How their trades have graded, and which positions they pay too much for. That last one is the whole point: an offer built around what someone overpays for is the one that gets accepted.",
  },
  {
    question: "Can I look up my own report?",
    answer:
      "Yes. Save your Sleeper username in My Beacon and this page offers your own report in one press. It is a useful mirror: most managers do not know their own tendencies until they see them counted.",
  },
  {
    question: "Is this private information?",
    answer:
      "No. Everything in a report comes from what Sleeper already publishes to anyone with a league link: rosters, drafts, transactions and results. Manager Pulse organizes it; it does not uncover anything. Reports are also kept out of search engines.",
  },
  {
    question: "Why is a report still building?",
    answer:
      "The first time a manager is looked up, their seasons are read from Sleeper one league at a time. You see a live partial report while that happens, labelled with how much of the history it covers so far, and it finishes on its own.",
  },
  {
    question: "Does it work for leagues on other apps?",
    answer:
      "No. Only Sleeper publishes league history openly, so a manager's ESPN or Yahoo leagues are invisible here.",
  },
];

export function WrittenSections() {
  return (
    <ToolExplainer
      id="manager-pulse-explainer"
      icon={UserSearch}
      eyebrow="The tool"
      title="What a Manager Pulse report tells you before you trade"
      intro="Every trade has a person on the other end, and most of us know almost nothing about how they actually play. Manager Pulse reads a Sleeper manager's public history across several seasons and turns it into a scouting report: what they win, how they draft, who they keep buying, and what they overpay for."
      steps={[
        {
          icon: UserSearch,
          title: "Type their Sleeper handle",
          body: "Not yours, theirs. Every league that manager has played in on Sleeper, back a few seasons, is read from Sleeper's public data. Nothing private is involved and nobody is notified.",
        },
        {
          icon: Database,
          title: "The history is captured once",
          body: "A finished season never changes, so it is read once and kept. Only the season in progress is read again, so a second look at the same manager costs nothing and loads instantly.",
        },
        {
          icon: FileText,
          title: "Eight sections, and the one you came for is near the top",
          body: "After a short overview the report leads with How to deal, the plain-English read on what an offer to this person should look like. Everything after it is the evidence: results, drafting, favorite players, every trade graded, waiver habits and lineup efficiency, and the leagues counted.",
        },
        {
          icon: Filter,
          title: "Switch the lens",
          body: "A manager can be a shark in redraft and a hoarder in dynasty. The lens filters the results, drafting, trading and roster-move sections to one kind of league, so you scout the version of them you are actually trading with.",
        },
      ]}
      notes={[
        {
          icon: Lock,
          title: "The one tool that needs an account",
          body: "A report reads several seasons of a real person's history, so this tool asks you to sign in. Everything else on FF Beacon stays open.",
        },
        {
          icon: Scale,
          title: "Every trade graded the same way",
          body: "Trades in the report are graded by Signal Check, the same pipeline behind the trade calculator, so an overpay habit is measured on one consistent scale rather than a hunch.",
          tone: "cyan",
        },
        {
          icon: Timer,
          title: "There is a budget",
          body: "A cold lookup can mean reading dozens of league seasons from Sleeper. Each reader gets a budget of league-seasons per hour, and a manager someone else has already looked up costs nothing.",
          tone: "success",
        },
      ]}
      faq={MANAGER_PULSE_FAQ}
      faqTitle="Manager Pulse questions, answered"
      next={[
        {
          href: "/tools/trade-calculator",
          icon: Scale,
          title: "Grade the offer",
          body: "Now that you know who you are dealing with, put both sides into Signal Check.",
        },
        {
          href: "/tools/league-pulse",
          icon: Workflow,
          title: "Your leagues, one page",
          body: "Every roster, trade and waiver move in your Sleeper league.",
          accent: "purple",
        },
        {
          href: "/games/would-you-rather",
          icon: Vote,
          title: "Vote on real trades",
          body: "Call the winner of a real trade cold, then see how the room and the numbers called it.",
        },
      ]}
    />
  );
}
