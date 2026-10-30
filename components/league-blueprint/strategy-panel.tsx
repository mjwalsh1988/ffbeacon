/**
 * Trade strategy (plan 9.13): three ruled entries, one per shape (downtier,
 * uptier, pivot), each the finder's best deal of that shape with the Signal
 * Check verdict, the reader's wins and value change, the acceptance band and
 * a link into the builder. An empty shape says so, and when the only deals
 * of a shape would have sent a Build around player the sentence names him,
 * so this section and the calls section visibly agree. The ideal trade
 * partners follow.
 *
 * "Projected wins" names the trade finder's team-specific estimate; nothing
 * here is Positional WAR.
 */

import Link from "next/link";
import type { Route } from "next";
import { ACCEPTANCE_LABEL } from "@/lib/trade-finder/types";
import type { BlueprintView, StrategyAsset, StrategyEntry } from "@/lib/league-blueprint/types";
import { PartnersList } from "./partners-list";
import { builderHref, teamWithHandle, fmtSigned, LINK, SECONDARY_LABEL, SUBLIST_HEADING } from "./bits";
import { SheetSection } from "./sheet";

function Assets({ label, assets }: { label: string; assets: StrategyAsset[] }) {
  return (
    <div className="min-w-0">
      <p className={SECONDARY_LABEL}>{label}</p>
      <ul role="list" className="mt-1 space-y-0.5">
        {assets.map((a, i) => (
          <li key={`${a.label}-${i}`} className="break-words text-sm text-ink">
            {a.label}
            {a.position && <span className="ml-1 font-mono text-[11px] text-ink-subtle">{a.position}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shape({
  entry,
  view,
  linkUsername,
}: {
  entry: StrategyEntry;
  view: BlueprintView;
  linkUsername: string | null;
}) {
  const [shape, detail] = entry.label.split(": ");
  const c = entry.card;
  return (
    <article aria-labelledby={`bp-shape-${entry.shape}`} className="flex min-w-0 flex-col border-t border-line pt-3">
      <h3 id={`bp-shape-${entry.shape}`} className="text-sm font-semibold text-ink">
        {shape}
      </h3>
      <p className="text-xs text-ink-muted">{detail}</p>
      {!c ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{entry.emptyText}</p>
      ) : (
        <>
          <p className="mt-3 text-sm font-medium leading-snug text-ink">{c.headline}</p>
          <p className="mt-1 text-xs text-ink-muted">
            With {teamWithHandle(c.counterpartyTeamName, c.counterpartyHandle)}
          </p>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
            <Assets label="You send" assets={c.outgoing} />
            <span className="pt-4 text-xs font-semibold uppercase tracking-wide text-ink-subtle">for</span>
            <Assets label="You get" assets={c.incoming} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <dt className={SECONDARY_LABEL}>Value</dt>
              <dd className="font-mono text-lg font-black tabular-nums text-ink">
                {fmtSigned(c.valueDelta)}
                <span className="sr-only"> value for you</span>
              </dd>
            </div>
            <div>
              <dt className={SECONDARY_LABEL}>Projected wins</dt>
              <dd className="font-mono text-lg font-black tabular-nums text-ink">
                {c.winsDelta === null ? (
                  <span className="text-sm font-medium text-ink-subtle">No estimate</span>
                ) : (
                  <>
                    {fmtSigned(c.winsDelta, 2)}
                    <span className="sr-only"> projected wins for you</span>
                  </>
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-ink-muted">
            {c.verdictLabel ? `${c.verdictLabel.replace(/[.]$/, "")}${c.confidenceLabel ? `, ${c.confidenceLabel.toLowerCase()}` : ""}. ` : ""}
            Acceptance: {ACCEPTANCE_LABEL[c.acceptance]}.
          </p>
          <div className="mt-auto pt-2">
            <Link
              href={builderHref(view.sleeperLeagueId, c.proposal, linkUsername, view.header.sourceSlug) as Route}
              className={LINK}
            >
              Open in builder<span className="sr-only">: the {shape.toLowerCase()} with {c.counterpartyTeamName}</span>
            </Link>
          </div>
        </>
      )}
    </article>
  );
}

export function StrategyPanel({ view, linkUsername, number }: { view: BlueprintView; linkUsername: string | null; number: string }) {
  return (
    <SheetSection
      id="bp-strategy"
      number={number}
      title="Trade strategy"
      helper="The trade finder's best deal of each shape for this roster, graded by Signal Check. No deal here sends a Build around player."
    >
      <div className="grid items-stretch gap-x-8 gap-y-5 lg:grid-cols-3">
        {view.strategy.map((e) => (
          <Shape key={e.shape} entry={e} view={view} linkUsername={linkUsername} />
        ))}
      </div>
      <h3 className={`mt-8 ${SUBLIST_HEADING}`}>Ideal trade partners</h3>
      <PartnersList view={view} linkUsername={linkUsername} />
    </SheetSection>
  );
}
