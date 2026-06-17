import Link from "next/link";
import {
  ArrowRight,
  ExternalLink,
  ListOrdered,
  Shield,
  Star,
  Trophy,
} from "lucide-react";
import {
  loadBoardTopN,
  type FeaturedBoardMeta,
  type FeaturedLeagueCard,
  type SignalProfileLink,
  type ProfileFavorites,
} from "@/lib/signal-profile";
import { scopeLabel } from "@/lib/ranking-boards";
import { accentFillStyle, accentInkColor } from "@/lib/signal/accents";

/**
 * Shared building blocks for the public Signal profile. Each block is a
 * self-contained <section> with its own heading, so a profile is composed of
 * stacked blocks regardless of layout. A block whose underlying reference no
 * longer resolves (an empty featured board, a league not yet synced) renders
 * nothing, so the page degrades gracefully without holes.
 *
 * SignalBlock no longer sets its own width or horizontal padding: the page owns
 * the column container (single column for Layout A, the main/sidebar columns for
 * Layout B), so a block always fills whichever column it lands in. Blocks are
 * rendered one-per-entity (one FeaturedBoardBlock per board, etc.) and placed in
 * the owner's chosen layout_config order; see lib/signal/blocks.ts.
 */

export function SignalBlock({
  id,
  title,
  eyebrow,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="py-8">
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          {eyebrow}
        </p>
      )}
      <h2
        id={headingId}
        className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl"
      >
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ---------------- About (renders the bio) ---------------- */

export function AboutBlock({ bio }: { bio: string }) {
  return (
    <SignalBlock id="signal-about" title="About">
      <p className="whitespace-pre-line text-base leading-relaxed text-ink">
        {bio}
      </p>
    </SignalBlock>
  );
}

/* ---------------- Free text ---------------- */

/**
 * Owner-authored prose with no heading: just a styled paragraph in the flow, so
 * it does not add a landmark or a heading-hierarchy entry. Rendered as plain text
 * (React escapes it; no linkify, no dangerouslySetInnerHTML).
 */
export function TextBlock({ text }: { text: string }) {
  return (
    <div className="py-6">
      <p className="whitespace-pre-line text-base leading-relaxed text-ink">
        {text}
      </p>
    </div>
  );
}

/* ---------------- Featured board (one per block) ---------------- */

export async function FeaturedBoardBlock({
  handle,
  board,
}: {
  handle: string;
  board: FeaturedBoardMeta;
}) {
  // Each board's Top-N is independently cached and tagged board:{id}.
  const players = await loadBoardTopN(board.id, board.updatedAt, board.topN);
  // A featured board with no players is a stale reference; degrade to nothing.
  if (players.length === 0) return null;

  return (
    <SignalBlock
      id={`signal-board-${board.id}`}
      eyebrow="Ranking board"
      title={board.name}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-cyan">
          <ListOrdered aria-hidden="true" className="h-3.5 w-3.5 text-brand-purple" />
          {scopeLabel(board.scope)}
        </span>
        {board.playerCount > players.length && (
          <span className="text-xs text-ink-muted">
            Top {players.length} of {board.playerCount}
          </span>
        )}
      </div>

      <ol role="list" className="mt-4 flex flex-col gap-1.5">
        {players.map((p) => (
          <li
            key={p.playerId}
            className="flex items-center gap-3 rounded-card border border-line/60 bg-base/50 px-3 py-2"
          >
            <span className="w-6 shrink-0 text-center font-mono text-sm tabular-nums text-ink-muted">
              {p.rank}
            </span>
            <Link
              href={`/players/${p.slug}`}
              className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {p.name}
            </Link>
            <span className="shrink-0 text-xs text-ink-muted">
              {p.position}
              {p.team ? `, ${p.team}` : ""}
            </span>
          </li>
        ))}
      </ol>

      {board.playerCount > players.length && (
        <Link
          href={`/${handle}/rankings/${board.id}`}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          aria-label={`View the full ${board.name} board`}
        >
          View full board
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      )}
    </SignalBlock>
  );
}

/* ---------------- Featured league (one per block) ---------------- */

export function FeaturedLeagueBlock({
  league,
}: {
  league: FeaturedLeagueCard;
}) {
  return (
    <SignalBlock
      id={`signal-league-${league.sleeperLeagueId}`}
      eyebrow="League Pulse"
      title={league.name}
    >
      <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
          >
            <Trophy className="h-5 w-5" />
          </span>
          <p className="mt-0.5 text-sm text-ink-muted">
            {league.season} season
            {league.totalRosters ? `, ${league.totalRosters} teams` : ""}
          </p>
        </div>
        <dl className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {league.formatDisplay && (
            <div className="flex gap-1.5">
              <dt className="text-ink-muted">Format:</dt>
              <dd className="text-ink">{league.formatDisplay}</dd>
            </div>
          )}
          {league.leaderTeam && (
            <div className="flex gap-1.5">
              <dt className="text-ink-muted">Top team:</dt>
              <dd className="truncate text-ink">{league.leaderTeam}</dd>
            </div>
          )}
        </dl>
        <Link
          href={`/leagues/${league.sleeperLeagueId}`}
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          aria-label={`Open the ${league.name} league`}
        >
          Open league
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SignalBlock>
  );
}

/* ---------------- Links ---------------- */

export function LinksBlock({
  links,
  accent,
}: {
  links: SignalProfileLink[];
  accent: string;
}) {
  if (links.length === 0) return null;
  const inkColor = accentInkColor(accent);

  return (
    <SignalBlock id="signal-links" eyebrow="Around the web" title="Links">
      <ul role="list" className="flex flex-col gap-2">
        {links.map((link, index) => (
          <li key={`${index}-${link.url}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span className="min-w-0 truncate">{link.label}</span>
              <ExternalLink
                aria-hidden="true"
                style={{ color: inkColor }}
                className="h-4 w-4 shrink-0"
              />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </SignalBlock>
  );
}

/* ---------------- Favorites ---------------- */

export function FavoritesBlock({
  favorites,
  accent,
}: {
  favorites: ProfileFavorites;
  accent: string;
}) {
  const { team, player } = favorites;
  if (!team && !player) return null;

  // Accent-as-fill chips: background is the accent, text is ALWAYS the locked
  // near-black textOnFill (enforced by accentFillStyle).
  const fill = accentFillStyle(accent);

  return (
    <SignalBlock id="signal-favorites" eyebrow="Fandom" title="Favorites">
      <dl className="flex flex-wrap gap-x-10 gap-y-5">
        {team && (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Favorite team
            </dt>
            <dd className="mt-1.5">
              <span
                style={fill}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold"
              >
                <Shield aria-hidden="true" className="h-4 w-4" />
                {team.name}
              </span>
            </dd>
          </div>
        )}

        {player && (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Favorite player
            </dt>
            <dd className="mt-1.5">
              <Link
                href={`/players/${player.slug}`}
                className="inline-flex rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                aria-label={`${player.name}, ${player.position}${player.team ? `, ${player.team}` : ""}`}
              >
                <span
                  style={fill}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold"
                >
                  <Star aria-hidden="true" className="h-4 w-4" />
                  {player.name}
                </span>
              </Link>
              <p className="mt-1 text-xs text-ink-muted">
                {player.position}
                {player.team ? `, ${player.team}` : ""}
              </p>
            </dd>
          </div>
        )}
      </dl>
    </SignalBlock>
  );
}
