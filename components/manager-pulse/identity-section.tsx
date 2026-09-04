/**
 * Section 6.1: who this is.
 *
 * Handle, avatar, one large accent figure (total league-seasons found), the
 * split across dynasty, redraft and their best-ball siblings stated in words,
 * and the window the report covers.
 *
 * This section does NOT filter by lens. It is the "who is this" header a
 * reader sees before choosing a lens, and its own numbers (how many
 * league-seasons we found, at all) are what the lens later narrows.
 *
 * The dynasty/redraft split sentence folds best ball into its parent, per
 * section 6.0's lens fold (`lensForCategory`): "31 league-seasons: 19
 * dynasty, 12 redraft." The four raw buckets stay visible underneath, because
 * this is the one section the plan names as where best ball is kept
 * distinguishable rather than folded away.
 */

import { ImageWithFallback } from "@/components/image-with-fallback";
import { SectionFrame } from "./section-frame";
import { StatTile } from "./stat-tile";
import { formatCount } from "./format";
import type { ManagerIdentity } from "@/lib/manager-pulse/types";

function seasonWindowLine(
  identity: ManagerIdentity,
  window?: { seasonFrom: number; seasonTo: number },
): string {
  const seasonsWord = identity.seasonsCovered === 1 ? "season" : "seasons";
  const leaguesWord = identity.leagueSeasonsFound === 1 ? "league-season" : "league-seasons";
  const base = `${identity.seasonsCovered} ${seasonsWord}, ${identity.leagueSeasonsFound} ${leaguesWord}`;
  if (window) return `${base}, ${window.seasonFrom} to ${window.seasonTo}.`;
  if (identity.firstSeasonSeen !== null) return `${base}, since ${identity.firstSeasonSeen}.`;
  return `${base}.`;
}

function splitSentence(identity: ManagerIdentity): string | null {
  const { dynasty, redraft, bestBallDynasty, bestBallRedraft } = identity.splits;
  const dynastyTotal = dynasty + bestBallDynasty;
  const redraftTotal = redraft + bestBallRedraft;
  if (dynastyTotal + redraftTotal === 0) return null;
  const leaguesWord = identity.leagueSeasonsFound === 1 ? "league-season" : "league-seasons";
  return `${identity.leagueSeasonsFound} ${leaguesWord}: ${dynastyTotal} dynasty, ${redraftTotal} redraft.`;
}

export function IdentitySection({
  identity,
  window,
}: {
  identity: ManagerIdentity;
  /** The report's requested season window, when the caller has it. */
  window?: { seasonFrom: number; seasonTo: number };
}) {
  const hasData = identity.leagueSeasonsFound > 0;
  const split = splitSentence(identity);

  return (
    <SectionFrame id="identity" title="Manager" eyebrow="Section 1" accent="purple">
      <div className="flex items-center gap-3">
        <ImageWithFallback
          src={identity.avatarUrl}
          alt={`${identity.handle}'s avatar`}
          size={56}
        />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{identity.handle}</p>
          {identity.firstSeasonSeen !== null && (
            <p className="text-xs text-ink-muted">First seen in {identity.firstSeasonSeen}</p>
          )}
        </div>
      </div>

      <StatTile
        label="League-seasons found"
        value={hasData ? formatCount(identity.leagueSeasonsFound) : null}
        sub={seasonWindowLine(identity, window)}
        emptyReason="No leagues found in this window"
        tone="good"
      />

      {split && <p className="text-sm leading-relaxed text-ink-muted">{split}</p>}

      {hasData && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <IdentityBucket label="Dynasty" value={identity.splits.dynasty} />
          <IdentityBucket label="Redraft" value={identity.splits.redraft} />
          <IdentityBucket label="Best ball dynasty" value={identity.splits.bestBallDynasty} />
          <IdentityBucket label="Best ball redraft" value={identity.splits.bestBallRedraft} />
        </dl>
      )}
    </SectionFrame>
  );
}

function IdentityBucket({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-line bg-base/40 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-ink">
        {formatCount(value)}
      </dd>
    </div>
  );
}
