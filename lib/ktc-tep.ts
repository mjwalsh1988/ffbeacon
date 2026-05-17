// KTC's TEP (TE Premium) formula, ported from the community-maintained
// scraper at https://github.com/ees4/KeepTradeCut-Scraper (tep_adjust).
//
// KTC explicitly publishes TEP rankings as an *algorithmic* derivation of
// their base Superflex values, not a separate dataset. So we don't scrape
// the TEP page (and we can't reliably anyway — KTC's TEP toggle is
// client-side JS, see scripts/sync-ktc.ts header). Instead we reproduce
// the formula here, apply it to the base sflex values during sync, and
// store the result under the same source='ktc'.
//
// Formula (per TEP tier):
//   s = 0.2
//   for each TE in the dataset, sorted by base value descending (te_rank = 0..):
//     t = t_mult * player_value
//     n = (te_rank / (total_players - 25)) * r + (s * r)
//     new_value = min(max_player_value - 1, round(t + n))
//   non-TE values are unchanged
//   then re-sort the whole dataset by value to re-rank
//
// Tier constants (t_mult, r) come from KTC. We map te_premium_bonus to a
// tier as follows:
//   te_premium_bonus 0.5  -> TEP+   (tier 1)
//   te_premium_bonus 1.0  -> TEP++  (tier 2)
//   te_premium_bonus 1.5+ -> TEP+++ (tier 3)

export type TepTier = 1 | 2 | 3;

const TEP_S = 0.2;
const TEP_CONSTANTS: Record<TepTier, { t_mult: number; r: number }> = {
  1: { t_mult: 1.1, r: 250 },
  2: { t_mult: 1.2, r: 350 },
  3: { t_mult: 1.3, r: 450 },
};

export function tepTierFromTePremiumBonus(bonus: number): TepTier | null {
  if (bonus >= 1.5) return 3;
  if (bonus >= 1.0) return 2;
  if (bonus >= 0.5) return 1;
  return null;
}

export type TepPlayer = {
  player_id: string;
  position: string;
  value: number;
};

// Returns a NEW array of players with TE values boosted per the formula.
// Non-TE players are passed through unchanged. The returned array is sorted
// by adjusted value descending so the caller can assign overall_rank.
export function applyKtcTep<T extends TepPlayer>(
  players: T[],
  tier: TepTier,
): T[] {
  if (players.length === 0) return [];
  const sortedDesc = [...players].sort((a, b) => b.value - a.value);
  const { t_mult, r } = TEP_CONSTANTS[tier];
  const total = sortedDesc.length;
  // Guard: formula divides by (total - 25). If the dataset is implausibly
  // small, bail rather than producing nonsense.
  if (total <= 25) {
    throw new Error(`applyKtcTep: dataset too small (${total} <= 25)`);
  }
  const maxPlayerVal = sortedDesc[0].value;

  let teRank = 0;
  const adjusted: T[] = sortedDesc.map((p) => {
    if (p.position !== "TE") return { ...p };
    const t = t_mult * p.value;
    const n = (teRank / (total - 25)) * r + TEP_S * r;
    const next = Math.min(maxPlayerVal - 1, Math.round(t + n));
    teRank++;
    return { ...p, value: next };
  });

  adjusted.sort((a, b) => b.value - a.value);
  return adjusted;
}
