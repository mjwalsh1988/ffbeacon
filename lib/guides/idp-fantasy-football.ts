/**
 * The IDP guide's lesson list and FAQ (plan IDP-220, IDP-221).
 *
 * Kept outside the page module because a Next.js page may only export its
 * own reserved names, and because the test reads both. The FAQ is built from
 * the same league facts the page prints, so the answers and the page cannot
 * disagree, and the FAQPage JSON-LD is built from this same array.
 */

import type { IdpLeagueFacts } from "./idp-leagues";

export const IDP_GUIDE_LESSONS: { id: string; title: string }[] = [
  { id: "what-heading", title: "What IDP is" },
  { id: "scoring-heading", title: "Read your scoring first" },
  { id: "switch-heading", title: "Same players, four scoring systems" },
  { id: "scarcity-heading", title: "Which position runs out first" },
  { id: "repeat-heading", title: "What repeats from year to year" },
  { id: "labels-heading", title: "Position labels change value" },
  { id: "draft-heading", title: "Drafting defenders" },
  { id: "season-heading", title: "Managing IDP in season" },
  { id: "dynasty-heading", title: "Dynasty IDP" },
  { id: "setup-heading", title: "Setting up an IDP league" },
];

export type FaqItem = { question: string; answer: string };

export function buildIdpFaq(facts: IdpLeagueFacts): FaqItem[] {
  return [
    {
      question: "What is IDP in fantasy football?",
      answer:
        "IDP stands for individual defensive players. Instead of, or as well as, one team defense, an IDP league starts real defensive linemen, linebackers and defensive backs, and they score for tackles, sacks, interceptions and other defensive plays.",
    },
    {
      question: "What is Sleeper's default IDP scoring?",
      answer:
        "Solo tackle 2, assisted tackle 1, tackle for loss 2, sack 6, quarterback hit 1, pass defended 3, forced fumble 3, fumble recovery 3, safety 3, blocked kick 3, interception 6 and a defensive touchdown 6. FF Beacon calls this Sleeper default IDP scoring and uses it for every stored IDP finish.",
    },
    {
      question: "Which IDP position scores the most?",
      answer:
        "It depends on the scoring. Under tackle-heavy scoring the best linebackers lead, because an every-down linebacker makes the most tackles. When a tackle is worth less next to a sack, as in Big 3 scoring (1.25 a solo tackle against 5 a sack), the best edge rushers move ahead. Lesson 3 shows the same players under four systems.",
    },
    {
      question: "What does IDP flex mean?",
      answer: `An IDP flex slot can start a defensive lineman, a linebacker or a defensive back. On Sleeper it is shown as IDP. Of the ${facts.leagues} IDP leagues synced on FF Beacon, ${facts.flexOnly} start defenders only through IDP flex slots.`,
    },
    {
      question: "Does a tackle count twice in IDP scoring?",
      answer:
        "It can. On Sleeper the Tackle rule stacks on top of the solo and assisted tackle rules, so a league that scores both pays a solo tackle twice. The check in lesson 2 tells you whether yours does.",
    },
    {
      question: "Does FF Beacon project IDP players?",
      answer:
        "Every defender's player page shows the projected stat line published for his next game, scored under the IDP system you pick. League Pulse does not project defenders yet.",
    },
  ];
}
