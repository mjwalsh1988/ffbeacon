/**
 * Derive the league-format tag chips shown on the league overview header.
 *
 * Reads from the synced Sleeper payload (`roster_positions` + `scoring_settings`)
 * and produces a stable order of short, glanceable tags:
 *   {team count}, Start {N}, PPR {x}, TEP {x}, SF Yes/No, then per-position counts.
 *
 * The shape mirrors DPC's dynasty-decoder format tags (`tone: 'format'` for the
 * meta tags, `tone: 'position'` for the per-slot tags), so the renderer can
 * apply two visual tones (cyan for format, purple for position) matching the
 * FF Beacon brand.
 */

export type FormatTagTone = "format" | "position";

export type FormatTag = {
  key: string;
  label: string;
  tone: FormatTagTone;
};

/** Non-starter (bench-like) slots dropped before counting starters. */
const BENCH_SLOTS = new Set(["BN", "TAXI", "IR", "RES", "COV"]);

/** Slots counted as roster spots but EXCLUDED from the "Start N" headline number. */
const EXCLUDED_FROM_START_TOTAL = new Set(["K", "DEF", "DST"]);

const POSITION_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "WRRB_FLEX",
  "REC_FLEX",
  "SUPER_FLEX",
  "K",
  "DEF",
  "DST",
  "DL",
  "LB",
  "DB",
  "IDP_FLEX",
];

function labelForPosition(slot: string): string {
  if (slot === "SUPER_FLEX") return "SF";
  if (slot === "WRRB_FLEX") return "W/R";
  if (slot === "REC_FLEX") return "W/T";
  if (slot === "IDP_FLEX") return "IDP";
  return slot;
}

function getStartingPositions(rosterPositions: unknown): string[] {
  if (!Array.isArray(rosterPositions)) return [];
  const out: string[] = [];
  for (const slot of rosterPositions) {
    if (slot == null) continue;
    const u = String(slot).toUpperCase();
    if (!u || BENCH_SLOTS.has(u)) continue;
    out.push(u);
  }
  return out;
}

function isSuperflex(rosterPositions: unknown): boolean {
  if (!Array.isArray(rosterPositions)) return false;
  let qbCount = 0;
  for (const slot of rosterPositions) {
    const u = String(slot).toUpperCase();
    if (u === "SUPER_FLEX" || u === "SUPERFLEX" || u === "SF") return true;
    if (u === "QB") qbCount++;
  }
  return qbCount >= 2;
}

/**
 * Build the ordered list of tags to render. Caller passes the synced
 * `leagues.roster_positions`, `leagues.scoring_settings`, and `total_rosters`.
 * Missing fields are silently skipped so the row is dense without filler.
 */
export function buildLeagueFormatTags(input: {
  rosterPositions: unknown;
  scoringSettings: unknown;
  teamCount: number | null | undefined;
}): FormatTag[] {
  const tags: FormatTag[] = [];

  const starters = getStartingPositions(input.rosterPositions);
  const starterCount = starters.filter((s) => !EXCLUDED_FROM_START_TOTAL.has(s)).length;
  const sf = isSuperflex(input.rosterPositions);

  const scoring = (input.scoringSettings ?? {}) as Record<string, unknown>;
  const recRaw = typeof scoring.rec === "number" ? (scoring.rec as number) : null;
  const tepRaw =
    typeof scoring.bonus_rec_te === "number"
      ? (scoring.bonus_rec_te as number)
      : null;

  if (input.teamCount != null && Number.isFinite(input.teamCount)) {
    tags.push({
      key: "tc",
      label: `${input.teamCount} ${input.teamCount === 1 ? "team" : "teams"}`,
      tone: "format",
    });
  }
  if (starterCount > 0) {
    tags.push({ key: "ss", label: `Start ${starterCount}`, tone: "format" });
  }
  if (recRaw != null) {
    tags.push({ key: "ppr", label: `PPR ${formatScoring(recRaw)}`, tone: "format" });
  }
  if (tepRaw != null && tepRaw > 0) {
    tags.push({ key: "tep", label: `TEP ${formatScoring(tepRaw)}`, tone: "format" });
  }
  tags.push({ key: "sf", label: `SF ${sf ? "Yes" : "No"}`, tone: "format" });

  if (starters.length > 0) {
    const counts = new Map<string, number>();
    for (const slot of starters) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    const seen = new Set<string>();
    for (const pos of POSITION_ORDER) {
      if (counts.has(pos)) {
        tags.push({
          key: `pos-${pos}`,
          label: `${labelForPosition(pos)} ${counts.get(pos) as number}`,
          tone: "position",
        });
        seen.add(pos);
      }
    }
    for (const [pos, n] of counts) {
      if (!seen.has(pos)) {
        tags.push({
          key: `pos-${pos}`,
          label: `${labelForPosition(pos)} ${n}`,
          tone: "position",
        });
      }
    }
  }

  return tags;
}

