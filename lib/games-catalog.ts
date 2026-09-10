/**
 * The long-form description of every game, in one place.
 *
 * The same split as lib/tools-catalog.ts and for the same reason. GAMES_NAV in
 * lib/site.ts holds the label, the route and the TAGLINE, which is what a menu
 * row has space for. "Decode the profile. Find the player." works next to a
 * name a reader can already see; handed to a language model on its own it says
 * nothing about what the game is. This holds the sentence that does.
 *
 * Read by app/games/page.tsx, app/llms.txt/route.ts and
 * app/llms-full.txt/route.ts. The homepage keeps its own shorter copy in
 * FEATURED_GAMES, so this is the source of truth for the games page and the two
 * machine-readable documents rather than for every surface on the site.
 *
 * Presentation-free: the icon and the status badge stay with the page.
 */

export type GameHref = "/games/signal-scout" | "/games/would-you-rather";

export type GameCatalogEntry = {
  /**
   * Absent while a game is still being built. The games page renders a
   * non-interactive placeholder card for one of these, and the machine-readable
   * documents skip it entirely: neither file may advertise a URL that 404s.
   */
  href?: GameHref;
  title: string;
  /** The short line under the name. Same voice as GAMES_NAV's description. */
  tagline: string;
  /** One or two sentences: what the game actually asks you to do. */
  description: string;
  /** The action, as a button would say it. */
  cta: string;
};

/** A game that has a page. */
export type PlayableGame = GameCatalogEntry & { href: GameHref };

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    href: "/games/signal-scout",
    title: "Signal Scout",
    tagline: "Decode the profile. Find the player.",
    description:
      "A mystery player. A handful of clues. Decode the scouting profile and name the player before the signal burns out.",
    cta: "Start scouting",
  },
  {
    href: "/games/would-you-rather",
    title: "Would You Rather?",
    tagline: "Two sides. One vote.",
    description:
      "A real trade out of a real league, with the managers' names taken off. Call the winner, then see how the room voted and what the full grade says.",
    cta: "Call a trade",
  },
];

/** Only the games that have a page, for anything that publishes a link. */
export function playableGames(): PlayableGame[] {
  return GAME_CATALOG.filter((game): game is PlayableGame => Boolean(game.href));
}
