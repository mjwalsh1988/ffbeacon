import type { Metadata } from "next";
import {
  BarChart3,
  Calculator,
  ListChecks,
  ListOrdered,
  Newspaper,
  Radar,
  Radio,
  Scale,
  Timer,
  Trophy,
  Workflow,
} from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { LinkTile } from "@/components/link-tile";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your My Beacon dashboard: quick links to every FF Beacon tool, your own boards, and your Signal.",
};

/**
 * /my-beacon
 *
 * The landing surface of the personal space. The account facts that used to
 * open this page as a row of four tiles now live in the rail (see
 * beacon-rail.tsx), where they show on every My Beacon page rather than only on
 * this one, so the main column is what you can go and do.
 */

type Destination = {
  href: string;
  title: string;
  body: string;
  icon: typeof Trophy;
  accent?: "cyan" | "purple";
};

/** Yours: the surfaces that hold something belonging to this account. */
const YOURS: Destination[] = [
  {
    href: "/my-beacon/sleeper-leagues",
    title: "Sleeper leagues",
    body: "Save your handle, sync every league, and open any one of them for the deep view.",
    icon: Trophy,
  },
  {
    href: "/my-beacon/rankings",
    title: "Rankings boards",
    body: "Rank players in your own order, overall or one position at a time, with tiers when you want them.",
    icon: ListOrdered,
    accent: "purple",
  },
  {
    href: "/my-beacon/draft-tracker",
    title: "Draft Tracker",
    body: "Cross players off by hand for a draft in a room, or on a site we do not connect to.",
    icon: ListChecks,
    accent: "cyan",
  },
  {
    href: "/my-beacon/signal",
    title: "Your Signal",
    body: "Your public page: handle, showcase, links, and a Wall people can talk on.",
    icon: Radio,
  },
];

/** The rest of the system, from the page you land on after signing in. */
const TOOLS: Destination[] = [
  {
    href: "/rankings",
    title: "Rankings board",
    body: "Values, tiers, and seven-day movement for every format, from the source you picked.",
    icon: BarChart3,
  },
  {
    href: "/tools/league-pulse",
    title: "League Pulse",
    body: "Read any Sleeper league in one screen, with Power Pulse on what each team should win.",
    icon: Workflow,
    accent: "purple",
  },
  {
    href: "/tools/on-the-clock",
    title: "On The Clock",
    body: "A live draft room that flags who is falling while your clock is still running.",
    icon: Timer,
  },
  {
    href: "/tools/signal-check",
    title: "Signal Check",
    body: "Grade a trade and see the margin, the shape, and how confident the read is.",
    icon: Scale,
    accent: "purple",
  },
  {
    href: "/tools/faab",
    title: "FAAB Calculator",
    body: "Market value weighed against your real need, turned into a bid range.",
    icon: Calculator,
  },
  {
    href: "/brief",
    title: "The Beacon Brief",
    body: "What broke today, and what it does to the rosters you actually own.",
    icon: Newspaper,
    accent: "purple",
  },
];

const COMING_SOON = [
  {
    title: "Custom scoring profiles",
    body: "Save your league's exact scoring and use it everywhere: rankings, trade values, FAAB.",
  },
  {
    title: "Weekly digest",
    body: "A plain-English summary of what changed across your leagues, every Tuesday.",
  },
  {
    title: "Trade radar",
    body: "A nudge when a player you roster swings hard in value, scoped to your formats.",
  },
];

export default async function MyBeaconDashboardPage() {
  return (
    <div className="space-y-6">
      <Panel
        eyebrow="Yours"
        title="What you have here"
        helper="The three surfaces that hold something of yours."
      >
        <div className="grid gap-2 lg:grid-cols-3">
          {YOURS.map((item) => (
            <LinkTile key={item.href} {...item} />
          ))}
        </div>
      </Panel>

      <Panel
        eyebrow="Quick actions"
        title="Jump straight to the tools"
        helper="Every one of these follows the format and source in your rail."
      >
        <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {TOOLS.map((item) => (
            <LinkTile key={item.href} {...item} />
          ))}
        </div>
      </Panel>

      <Panel
        eyebrow="On the roadmap"
        title="What is landing in My Beacon next"
        helper="None of these are live yet. They will appear here as they ship."
      >
        <ul role="list" className="grid gap-2 sm:grid-cols-3">
          {COMING_SOON.map((item) => (
            <li
              key={item.title}
              className="rounded-card border border-dashed border-line bg-base/40 p-4"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                Coming soon
              </p>
              <h3 className="mt-1.5 text-sm font-semibold text-ink">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel eyebrow="Games" title="When the roster can wait">
        <div className="grid gap-2 lg:grid-cols-2">
          <LinkTile
            href="/games/signal-scout"
            icon={Radar}
            title="Signal Scout"
            body="Decode the profile, name the player. Built on the same data as the board."
          />
          <LinkTile
            href="/guides"
            icon={Newspaper}
            title="Guides"
            body="The glossary, and a draft guide that rebuilds itself all preseason."
            accent="purple"
          />
        </div>
      </Panel>

      <section aria-labelledby="signout-heading">
        <h2 id="signout-heading" className="sr-only">
          Sign out
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface/50 p-4">
          <p className="text-sm text-ink-muted">Done for the day? End your session.</p>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-card border border-line bg-base px-4 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign out
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
