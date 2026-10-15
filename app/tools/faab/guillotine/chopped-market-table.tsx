/**
 * What chopped leagues pay for a claim, and the platform rules that move it.
 *
 * Two tables, both read rather than typed. The market table comes from the
 * same faab_market_priors cells the chopped guide quotes (lib/faab/
 * chopped-market.ts), so the guide and this page can never print different
 * figures for the same band. The platform table is rendered from
 * CHOPPED_PLATFORMS, the list the calculator's own platform picker uses, so a
 * change to that constant changes this page.
 *
 * A band we cannot publish says so in words. A zero would read as "chopped
 * leagues pay nothing", which is a claim nobody measured.
 *
 * Every column stays at every width: the figures are short, so the table uses
 * the same compact classes as the general page's MarketTable rather than
 * hiding a column on a phone.
 */

import { formatEastern } from "@/lib/datetime";
import { pctText, type MarketRead } from "@/lib/guides/faab-market-figures";
import type { ChoppedMarket } from "@/lib/faab/chopped-market";
import { CHOPPED_PLATFORMS } from "../manual-setup";
import { PLATFORM_TABLE_ID } from "./written-sections";

const NOT_ENOUGH_LEAGUES = "Not enough leagues yet";

/** The platforms the calculator knows by name. "Other" has no rules to list. */
const NAMED_PLATFORMS = CHOPPED_PLATFORMS.filter((platform) => platform.key !== "other");

function MarketRow({ label, read }: { label: string; read: MarketRead | null }) {
  const publishable = read !== null && read.enough;
  return (
    <tr>
      <th scope="row" className="py-2 pr-2 text-left font-medium text-ink">
        {label}
      </th>
      {publishable ? (
        <>
          <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
            {pctText(read.p50)}%
          </td>
          <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
            {pctText(read.p25)}%
          </td>
          <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
            {pctText(read.p75)}%
          </td>
        </>
      ) : (
        <td colSpan={3} className="py-2 pr-2 text-right text-ink-subtle">
          {NOT_ENOUGH_LEAGUES}
        </td>
      )}
      <td className="py-2 text-right tabular-nums text-ink-muted">
        {read ? read.sampleSize.toLocaleString() : "None yet"}
      </td>
    </tr>
  );
}

export function ChoppedMarketTable({ market }: { market: ChoppedMarket }) {
  return (
    <section aria-labelledby="chopped-market-heading" className="mt-14 sm:mt-16">
      <h2
        id="chopped-market-heading"
        className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
      >
        What chopped leagues pay
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Winning bids in the chopped and guillotine leagues synced to FF Beacon, grouped by how
        much of the field was still alive when the claim went in. No league or manager is
        identifiable.
      </p>

      <div className="mt-6">
        <table className="w-full border-collapse text-left text-xs sm:text-sm">
          <caption className="mb-2 text-left text-xs leading-relaxed text-ink-subtle">
            What chopped leagues actually pay for a claim, as a share of the full budget
          </caption>
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                Field still alive
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                Median
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                1 in 4 paid less than
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                1 in 4 paid more than
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                Winning bids
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {market.bands.map((band) => (
              <MarketRow key={band.label} label={band.label} read={band.read} />
            ))}
            <MarketRow label="Overall" read={market.overall} />
          </tbody>
        </table>
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
          {market.updatedAt
            ? `Updated ${formatEastern(market.updatedAt)}.`
            : "Not built yet: these figures appear once the first chopped auctions are measured."}
        </p>
      </div>

      <div className="mt-10">
        <h3
          id={PLATFORM_TABLE_ID}
          className="scroll-mt-24 text-lg font-semibold tracking-tight text-ink"
        >
          Platform rules for chopped leagues
        </h3>
        <div className="mt-3">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <caption className="mb-2 text-left text-xs leading-relaxed text-ink-subtle">
              The smallest claim each platform accepts and the last week a chopped roster is
              released back to waivers
            </caption>
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
                <th scope="col" className="py-1.5 pr-2 font-semibold">
                  Platform
                </th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                  Minimum bid
                </th>
                <th scope="col" className="py-1.5 text-right font-semibold">
                  Rosters released until
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {NAMED_PLATFORMS.map((platform) => (
                <tr key={platform.key}>
                  <th scope="row" className="py-2 pr-2 text-left font-medium text-ink">
                    {platform.label}
                  </th>
                  <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
                    ${platform.minBid}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-muted">
                    {platform.releaseCutoffWeek === null
                      ? "All season"
                      : `Week ${platform.releaseCutoffWeek}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
