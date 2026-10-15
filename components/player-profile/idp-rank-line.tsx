import Link from "next/link";
import { positionNoun, IDP_POSITIONS, type IdpPosition } from "@/lib/site";
import { IDP_RANKINGS_PER_POSITION, loadIdpRankingsCached } from "@/lib/idp/rankings";

/**
 * One line on a defender's overview: where he sits in our IDP rankings, with a
 * link to his position's table on /rankings/idp. Defender profiles only; the
 * offensive tabs never import it.
 *
 * Reads the same cached rankings the page does, so the two cannot disagree. A
 * failed read renders nothing: a profile must never fail because the rankings
 * did. Plan of record: docs/seo-audit/gsc-growth-plan-2026-10-15.md, 5.5.
 *
 * Async server component.
 */

const LINK_CLASS = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

function isIdpPosition(position: string): position is IdpPosition {
  return (IDP_POSITIONS as readonly string[]).includes(position);
}

export async function IdpRankLine({ playerId, position }: { playerId: string; position: string }) {
  if (!isIdpPosition(position)) return null;

  let rankings;
  try {
    rankings = await loadIdpRankingsCached();
  } catch (error) {
    console.error("[profile] IDP rank line failed", error);
    return null;
  }

  const plural = positionNoun(position, "plural");
  // The same anchors /rankings/idp builds its section ids from.
  const href = `/rankings/idp#${plural.replace(/ /g, "-")}`;
  const row = rankings.byPosition[position].find((r) => r.playerId === playerId);

  if (!row) {
    // "Outside the top 60" is only true when there IS a top 60. A shorter list
    // (the offseason, a thin position) has no cut-off to be outside of.
    if (rankings.byPosition[position].length < IDP_RANKINGS_PER_POSITION) return null;
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        He is outside the top {IDP_RANKINGS_PER_POSITION} {plural} in our{" "}
        <Link href={href} className={LINK_CLASS}>
          IDP rankings
        </Link>
        .
      </p>
    );
  }

  const basis =
    row.basis === "projected"
      ? "by projected points for the rest of the season"
      : "by last season's points";
  return (
    <p className="text-sm leading-relaxed text-ink-muted">
      Ranked {row.positionRank} of {rankings.byPosition[position].length} {plural} in our{" "}
      <Link href={href} className={LINK_CLASS}>
        IDP rankings
      </Link>
      , {basis}.
    </p>
  );
}