/**
 * Build the scoring-settings tags shown in the league info card's Scoring
 * section. Reads the synced Sleeper `scoring_settings` and surfaces the rules
 * that actually shape skill-position fantasy value and that vary between
 * leagues: reception type, position reception + first-down premiums, passing TD
 * value, non-standard rushing/receiving TD value, and the milestone bonus
 * families (yardage, long TD). Near-universal defaults (DST tiers, kicker
 * distances, standard INT/fumble penalties) are intentionally omitted so the
 * row stays clear. All tags render in the "format" (cyan) tone.
 */
export function buildLeagueScoringTags(scoringSettings: unknown): FormatTag[] {
  const s = (scoringSettings ?? {}) as Record<string, unknown>;
  const num = (k: string): number | null =>
    typeof s[k] === "number" ? (s[k] as number) : null;
  const positive = (k: string): number | null => {
    const v = num(k);
    return v != null && v > 0 ? v : null;
  };
  const anyPositive = (keys: string[]): boolean => keys.some((k) => positive(k) != null);

  const tags: FormatTag[] = [];
  const push = (key: string, label: string) => tags.push({ key, label, tone: "format" });

  // Reception scoring.
  const rec = num("rec");
  if (rec === 1) push("sc-rec", "PPR");
  else if (rec === 0.5) push("sc-rec", "Half PPR");
  else if (rec == null || rec === 0) push("sc-rec", "Standard");
  else push("sc-rec", `PPR ${formatScoring(rec)}`);

  // Position reception premiums.
  const tep = positive("bonus_rec_te");
  if (tep != null) push("sc-tep", `TEP +${formatScoring(tep)}`);
  const rbRec = positive("bonus_rec_rb");
  if (rbRec != null) push("sc-rbrec", `RB rec +${formatScoring(rbRec)}`);
  const wrRec = positive("bonus_rec_wr");
  if (wrRec != null) push("sc-wrrec", `WR rec +${formatScoring(wrRec)}`);

  // Point-per-first-down (position bonuses first, then a flat fallback).
  const fdByPos: Array<[string, string]> = [
    ["bonus_fd_qb", "QB"],
    ["bonus_fd_rb", "RB"],
    ["bonus_fd_wr", "WR"],
    ["bonus_fd_te", "TE"],
  ];
  let anyPosFd = false;
  for (const [key, pos] of fdByPos) {
    const v = positive(key);
    if (v != null) {
      push(`sc-fd-${pos}`, `${pos} 1D +${formatScoring(v)}`);
      anyPosFd = true;
    }
  }
  if (!anyPosFd) {
    const flat = positive("rec_fd") ?? positive("rush_fd") ?? positive("pass_fd");
    if (flat != null) push("sc-fd", `1st down +${formatScoring(flat)}`);
  }

  // Passing TD value (4 vs 6 is a defining difference).
  const passTd = num("pass_td");
  if (passTd != null) push("sc-passtd", `Pass TD ${formatScoring(passTd)}`);

  // Non-standard rush/rec TD value (default is 6).
  const rushTd = num("rush_td");
  const recTd = num("rec_td");
  if (rushTd != null && recTd != null && rushTd === recTd && rushTd !== 6) {
    push("sc-td", `${formatScoring(rushTd)}pt TDs`);
  } else {
    if (rushTd != null && rushTd !== 6) push("sc-rushtd", `Rush TD ${formatScoring(rushTd)}`);
    if (recTd != null && recTd !== 6) push("sc-rectd", `Rec TD ${formatScoring(recTd)}`);
  }

  // Milestone bonus families, summarized so the row stays readable.
  if (
    anyPositive([
      "bonus_pass_yd_300",
      "bonus_rush_yd_100",
      "bonus_rec_yd_100",
      "bonus_rush_yd_200",
      "bonus_rec_yd_200",
      "bonus_rush_rec_yd_100",
      "bonus_rush_rec_yd_200",
    ])
  ) {
    push("sc-ydbonus", "Yardage bonuses");
  }
  if (
    anyPositive([
      "pass_td_40p",
      "pass_td_50p",
      "rush_td_40p",
      "rush_td_50p",
      "rec_td_40p",
      "rec_td_50p",
    ])
  ) {
    push("sc-longtd", "Long TD bonus");
  }

  return tags;
}

function formatScoring(n: number): string {
  // Sleeper stores scoring values as floats. Show as integer when whole,
  // otherwise trim trailing zeros (1.0 → 1, 0.5 → 0.5, 0.25 → 0.25).
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(2)));
}
