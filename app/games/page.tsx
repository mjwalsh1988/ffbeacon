import type { Metadata } from "next";
import Link from "next/link";
import { Radar, Sparkles, ArrowRight, type LucideIcon } from "lucide-react";
import { HeroLavaField } from "@/components/hero-lava-field";

export const metadata: Metadata = {
  alternates: { canonical: "/games" },
  title: "Fantasy Football Games",
  description:
    "Free, accessible fantasy football games built on real player data. Play Signal Scout, our hidden-player guessing game, with more games on the way.",
};

type Game = {
  href: string;
  title: string;
  tagline: string;
  description: string;
  cta: string;
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
];

export default function GamesPage() {
  return (
    <main id="main">
      <Hero />
      <section
        aria-labelledby="games-heading"
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8"
      >
        <h2 id="games-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Choose a game to play.
        </h2>
        <ul className="mt-10 grid gap-5 md:grid-cols-2" role="list">
          {GAMES.map((game) => (
            <li key={game.href}>
              <GameCard game={game} />
            </li>
          ))}
          <li>
            <ComingSoonCard />
          </li>
        </ul>
      </section>
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative -mt-[4.5rem] overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <HeroLavaField copy="left" />
      <div className="relative mt-[4.5rem] mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-24 lg:px-8">
        {/* aria-label collapses the gradient-split headline into one
            accessible name for screen-reader navigation, matching the
            pattern on the homepage and tools hero. */}
        <h1
          aria-label="Play the data you already trust."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
          Play the data{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            you already trust
          </span>
          .
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Free games built on the same real player data that powers our rankings and
          tools. Every round works the same by eye or by ear, no paywall, ever.
        </p>
      </div>
    </header>
  );
}

/* ---------- Game cards ---------- */

function GameCard({ game }: { game: Game }) {
  const { href, title, tagline, description, cta, icon: Icon, status } = game;
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
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{description}</p>
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

/** Non-interactive placeholder for future games. Not a link, no CTA, no fake
 *  button, so it never registers as a focusable control for keyboard or
 *  screen-reader users. The dashed border keeps it visually distinct from
 *  the real game cards, matching the homepage articles empty-state card. */
function ComingSoonCard() {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-card border border-dashed border-line bg-base/40 p-6 text-center">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface text-ink-subtle"
      >
        <Sparkles className="h-6 w-6" />
      </span>
      <p className="mt-4 text-sm font-semibold text-ink-muted">More games are in the works.</p>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-ink-subtle">
        We are building out the Games hub one round at a time. Check back for what is next.
      </p>
    </div>
  );
}
