"use client";

import { useState } from "react";
import {
  BarChart3,
  ChevronRight,
  Handshake,
  Radar,
  TrendingUp,
  Zap,
} from "lucide-react";
import { PlayerExposurePanel } from "@/components/player-exposure-panel";
import { LeagueProjectionsPanel } from "@/components/league-projections-panel";
import { FreeAgentFinderPanel } from "@/components/free-agent-finder-panel";
import { TradeFinderPanel } from "@/components/trade-finder-panel";
import type { PlayerExposure } from "@/lib/player-exposure";
import type { ProjectionInput } from "@/lib/league-projections";

/**
 * The cross-league views, on a page that is otherwise per-league.
 *
 * Everything else on My Sleeper Leagues answers a question about one room. These
 * answer questions you can only ask with every room in front of you: how much of
 * my season is riding on one player, where am I actually going to finish, and
 * which of these leagues can I still go and get this guy in. They are not
 * columns on the table because they are not facts about a league; they open over
 * it.
 *
 * WHY IT LOOKS DIFFERENT FROM EVERY OTHER PANEL HERE
 *   The Sync all bar and the filter bar are both plain surface cards. If this
 *   were a third one, three unrelated controls would read as one settings strip.
 *   It borrows the cockpit treatment from the League Pulse masthead instead
 *   (components/league-shell/), a card with a beacon hairline and a corner
 *   glow, which is the visual
 *   language this site already uses for "this is a place you go", not "this is a
 *   toggle you flip".
 *
 * NO PANEL HERE SYNCS ANYTHING. All three read what is already stored. A league
 * synced later joins these numbers on the next page load with nothing to
 * invalidate.
 */
export function LeagueQuickLinks({
  exposure,
  projections,
  sleeperUsername,
  sleeperLeagueIds,
  sleeperUserId,
  sourceSlug,
}: {
  exposure: PlayerExposure;
  projections: ProjectionInput[];
  sleeperUsername: string | null;
  /** Every league Sleeper reports for this reader, synced or not. */
  sleeperLeagueIds: string[];
  /** The reader's own Sleeper id, so their own roster reads as theirs. */
  sleeperUserId: string | null;
  /** The reader's value source, so Trade Ideas prices deals the same way. */
  sourceSlug: string | null;
}) {
  const [panel, setPanel] = useState<
    "exposure" | "projections" | "free-agents" | "trades" | null
  >(null);

  const rankedCount = projections.filter(
    (p) => p.projectedSeed !== null && p.rankedTeamCount !== null,
  ).length;

  return (
    <section aria-labelledby="quick-links-heading" className="mb-6">
      <div
        className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/70 p-4 shadow-[0_0_70px_-50px_rgba(168,85,247,0.7)] sm:p-5"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
        }}
      >
        {/* Top-edge beacon hairline, decorative, matching the cockpit panels. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />

        <div className="flex items-center gap-2">
          <Zap aria-hidden="true" className="h-3.5 w-3.5 text-brand-purple" />
          <h2
            id="quick-links-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan"
          >
            Quick links
          </h2>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Views across every league you have synced, rather than one at a time.
          None of these starts a sync.
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLinkButton
            icon={<BarChart3 aria-hidden="true" className="h-4 w-4" />}
            title="Player exposure"
            detail={
              exposure.totalLeagues > 0
                ? `${exposure.rows.length} ${exposure.rows.length === 1 ? "player" : "players"} across ${exposure.totalLeagues} synced ${exposure.totalLeagues === 1 ? "league" : "leagues"}`
                : "Nothing synced yet"
            }
            // Leads with the visible title and carries the visible word "Open",
            // which is WCAG 2.5.3: a spoken name that does not contain the
            // written label cannot be operated by voice.
            ariaLabel={`Player exposure. Open ${
              exposure.totalLeagues > 0
                ? `a table of ${exposure.rows.length} players across ${exposure.totalLeagues} synced leagues, ordered by the share of leagues you own each player in.`
                : "the exposure table. No leagues are synced yet, so there is nothing to count."
            }`}
            onClick={() => setPanel("exposure")}
          />
          <QuickLinkButton
            icon={<TrendingUp aria-hidden="true" className="h-4 w-4" />}
            title="Projected finishes"
            detail={
              rankedCount > 0
                ? `${rankedCount} ranked ${rankedCount === 1 ? "league" : "leagues"}, best first`
                : "Nothing ranked yet"
            }
            ariaLabel={`Projected finishes. Open ${
              rankedCount > 0
                ? `a list of ${rankedCount} ranked leagues, ordered from your best projected finish to your worst.`
                : "the projections list. No leagues have a projection yet."
            }`}
            onClick={() => setPanel("projections")}
          />
          <QuickLinkButton
            icon={<Radar aria-hidden="true" className="h-4 w-4" />}
            title="Free Agent Finder"
            detail={
              exposure.totalLeagues > 0
                ? `Check one player against ${exposure.totalLeagues} synced ${exposure.totalLeagues === 1 ? "league" : "leagues"}`
                : "Nothing synced yet"
            }
            ariaLabel={`Free Agent Finder. Open ${
              exposure.totalLeagues > 0
                ? `a search for one player, to see which of your ${exposure.totalLeagues} synced leagues he is a free agent in.`
                : "the free agent search. No leagues are synced yet, so there is nothing to search."
            }`}
            onClick={() => setPanel("free-agents")}
          />
          <QuickLinkButton
            icon={<Handshake aria-hidden="true" className="h-4 w-4" />}
            title="Trade Ideas"
            detail={
              exposure.totalLeagues > 0
                ? `One trade at a time across ${exposure.totalLeagues} synced ${exposure.totalLeagues === 1 ? "league" : "leagues"}`
                : "Nothing synced yet"
            }
            ariaLabel={`Trade Ideas. Open ${
              exposure.totalLeagues > 0
                ? `one suggested trade at a time, drawn from your ${exposure.totalLeagues} synced leagues, with what each one does to your starting lineup.`
                : "the trade search. No leagues are synced yet, so there is nothing to search."
            }`}
            onClick={() => setPanel("trades")}
          />
        </div>
      </div>

      <PlayerExposurePanel
        open={panel === "exposure"}
        onClose={() => setPanel(null)}
        exposure={exposure}
        sleeperUsername={sleeperUsername}
      />
      <LeagueProjectionsPanel
        open={panel === "projections"}
        onClose={() => setPanel(null)}
        inputs={projections}
        sleeperUsername={sleeperUsername}
      />
      {/* The synced count comes from the exposure read the page already did:
          a league we found this reader's roster in is, by definition, one we
          hold rosters for. One fewer query for the same fact. */}
      <FreeAgentFinderPanel
        open={panel === "free-agents"}
        onClose={() => setPanel(null)}
        sleeperLeagueIds={sleeperLeagueIds}
        sleeperUserId={sleeperUserId}
        syncedLeagueCount={exposure.totalLeagues}
        sleeperUsername={sleeperUsername}
      />
      {/* Same synced count, same reasoning: a league we found this reader's
          roster in is one we hold rosters for, so no extra query. */}
      <TradeFinderPanel
        open={panel === "trades"}
        onClose={() => setPanel(null)}
        sleeperLeagueIds={sleeperLeagueIds}
        sleeperUserId={sleeperUserId}
        sleeperUsername={sleeperUsername}
        syncedLeagueCount={exposure.totalLeagues}
        sourceSlug={sourceSlug}
      />
    </section>
  );
}

