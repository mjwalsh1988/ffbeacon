import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Clock,
  Newspaper,
  Radar,
  Vote,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { LinkTile } from "@/components/link-tile";
import { Panel } from "@/components/dashboard-panel";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead } from "@/components/app-shell/page-masthead";

export const metadata: Metadata = {
  alternates: { canonical: "/games" },
  title: "Fantasy Football Games",
  description:
    "Free, accessible fantasy football games built on real player data. Play Signal Scout, our hidden-player guessing game, with more games on the way.",
};

type Game = {
  /** Absent while the game is still being built. A card with no href renders as
   *  a non-interactive placeholder rather than a link to a page that is not
   *  there yet. Mirrors FeaturedGame on the homepage. */
  href?: string;
  title: string;
  tagline: string;
  description: string;
  /** Only meaningful on a playable game. */
  cta?: string;
  icon: LucideIcon;
  status: string;
};

const GAMES: Game[] = [
  {
    href: "/games/signal-scout",
    title: "Signal Scout",
    tagline: "Decode the profile. Find the player.",
    description:
      "A mystery player. A handful of clues. Decode the scouting profile and name the player before the signal burns out.",
    cta: "Start scouting",
    icon: Radar,
    status: "New",
  },
  {
    title: "Would You Rather?",
    tagline: "Two sides. One vote.",
    description:
      "Two sides of a real trade, one vote. Call the winner round after round, then see how your read stacks up against everyone else who played.",
    icon: Vote,
    status: "Coming soon",
  },
];

export default function GamesPage() {
  const playable = GAMES.filter((game) => game.href).length;

  return (
    <main id="main">
      <PageBody flush>
        <PageMasthead
          eyebrow="Games"
          title="Play the data you already trust."
          description="Free games built on the same real player data that powers our rankings and tools. Every round works the same by eye or by ear, no paywall, ever."
          stats={[
            {
              label: "Playable now",
              value: String(playable),
              detail: playable === 1 ? "More being built" : "More on the way",
              accent: "cyan",
            },
            { label: "Cost", value: "$0", detail: "No account needed", accent: "purple" },
          ]}
        />
      </PageBody>

      <PageColumns
        railLabel="About the games and where to go next"
        rail={
          <>
            <Panel eyebrow="Before you play" title="How these work" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>
                  Every round is built from the same player data behind the rankings
                  board, so what you learn playing carries straight into a draft.
                </li>
                <li>
                  Nothing here needs an account. Sign in only if you want your streak
                  and your place on a leaderboard kept.
                </li>
                <li>
                  Each game is playable by keyboard, and every clue is text, so a round
                  reads the same by ear as by eye.
                </li>
              </ul>
            </Panel>

            <Panel eyebrow="Elsewhere" title="Where to go next" headingLevel={2}>
              <div className="grid gap-2">
                <LinkTile
                  href="/rankings"
                  icon={BarChart3}
                  title="Rankings board"
                  body="The data the games are built on, for every format we carry."
                />
                <LinkTile
                  href="/brief"
                  icon={Newspaper}
                  title="The Beacon Brief"
                  body="What broke today, and what it does to your roster."
                  accent="purple"
                />
                <LinkTile
                  href="/tools"
                  icon={Wrench}
                  title="Every free tool"
                  body="League Pulse, On The Clock, Signal Check, and the rest."
                />
              </div>
            </Panel>
          </>
        }
      >
        <Panel
          eyebrow="The lineup"
          title="Choose a game to play"
          helper="Playable games first. The rest arrive here as they are finished."
        >
          <ul className="grid gap-4 lg:grid-cols-2" role="list">
            {GAMES.map((game) => (
              // Keyed by title, not href: an unbuilt game has no href yet.
              <li key={game.title}>
                <GameCard game={game} />
              </li>
            ))}
          </ul>
        </Panel>
      </PageColumns>
    </main>
  );
}

/* ---------- Game cards ---------- */

function GameCard({ game }: { game: Game }) {
  const { href, title, tagline, description, cta, icon: Icon, status } = game;

  // A game still in development gets a non-interactive card: dashed border,
  // recessed surface, muted icon, no hover lift, and no CTA button. Rendering it
  // as a Link would put a dead destination in the tab order and promise a page
  // that does not exist. This is the same treatment the homepage games grid and
  // the pending cards on /guides use, so "not built yet" reads identically
  // everywhere on the site.
  if (!href) {
    return (
      <article className="flex h-full flex-col rounded-card border border-dashed border-line bg-base/40 p-6">
        <div className="flex items-center justify-between gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-card border border-dashed border-line bg-surface text-ink-muted"
          >
            <Icon className="h-6 w-6" />
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-base px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            <Clock aria-hidden="true" className="h-3 w-3" />
            {status}
          </span>
        </div>
        <h3 className="mt-5 text-xl font-semibold text-ink-muted">{title}</h3>
        <p className="mt-1 text-sm font-medium text-ink-subtle">{tagline}</p>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
        <span className="mt-5 inline-flex items-center gap-1.5 self-start rounded-card border border-dashed border-line px-3.5 py-2 text-sm font-semibold text-ink-subtle">
          In development
        </span>
      </article>
    );
  }

  return (
    <Link
      href={href}
      className="group relative flex h-full flex-col rounded-card border border-line bg-surface-elevated p-6 shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-brand-purple/60 hover:shadow-xl hover:shadow-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-card bg-beacon text-black"
        >
          <Icon className="h-6 w-6" />
        </span>
        <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
          {status}
        </span>
      </div>
      <h3 className="mt-5 text-xl font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm font-medium text-brand-cyan">{tagline}</p>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
        {description}
      </p>
      <span className="mt-5 inline-flex items-center gap-1.5 self-start rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-3.5 py-2 text-sm font-semibold text-brand-cyan transition-colors group-hover:border-brand-cyan group-hover:bg-brand-cyan/20 group-hover:text-ink">
        {cta}
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}
