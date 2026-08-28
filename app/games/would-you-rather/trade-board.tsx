"use client";

/**
 * The board: the trade itself, and the two buttons that call it.
 *
 * NOTHING ON THIS COMPONENT KNOWS THE ANSWER. It is handed a `WyrRound`, which
 * carries names, positions, pick seats and the league's format, and carries no
 * value, no total, no margin and no verdict. The two sides are drawn
 * identically on purpose: no highlight, no ordering by worth, no colour that
 * favours one over the other, because any of those would be a hint.
 *
 * ONE BUTTON PER SIDE, SITTING UNDER THAT SIDE. On a phone the sides stack, so
 * each button is directly beneath the thing it is about; on a wide screen the
 * pair lands side by side without a second set of controls. A duplicated pair
 * at the bottom would read the same on screen and double the tab stops.
 *
 * After the vote the buttons become static labels rather than disappearing, so
 * the trade stays on screen next to the verdict and a reader can see which call
 * they made while they read what it was worth.
 */

import { Check, Layers, Loader2, Scale } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { formatEasternShortDate } from "@/lib/datetime";
import type { FormatTag } from "@/lib/league-format-tags";
import type { WyrAsset, WyrRound, WyrSide } from "@/lib/would-you-rather/types";

const ORDINALS: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

const SIDE_LABEL: Record<WyrSide, string> = { a: "Team A", b: "Team B" };

export function TradeBoard({
  round,
  votedSide,
  pending,
  onVote,
  headingId,
}: {
  round: WyrRound;
  /** Set once the vote is in. Turns the buttons into labels. */
  votedSide: WyrSide | null;
  /** The side currently being submitted, so only that button shows a spinner. */
  pending: WyrSide | null;
  onVote: (side: WyrSide) => void;
  headingId: string;
}) {
  const locked = votedSide !== null;

  return (
    <div className="space-y-4">
      <LeagueStrip round={round} />

      <div className="grid gap-4 lg:grid-cols-2">
        {(["a", "b"] as WyrSide[]).map((side) => (
          <SideCard
            key={side}
            side={side}
            assets={round.sides[side]}
            tradeId={round.tradeId}
            votedSide={votedSide}
            pending={pending === side}
            disabled={locked || pending !== null}
            onVote={() => onVote(side)}
            headingId={headingId}
          />
        ))}
      </div>

      {!locked && (
        <p className="text-center text-xs leading-relaxed text-ink-subtle">
          No values, no grade, no hints. Make the call, then see what the numbers
          and everyone else say.
        </p>
      )}
    </div>
  );
}

/* ---------- League identity ---------- */

/**
 * Where the trade came from.
 *
 * The league is named and its rules are shown, because a trade cannot be judged
 * without them: the same two players are a different deal in a superflex TE
 * premium league than in a standard one. The managers are not named, here or
 * anywhere else.
 */
function LeagueStrip({ round }: { round: WyrRound }) {
  const when = round.tradedAt ? formatEasternShortDate(round.tradedAt) : null;
  const timing =
    round.week === null || round.week === 0
      ? round.week === 0
        ? "Preseason"
        : null
      : `Week ${round.week}`;

  return (
    <div className="rounded-card border border-line bg-base/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <Scale aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
          <span className="truncate">{round.leagueName}</span>
        </p>
        <p className="text-xs text-ink-subtle">
          {[round.season ? `${round.season} season` : null, timing, when]
            .filter(Boolean)
            .join(", ")}
        </p>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{round.derivedLabel}</p>

      {round.kind === "startup" && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-2 py-0.5 text-xs font-medium text-brand-cyan">
            <Layers aria-hidden="true" className="h-3 w-3" />
            {round.startupSeason} startup draft trade
          </span>
          {round.startupTimingLabel && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
              {round.startupTimingLabel}
            </span>
          )}
        </p>
      )}

      {round.kind === "startup" && (
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
          Startup draft picks moved here, so each one is shown as the player taken
          at that seat.
        </p>
      )}

      <TagRow
        label="Roster"
        tags={round.formatTags}
        // The two tag rows are the league's rules, and they are the same chips
        // the League Pulse header uses, so a reader who knows that page reads
        // this one without learning anything new.
        emptyNote="Roster shape not recorded."
      />
      <TagRow label="Scoring" tags={round.scoringTags} emptyNote="Scoring not recorded." />
    </div>
  );
}