/**
 * One quick link, built to read as pressable before it is read at all.
 *
 * The first pass was an outlined card, which on this page put it in the same
 * visual bracket as the filter panel and the Sync all bar: things that sit
 * there, not things you press. Four changes fix that, and none of them is
 * colour alone.
 *
 *   The icon well carries the beacon gradient on black, which is the treatment
 *   this site already uses for its primary action (Sync, Sync all, Open league).
 *   That is the strongest "press me" signal in the system and it costs one
 *   40px circle rather than a full gradient slab, which two side by side would
 *   have turned into a wall.
 *
 *   A visible verb. "Open" in a chip on the right, because an affordance a
 *   reader has to infer from a chevron is one they can miss.
 *
 *   Motion on hover and on press. It lifts half a step and settles back when
 *   pressed, so a pointer gets the feedback a card never gave it. Skipped under
 *   prefers-reduced-motion, where the border and glow still change.
 *
 *   A resting glow, so it is distinguishable from a flat panel before anything
 *   is hovered at all. Hover deepens it rather than introducing it.
 */
function QuickLinkButton({
  icon,
  title,
  detail,
  ariaLabel,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      className="group flex min-h-16 items-center gap-3 rounded-card border border-brand-cyan/30 bg-surface-elevated px-4 py-3.5 text-left shadow-[0_0_24px_-14px_rgba(34,211,238,0.85)] transition-all hover:-translate-y-0.5 hover:border-brand-cyan/70 hover:bg-surface-elevated hover:shadow-[0_0_30px_-10px_rgba(34,211,238,0.95)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan active:translate-y-0 active:shadow-[0_0_18px_-14px_rgba(34,211,238,0.85)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-beacon text-black shadow-[0_0_20px_-6px_rgba(168,85,247,0.9)]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold tracking-tight text-ink">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
          {detail}
        </span>
      </span>
      {/* aria-hidden: the accessible name below already carries the word "Open",
          so exposing this chip as well would say it twice. */}
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 py-1 pl-2.5 pr-1.5 text-[11px] font-bold text-brand-cyan transition-colors group-hover:border-brand-cyan group-hover:bg-brand-cyan/20"
      >
        Open
        <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
