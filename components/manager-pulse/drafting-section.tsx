/**
 * Section 6.3: draft habits.
 *
 * Reach index, positional shape of the first rounds, rookie-versus-veteran
 * lean (dynasty only), keeper usage, average draft grade, then the draft
 * clock block.
 *
 * THE DRAFT CLOCK BLOCK NEEDS CARE. `draftPace` is a fact about the ROOM, not
 * the manager: it is rendered apart from the rest of the card, in wording
 * that says "their drafts run at", never a personal stat and never ranked.
 * `DraftPaceFact` carries `clockShareUsed` (a fraction of the allowed clock
 * the room used), not the raw pick-timer seconds, so the sentence states the
 * share rather than inventing a clock length the data does not carry.
 * `perPickClock` is the real per-manager measurement and both its sample size
 * and its error bar are stated inline, never just the number. A null
 * `perPickClock` says plainly that per-pick timing starts from the first live
 * draft we watch, with no chart and no guess. A null `autopick` means we
 * never watched a live draft with this manager in it, so it is worded as
 * unknown, never as "never used autopick".
 */

import { ChartFigure, DataTable, Th, Td } from "@/components/chart-kit";
import { TRADE_POSITIONS, type TradePosition } from "@/lib/trade-finder/types";
import { SectionFrame } from "./section-frame";
import { StatTile } from "./stat-tile";
import {
  formatPercent,
  formatSample,
  formatSigned,
  formatRate,
  formatDuration,
} from "./format";
import { underLens, lensLabel } from "@/components/manager-shell/lens";
import type { ManagerDrafting, LeagueLens } from "@/lib/manager-pulse/types";

const POSITION_BAR_COLOR: Record<TradePosition, string> = {
  QB: "bg-position-qb",
  RB: "bg-position-rb",
  WR: "bg-position-wr",
  TE: "bg-position-te",
  K: "bg-position-k",
  DEF: "bg-position-def",
};

