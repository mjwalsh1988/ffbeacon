/**
 * The rail that stands beside every My Beacon surface.
 *
 * The Signal card used to ride inside the masthead, where it squeezed the page
 * title on a laptop and pushed the actual page down on everything narrower. It
 * lives here now, at the top of a rail that follows you down the page, with the
 * account facts that used to be a row of tiles on the dashboard underneath it.
 * Those facts were only ever true of the account rather than of the dashboard,
 * so a rail that shows on every page is where they belong, and the dashboard
 * gets its main column back.
 *
 * Presentational server component. Everything it renders is already loaded by
 * the layout.
 */

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import {
  SignalStatusCard,
  type SignalStatus,
} from "@/components/signal/signal-status-card";

export type BeaconRailFacts = {
  /** Short format name, e.g. "Dynasty PPR SF". */
  formatShort: string;
  /** The unabbreviated name, for the accessible reading. */
  formatFull: string;
  sourceDisplay: string;
  /** Leagues featured or shown on the public profile. */
  profileLeagueCount: number;
  /** Custom ranking boards saved to the account. */
  boardCount: number;
  /** The saved Sleeper handle, or null when none is connected. */
  sleeperUsername: string | null;
  /** Month and year the account was created, already formatted. */
  memberSince: string;
  isAdmin: boolean;
};

export function BeaconRail({
  signal,
  facts,
}: {
  signal: SignalStatus;
  facts: BeaconRailFacts;
}) {
  return (
    <>
      <SignalStatusCard signal={signal} />

      <Panel
        eyebrow="Your setup"
        title="Account at a glance"
        helper="Format and source are your saved preferences. Change them from the header."
        headingLevel={2}
      >
        <dl className="grid grid-cols-2 gap-2">
          <RailFact
            label="Format"
            value={facts.formatShort}
            valueLabel={facts.formatFull}
            accent="purple"
          />
          <RailFact label="Source" value={facts.sourceDisplay} />
          <RailFact
            label="Boards"
            value={String(facts.boardCount)}
            hint={facts.boardCount === 1 ? "Custom board" : "Custom boards"}
          />
          <RailFact
            label="On profile"
            value={String(facts.profileLeagueCount)}
            hint={facts.profileLeagueCount === 1 ? "League shown" : "Leagues shown"}
            accent="purple"
          />
        </dl>

        <dl className="mt-2 grid gap-2">
          <RailFact
            label="Sleeper"
            value={facts.sleeperUsername ? `@${facts.sleeperUsername}` : "Not connected"}
            hint={
              facts.sleeperUsername
                ? "Your leagues sync from this handle"
                : "Add your handle to sync your leagues"
            }
            accent={facts.sleeperUsername ? "cyan" : "muted"}
          />
          <RailFact label="Member since" value={facts.memberSince} accent="muted" />
        </dl>

        <Link
          href="/my-beacon/sleeper-leagues"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {facts.sleeperUsername ? "Manage your leagues" : "Connect your Sleeper account"}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </Panel>

      {facts.isAdmin && (
        <Panel eyebrow="Admin access" title="You can run the site" headingLevel={2}>
          <p className="text-sm leading-relaxed text-ink-muted">
            System health, user activity, and every cron run are behind one door.
          </p>
          <Link
            href="/admin"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Open the admin panel
          </Link>
        </Panel>
      )}
    </>
  );
}

/**
 * One fact. The value is a plain string rather than a mono numeral, because
 * half of these are words ("Dynasty PPR SF") and mono at that width wraps them
 * into two lines.
 */
function RailFact({
  label,
  value,
  valueLabel,
  hint,
  accent = "cyan",
}: {
  label: string;
  value: string;
  /** Read instead of `value` when the visible text is abbreviated. */
  valueLabel?: string;
  hint?: string;
  accent?: "cyan" | "purple" | "muted";
}) {
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "muted"
        ? "text-ink"
        : "text-brand-cyan";
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm font-semibold ${color}`}>
        {valueLabel ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{valueLabel}</span>
          </>
        ) : (
          value
        )}
        {hint && (
          <span className="mt-0.5 block text-[11px] font-normal leading-tight text-ink-muted">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}
