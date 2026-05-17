// Pick a fallback format when the user's current format isn't supported by
// the newly selected source. Preference chain (each step strictly tighter than
// the next):
//   1. Same league_type (redraft/dynasty)
//   2. Same scoring_type (ppr / half_ppr / standard)
//   3. Same is_superflex
//   4. Lowest display_order among the source's supported formats
// If none of the source's supported_format_slugs intersect the active format
// list, returns null. Callers should then render the empty-state.
//
// NOTE: When supported_format_slugs is null (means "supports everything"),
// we treat every active format as eligible.

export type FormatLike = {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  display_order: number | null;
};

export function pickFallbackFormat(
  allFormats: FormatLike[],
  currentFormatSlug: string,
  supportedSlugs: string[] | null,
): FormatLike | null {
  const eligible = supportedSlugs === null
    ? allFormats
    : allFormats.filter((f) => supportedSlugs.includes(f.slug));
  if (eligible.length === 0) return null;

  const current = allFormats.find((f) => f.slug === currentFormatSlug);
  if (!current) {
    return [...eligible].sort(byDisplayOrder)[0] ?? null;
  }

  const sameLeague = eligible.filter((f) => f.league_type === current.league_type);
  const leaguePool = sameLeague.length > 0 ? sameLeague : eligible;

  const sameScoring = leaguePool.filter((f) => f.scoring_type === current.scoring_type);
  const scoringPool = sameScoring.length > 0 ? sameScoring : leaguePool;

  const sameSflex = scoringPool.filter((f) => f.is_superflex === current.is_superflex);
  const sflexPool = sameSflex.length > 0 ? sameSflex : scoringPool;

  return [...sflexPool].sort(byDisplayOrder)[0] ?? null;
}

function byDisplayOrder(a: FormatLike, b: FormatLike) {
  const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.slug.localeCompare(b.slug);
}