export function DraftingSection({
  drafting,
  lens,
}: {
  drafting: ManagerDrafting;
  lens: LeagueLens;
}) {
  const reachIndex = underLens(drafting.reachIndexRounds, lens);
  const reachSample = underLens(drafting.reachIndexSampleSize, lens);
  const shape = underLens(drafting.firstRoundsShape, lens);
  const shapeSample = underLens(drafting.firstRoundsSampleSize, lens);
  const avgGrade = underLens(drafting.avgDraftGrade, lens);
  const avgGradeSample = underLens(drafting.avgDraftGradeSampleSize, lens);

  return (
    <SectionFrame id="drafting" title="Draft habits" accent="purple">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* The section's one hero figure: how far off market they pick. */}
        <StatTile
          label="Reach index"
          value={reachIndex === null ? null : formatSigned(reachIndex, "rounds")}
          size="hero"
          sub="Positive means they pick earlier than the market."
          sampleSize={formatSample(reachSample, "draft") || undefined}
          emptyReason="Not enough drafts with market ADP"
        />
        <StatTile
          label="Average draft grade"
          value={avgGrade === null ? null : formatRate(avgGrade)}
          sub="From On The Clock's draft grading, averaged across drafts."
          sampleSize={formatSample(avgGradeSample, "draft") || undefined}
          emptyReason="Not enough graded drafts"
        />
        <StatTile
          label="Keeper usage"
          value={drafting.keeperUsageRate === null ? null : formatPercent(drafting.keeperUsageRate)}
          sub="Share of roster spots filled by a keeper, in leagues that carry them."
          sampleSize={formatSample(drafting.keeperUsageSampleSize, "league-season") || undefined}
          emptyReason="No keeper leagues in this window"
        />
      </div>

      <PositionalShape shape={shape} sampleSize={shapeSample} lens={lens} />

      <RookieVeteranLean drafting={drafting} lens={lens} />

      <DraftClock drafting={drafting} />
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------ shape */

function PositionalShape({
  shape,
  sampleSize,
  lens,
}: {
  shape: Partial<Record<TradePosition, number>> | null;
  sampleSize: number | null;
  lens: LeagueLens;
}) {
  const entries = TRADE_POSITIONS.map((pos) => ({ pos, share: shape?.[pos] ?? null })).filter(
    (row) => row.share !== null,
  ) as { pos: TradePosition; share: number }[];
  const leader = entries.length > 0 ? [...entries].sort((a, b) => b.share - a.share)[0] : null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">Positional shape of the first rounds</h3>
      {entries.length === 0 || !leader ? (
        <p className="mt-1 text-sm text-ink-muted">
          Not enough drafts to show a shape under {lensLabel(lens).toLowerCase()}.
        </p>
      ) : (
        <ChartFigure
          title="Share of early picks by position"
          summary={`Their first rounds lean toward ${leader.pos}, at ${formatPercent(
            leader.share,
          )} of early picks.`}
          titleLevel={4}
          table={
            <DataTable
              caption="Share of first-round picks spent at each position"
              head={
                <>
                  <Th>Position</Th>
                  <Th numeric>Share</Th>
                </>
              }
            >
              {entries.map((row) => (
                <tr key={row.pos}>
                  <Td>{row.pos}</Td>
                  <Td numeric>{formatPercent(row.share)}</Td>
                </tr>
              ))}
            </DataTable>
          }
        >
          <ul className="space-y-1.5">
            {entries.map((row) => (
              <li key={row.pos} className="flex items-center gap-2 text-xs">
                <span className="w-8 shrink-0 font-semibold text-ink">{row.pos}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-line/60">
                  <span
                    aria-hidden="true"
                    className={`block h-full rounded-full ${POSITION_BAR_COLOR[row.pos]}`}
                    style={{ width: `${Math.round(row.share * 100)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-ink-muted">
                  {formatPercent(row.share)}
                </span>
              </li>
            ))}
          </ul>
        </ChartFigure>
      )}
      {sampleSize !== null && sampleSize > 0 && (
        <p className="mt-1 text-[11px] text-ink-subtle">{formatSample(sampleSize, "draft")}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ rookie lean */

function RookieVeteranLean({
  drafting,
  lens,
}: {
  drafting: ManagerDrafting;
  lens: LeagueLens;
}) {
  const applies = lens !== "redraft";
  const sampleNote = formatSample(drafting.rookieVeteranLeanSampleSize, "startup");
  return (
    <div className="rounded-card border border-line bg-base/40 px-3 py-2.5">
      <h3 className="text-sm font-semibold text-ink">
        Rookie vs veteran lean
        <span className="ml-2 text-xs font-normal text-ink-subtle">(Dynasty only)</span>
      </h3>
      {!applies ? (
        <p className="mt-1 text-xs text-ink-muted">Does not apply to redraft leagues.</p>
      ) : drafting.rookieVeteranLean === null ? (
        <p className="mt-1 text-xs text-ink-muted">Not enough dynasty startups in this window.</p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-mono text-lg font-bold tabular-nums text-ink">
              {formatSigned(drafting.rookieVeteranLean)}
            </span>
            <span className="text-xs text-ink-muted">
              Positive means more rookies than veterans in dynasty startups.
            </span>
          </p>
          {sampleNote && <p className="mt-1 text-[11px] text-ink-subtle">{sampleNote}</p>}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- clock ---- */

/** "3 drafts" / "1 draft". An exact count, so this never gets the "over" prefix formatSample uses. */
function draftCount(n: number): string {
  return `${n} draft${n === 1 ? "" : "s"}`;
}

function DraftClock({ drafting }: { drafting: ManagerDrafting }) {
  const { draftPace, perPickClock, autopick } = drafting;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink">Draft clock</h3>

      {/* draftPace is a fact about the ROOM, not the manager. Kept visually
          apart from the per-manager measurement below and worded as a
          statement about the drafts, never a personal stat. */}
      {draftPace ? (
        <p className="rounded-card border border-dashed border-line bg-base/30 px-3 py-2 text-xs leading-relaxed text-ink-muted">
          A fact about the room, not this manager: their middle draft runs at{" "}
          {formatDuration(draftPace.secondsPerPick)} a pick, about{" "}
          {formatPercent(draftPace.clockShareUsed)} of the allowed clock. Measured on{" "}
          {draftCount(draftPace.draftsObserved)}. A slow offline rookie draft
          spends most of that time overnight rather than on the clock.
        </p>
      ) : (
        <p className="rounded-card border border-dashed border-line bg-base/30 px-3 py-2 text-xs text-ink-muted">
          No draft pace observed yet for the rooms this manager has drafted in.
        </p>
      )}

      {perPickClock ? (
        <p className="rounded-card border border-line bg-base/40 px-3 py-2 text-sm text-ink">
          About {formatDuration(perPickClock.medianSeconds)} a pick, measured on{" "}
          {draftCount(perPickClock.sampleSize)}, accurate to about{" "}
          {formatDuration(perPickClock.errorBarMs / 1000)}.
        </p>
      ) : (
        <p className="rounded-card border border-line bg-base/40 px-3 py-2 text-sm text-ink-muted">
          Per-pick timing starts from the first live draft we watch this manager in. Nothing has
          been observed yet.
        </p>
      )}

      {autopick === null ? (
        <p className="text-xs text-ink-subtle">
          Autopick use is unknown. It is only observable during a live draft we are watching.
        </p>
      ) : (
        <p className="text-xs text-ink-subtle">
          On autopick in {formatPercent(autopick.rate)} of {draftCount(autopick.draftsObserved)} watched live.
        </p>
      )}
    </div>
  );
}
