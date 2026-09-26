"use client";

import Link from "next/link";
import { ArrowRight, Layers, Plus, Share2 } from "lucide-react";
import { Panel, StatReadout } from "@/components/dashboard-panel";
import { DisagreeFigure } from "@/components/ranking-boards/disagree-figure";
import {
  agreementShare,
  biggestDisagreements,
  readerRanksFor,
  ordinal,
  rankGap,
  type RankComparison,
} from "@/lib/ranking-boards/compare";
import type { CardPlayer } from "@/lib/ranking-boards/card-text";
import { LOGIN_HREF } from "./guest-cap-dialog";

const cta =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50";

/**
 * The finished run (plan section 13.6): what was built, how it compares with
 * FF Beacon, and what to do next. Keep going, Draw tiers, Share, and, once
 * the format's community board is published, "See how everyone else ranks
 * them". A guest sees the sign-up invitation in the Share slot, because a
 * guest cannot share (decision 13).
 */
export function FinishedSummary({
  board,
  cards,
  answered,
  tierCount,
  comparison,
  agreementWindow,
  isGuest,
  capReached,
  canKeepGoing,
  keepGoingStep,
  tiersAllowed,
  boardHref,
  communityHref,
  onKeepGoing,
  onDrawTiers,
  onDone,
  finishing,
  finished,
}: {
  board: string[];
  cards: Record<string, CardPlayer>;
  answered: number;
  tierCount: number;
  comparison: RankComparison | null;
  agreementWindow: number;
  isGuest: boolean;
  capReached: boolean;
  canKeepGoing: boolean;
  keepGoingStep: number;
  tiersAllowed: boolean;
  boardHref: string | null;
  communityHref: string | null;
  onKeepGoing: () => void;
  onDrawTiers: () => void;
  onDone: () => void;
  finishing: boolean;
  finished: boolean;
}) {
  const players = board.map((id) => ({
    playerId: id,
    name: cards[id]?.name ?? "Unknown player",
    position: cards[id]?.position ?? "",
  }));
  const readerRanks = comparison ? readerRanksFor(players, comparison) : null;
  const gaps = comparison ? players.map((p) => rankGap(comparison, p, readerRanks?.get(p.playerId))) : [];
  const agreement = agreementShare(gaps, agreementWindow);
  const disagreements = comparison ? biggestDisagreements(players, comparison) : null;

  return (
    <Panel eyebrow="Finished" title={finished ? "Your board is saved" : "Your board is built"} glow>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatReadout label="Players ranked" value={String(board.length)} accent="cyan" />
        <StatReadout label="Questions answered" value={String(answered)} accent="purple" />
        <StatReadout label="Tiers" value={String(tierCount)} accent="ink" />
        <StatReadout
          label={`Within ${agreementWindow} of FF Beacon`}
          value={agreement ? `${Math.round(agreement.share * 100)}%` : "None to compare"}
          accent="cyan"
        />
      </dl>

      {disagreements && (disagreements.higher.length > 0 || disagreements.lower.length > 0) && (
        <div className="mt-4">
          <DisagreeFigure
            higher={disagreements.higher}
            lower={disagreements.lower}
            subject="FF Beacon"
            owner="You"
            titleLevel={3}
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {canKeepGoing && !finished && (
          <button type="button" onClick={onKeepGoing} className={cta}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Keep going: next {keepGoingStep}
          </button>
        )}
        {tiersAllowed && !finished && board.length > 1 && (
          <button type="button" onClick={onDrawTiers} className={cta}>
            <Layers aria-hidden="true" className="h-4 w-4" />
            Draw tiers
          </button>
        )}
        {isGuest ? (
          <a href={LOGIN_HREF} className={cta}>
            <Share2 aria-hidden="true" className="h-4 w-4" />
            Sign up to keep this board
          </a>
        ) : finished && boardHref ? (
          <Link href={boardHref} className={cta}>
            <Share2 aria-hidden="true" className="h-4 w-4" />
            Open, share or feature your board
          </Link>
        ) : (
          <button type="button" onClick={onDone} disabled={finishing} className={cta}>
            <Share2 aria-hidden="true" className="h-4 w-4" />
            {finishing ? "Saving..." : "Save and share"}
          </button>
        )}
        {communityHref && (
          <Link href={communityHref} className={cta}>
            See how everyone else ranks them
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        )}
      </div>
      {isGuest && capReached && (
        <p className="mt-3 text-sm text-ink-muted">
          That is the guest limit. Your board so far comes with you when you sign up or log in.
        </p>
      )}
    </Panel>
  );
}

/**
 * The optional tier pass (plan section 7): one question per gap, top down,
 * "is there a real drop-off here?", and Yes draws a line. The reader can end
 * the pass whenever they like.
 */
export function TierPass({
  upperName,
  lowerName,
  gap,
  onAnswer,
  onEnd,
  lines,
}: {
  upperName: string;
  lowerName: string;
  gap: number;
  onAnswer: (yes: boolean) => void;
  onEnd: () => void;
  lines: number;
}) {
  return (
    <Panel eyebrow="Tier pass" title="Draw your tiers" glow>
      <p className="text-base text-ink">
        Is there a real drop-off between {upperName} ({ordinal(gap)}) and {lowerName} (
        {ordinal(gap + 1)})?
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {lines === 0 ? "No lines yet." : `${lines} line${lines === 1 ? "" : "s"} so far.`} Yes draws
        a line between them.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Yes, draw a line
        </button>
        <button type="button" onClick={() => onAnswer(false)} className={cta}>
          No
        </button>
        <button type="button" onClick={onEnd} className={cta}>
          End the tier pass
        </button>
      </div>
    </Panel>
  );
}
