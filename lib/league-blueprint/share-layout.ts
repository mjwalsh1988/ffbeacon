/**
 * Portrait share card height (plan 11.3). Pure.
 *
 * The card is as tall as its sections, so a league with more starting slots
 * (an IDP league) gets a taller card rather than a clipped one.
 */

export const SHARE_WIDTH = 1080;
export const SHARE_GAP = 48;

export const SECTION_HEIGHT = {
  header: 200,
  grades: 220,
  lineupRow: 52,
  lineupHead: 60,
  shares: 150,
  calls: 260,
  movers: 150,
  // The title block plus slack; the rows add 40 each. 110 left a blank band
  // under three seasons.
  capitalBase: 64,
  capitalSeason: 40,
  capitalRedraft: 110,
  priorities: 310,
  strategy: 310,
  partners: 110,
  footer: 110,
} as const;

/**
 * Measured text sections. Each entry is how many lines one sentence takes at
 * its own size (the caller estimates with fitText). Absent, the section takes
 * its fixed SECTION_HEIGHT, which holds the longest clipped text.
 */
export type ShareSections = {
  slots: number;
  capitalSeasons: number | null;
  priorityLines?: number[];
  strategyLines?: number[];
};

/** Line heights the portrait draws at: the first priority 30px, the rest 24px, strategy 20px. */
export const SHARE_LINE = { titleBlock: 44, priorityFirst: 38, priorityRest: 31, priorityGap: 8, strategyLabel: 28, strategyLine: 25, strategyGap: 10 } as const;

export function prioritiesHeight(lines: number[] | undefined): number {
  if (!lines) return SECTION_HEIGHT.priorities;
  const L = SHARE_LINE;
  return Math.min(
    SECTION_HEIGHT.priorities,
    L.titleBlock + lines.reduce((a, n, i) => a + n * (i === 0 ? L.priorityFirst : L.priorityRest) + L.priorityGap, 0),
  );
}

export function strategyHeight(lines: number[] | undefined): number {
  if (!lines) return SECTION_HEIGHT.strategy;
  const L = SHARE_LINE;
  return Math.min(SECTION_HEIGHT.strategy, L.titleBlock + lines.reduce((a, n) => a + L.strategyLabel + n * L.strategyLine + L.strategyGap, 0));
}

export type ShareLayout = {
  width: number;
  height: number;
  sections: Array<{ key: string; height: number }>;
};

export function shareLayout(s: ShareSections): ShareLayout {
  const h = SECTION_HEIGHT;
  const sections = [
    { key: "header", height: h.header },
    { key: "grades", height: h.grades },
    { key: "lineup", height: h.lineupHead + h.lineupRow * s.slots },
    { key: "shares", height: h.shares },
    { key: "calls", height: h.calls },
    { key: "movers", height: h.movers },
    {
      key: "capital",
      height: s.capitalSeasons === null ? h.capitalRedraft : h.capitalBase + h.capitalSeason * s.capitalSeasons,
    },
    { key: "priorities", height: prioritiesHeight(s.priorityLines) },
    { key: "strategy", height: strategyHeight(s.strategyLines) },
    { key: "partners", height: h.partners },
    { key: "footer", height: h.footer },
  ];
  const height = sections.reduce((a, x) => a + x.height, 0) + SHARE_GAP * (sections.length + 1);
  return { width: SHARE_WIDTH, height, sections };
}
