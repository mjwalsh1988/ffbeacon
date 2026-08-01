/**
 * Which FF Beacon boards are DERIVED from another board rather than computed
 * from external sources.
 *
 * Every TE-premium format belongs here. A TEP board means one specific thing:
 * the same league with tight ends scoring more. So it must differ from its
 * baseline for tight ends and for nobody else. Computing one independently
 * cannot promise that, because the normalization pool is whichever sources
 * declare support for that exact slug, and a TEP board is typically covered by
 * fewer sources than its baseline. dynasty-ppr-tep-sflex is the proof: KTC is
 * its only source, so it normalized against a one-source canonical curve while
 * dynasty-ppr-sflex used three, and every skill position drifted (WR +860 avg,
 * RB +888, QB +644) with no tight end involved. Deriving makes the guarantee
 * structural instead of coincidental.
 *
 * The redraft TEP pair is FF Beacon only; no external source publishes redraft
 * TE-premium values. See migration 0158.
 *
 * This list lives in its own module because two subsystems need it and neither
 * should own it: the value engine skips these boards when normalizing, and the
 * calibration reference builder skips them when deciding which formats need a
 * stored scale. A derived board never normalizes, so it never needs a reference,
 * and building one for it would be dead data plus a nightly refusal for boards
 * no external source covers at all.
 */

export const INHERITED_FORMATS: ReadonlyArray<{
  slug: string;
  baselineSlug: string;
  transform: "te_premium" | "identity";
}> = [
  { slug: "redraft-ppr-tep", baselineSlug: "redraft-ppr-std", transform: "te_premium" },
  { slug: "redraft-ppr-tep-sflex", baselineSlug: "redraft-ppr-sflex", transform: "te_premium" },
  { slug: "dynasty-ppr-tep", baselineSlug: "dynasty-ppr-std", transform: "te_premium" },
  { slug: "dynasty-ppr-tep-sflex", baselineSlug: "dynasty-ppr-sflex", transform: "te_premium" },
  { slug: "bestball-ppr-std", baselineSlug: "redraft-ppr-std", transform: "identity" },
  { slug: "bestball-ppr-sflex", baselineSlug: "redraft-ppr-sflex", transform: "identity" },
  { slug: "bestball-dynasty-ppr-sflex", baselineSlug: "dynasty-ppr-sflex", transform: "identity" },
];

/** Fast membership test for "is this board derived, and therefore never normalized?" */
export const DERIVED_FORMAT_SLUGS: ReadonlySet<string> = new Set(
  INHERITED_FORMATS.map((s) => s.slug),
);

/** True when the board is built from another board's finished rows. */
export function isDerivedFormat(slug: string): boolean {
  return DERIVED_FORMAT_SLUGS.has(slug);
}
