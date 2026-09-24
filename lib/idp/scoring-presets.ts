/**
 * IDP scoring presets: full scoring maps for the four systems the product
 * names out loud.
 *
 * Every preset carries ONLY idp_* keys plus the two threshold bonuses at zero,
 * so a preset can never score an offensive stat, and a dot product over a
 * defender's line under a preset is exactly that system's points.
 *
 * Sources (plan section 3 and 12):
 *   idp123       Sleeper's default IDP scoring, read from a fresh test league
 *                on 2026-09-23 (plan decision D-1).
 *   big3         The IDP Show's Big 3 scoring.
 *   fantasypros  FantasyPros' published IDP settings.
 *   espn         ESPN's default IDP league scoring.
 * Yahoo, CBS and NFL.com defaults are unverified and deliberately absent.
 *
 * Client-safe: no imports, plain data.
 */

export type IdpPresetKey = "idp123" | "big3" | "fantasypros" | "espn";

/** Every idp_* key a preset may weight, in a fixed order. */
export const IDP_SCORING_KEYS = [
  "idp_tkl",
  "idp_tkl_solo",
  "idp_tkl_ast",
  "idp_tkl_loss",
  "idp_sack",
  "idp_sack_yd",
  "idp_qb_hit",
  "idp_int",
  "idp_int_ret_yd",
  "idp_pass_def",
  "idp_pass_def_3p",
  "idp_ff",
  "idp_fum_rec",
  "idp_fum_ret_yd",
  "idp_def_td",
  "idp_safe",
  "idp_blk_kick",
] as const;

export type IdpScoringMap = Readonly<Record<string, number>>;

/** A full map: every idp key present, zero unless named, bonuses zero. */
function preset(weights: Partial<Record<(typeof IDP_SCORING_KEYS)[number], number>>): IdpScoringMap {
  const out: Record<string, number> = {};
  for (const key of IDP_SCORING_KEYS) out[key] = weights[key] ?? 0;
  out.bonus_tkl_10p = 0;
  out.bonus_sack_2p = 0;
  return Object.freeze(out);
}

export const IDP_PRESETS: Readonly<Record<IdpPresetKey, IdpScoringMap>> = Object.freeze({
  idp123: preset({
    idp_tkl_solo: 2,
    idp_tkl_ast: 1,
    idp_tkl_loss: 2,
    idp_sack: 6,
    idp_qb_hit: 1,
    idp_pass_def: 3,
    idp_ff: 3,
    idp_fum_rec: 3,
    idp_safe: 3,
    idp_blk_kick: 3,
    idp_int: 6,
    idp_def_td: 6,
  }),
  big3: preset({
    idp_tkl_solo: 1.25,
    idp_tkl_ast: 0.75,
    idp_qb_hit: 2,
    idp_tkl_loss: 3,
    idp_fum_rec: 3,
    idp_pass_def: 4,
    idp_ff: 4,
    idp_sack: 5,
    idp_safe: 5,
    idp_blk_kick: 5,
    idp_int: 6,
    idp_def_td: 6,
  }),
  fantasypros: preset({
    idp_tkl_solo: 1.5,
    idp_tkl_ast: 0.75,
    idp_tkl_loss: 2.5,
    idp_sack: 4,
    idp_int: 5,
    idp_ff: 4,
    idp_fum_rec: 4,
    idp_def_td: 6,
    idp_safe: 2,
    idp_pass_def: 1.5,
  }),
  espn: preset({
    idp_tkl_solo: 1.5,
    idp_tkl_ast: 0.75,
    idp_tkl_loss: 2,
    idp_sack: 4,
    idp_int: 5,
    idp_ff: 4,
    idp_fum_rec: 4,
    idp_def_td: 6,
    idp_safe: 2,
    idp_pass_def: 1.5,
    idp_blk_kick: 2,
  }),
});

/** How each preset is named beside a number. */
export const IDP_PRESET_LABEL: Readonly<Record<IdpPresetKey, string>> = Object.freeze({
  idp123: "Sleeper default IDP scoring",
  big3: "Big 3 scoring",
  fantasypros: "FantasyPros IDP scoring",
  espn: "ESPN default IDP scoring",
});