function TagRow({
  label,
  tags,
  emptyNote,
}: {
  label: string;
  tags: FormatTag[];
  emptyNote: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      {tags.length === 0 ? (
        <span className="text-xs text-ink-subtle">{emptyNote}</span>
      ) : (
        tags.map((tag) => (
          <span
            key={tag.key}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              tag.tone === "format"
                ? "border-brand-cyan/35 bg-brand-cyan/[0.07] text-brand-cyan"
                : "border-brand-purple/35 bg-brand-purple/[0.07] text-brand-purple"
            }`}
          >
            {tag.label}
          </span>
        ))
      )}
    </div>
  );
}

/* ---------- One side ---------- */

function SideCard({
  side,
  assets,
  tradeId,
  votedSide,
  pending,
  disabled,
  onVote,
  headingId,
}: {
  side: WyrSide;
  assets: WyrAsset[];
  tradeId: string;
  votedSide: WyrSide | null;
  pending: boolean;
  disabled: boolean;
  onVote: () => void;
  headingId: string;
}) {
  const label = SIDE_LABEL[side];
  const sideHeadingId = `wyr-${tradeId}-side-${side}`;
  const isPick = votedSide === side;
  const locked = votedSide !== null;

  return (
    <section
      aria-labelledby={sideHeadingId}
      className={`flex flex-col rounded-card border bg-surface/40 transition-colors ${
        isPick ? "border-brand-cyan/60 bg-brand-cyan/[0.05]" : "border-line"
      }`}
    >
      <h3
        id={sideHeadingId}
        className="border-b border-line/70 px-4 py-2.5 text-sm font-semibold text-ink"
      >
        {label} receives
      </h3>

      <ul role="list" className="flex-1 space-y-2.5 px-4 py-3.5">
        {assets.length === 0 && (
          <li className="text-sm italic text-ink-subtle">Nothing of value.</li>
        )}
        {assets.map((asset) => (
          <AssetRow key={asset.key} asset={asset} />
        ))}
      </ul>

      <div className="px-4 pb-4">
        {locked ? (
          <p
            className={`flex min-h-14 items-center justify-center gap-2 rounded-card border px-4 text-sm font-semibold ${
              isPick
                ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                : "border-line bg-base/50 text-ink-subtle"
            }`}
          >
            {isPick && <Check aria-hidden="true" className="h-4 w-4" />}
            {isPick ? `You picked ${label}` : `You did not pick ${label}`}
          </p>
        ) : (
          <button
            type="button"
            onClick={onVote}
            disabled={disabled}
            // Named for what pressing it does, not for what it is. "Team A"
            // alone would leave a reader tabbing between two buttons whose
            // names do not say they are a vote.
            //
            // THE PENDING STATE IS IN THE NAME, not only in the text. An
            // aria-label overrides content, so a fixed label would have left
            // "Recording your vote" visible to sighted readers and inaudible to
            // everybody else, on the one control of the whole game.
            aria-label={
              pending
                ? `Recording your vote for ${label}`
                : `Vote: ${label} wins this trade`
            }
            aria-busy={pending || undefined}
            aria-describedby={headingId}
            // border-brand-purple/80 rather than /50: at /50 the edge measured
            // about 2.2:1 against the panel behind it, under the 3:1 WCAG asks
            // of the boundary of a control. The FILL stays light on purpose,
            // because a heavier one on either side would be a hint.
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-card border border-brand-purple/80 bg-brand-purple/10 px-4 text-base font-semibold text-ink transition-colors hover:border-brand-cyan hover:bg-brand-cyan/15 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                Recording your vote
              </>
            ) : (
              <>{label} wins</>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

function AssetRow({ asset }: { asset: WyrAsset }) {
  // A startup pick became a player, and both facts matter: what moved, and what
  // it turned into. Written out rather than abbreviated, because a reader
  // comparing this against their own memory of the deal is looking for the seat.
  const via = asset.startupPick
    ? [
        `via ${asset.startupPick.label}`,
        asset.startupPick.simulated ? "projected pick, not yet made" : "player taken there",
      ].join(", ")
    : null;
  const detail = [via, asset.detail].filter(Boolean).join(", ");

  return (
    <li className="flex items-center gap-3">
      <AssetGlyph asset={asset} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-ink">{asset.name}</span>
        {detail && (
          <span className="block text-xs leading-snug text-ink-subtle">{detail}</span>
        )}
      </span>
    </li>
  );
}

function AssetGlyph({ asset }: { asset: WyrAsset }) {
  if (asset.kind === "player") {
    return (
      <span aria-hidden="true" className="inline-flex shrink-0">
        <PlayerHeadshot sleeperId={asset.sleeperId} name="" size={40} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-brand-purple/40 bg-brand-purple/10 text-brand-cyan"
    >
      <span className="text-[11px] font-semibold leading-none tracking-tight">
        {asset.round ? (ORDINALS[asset.round] ?? `R${asset.round}`) : "PICK"}
      </span>
    </span>
  );
}

export { SIDE_LABEL };
