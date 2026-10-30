/**
 * Portrait share card height (plan 11.3). Pure.
 *
 * The card is as tall as its sections, so a league with more starting slots
 * (an IDP league) gets a taller card rather than a clipped one. The sections
 * are the report card's: the FF Beacon brand band, the letterhead with the
 * grade box, then the ruled two-column sections in the page's order (less
 * the ones a picture cannot carry), and the footer.
 */

export const SHARE_WIDTH = 1080;
export const SHARE_GAP = 40;

export const SECTION_HEIGHT = {
  brand: 110,
  letterhead: 215,
  grades: 130,
  lineupRow: 52,
  lineupHead: 26,
  shares: 170,
  calls: 250,
  movers: 170,
  // The rule and padding plus slack; the rows add 44 each.
  capitalBase: 30,
  capitalSeason: 44,
  capitalRedraft: 100,
  priorities: 300,
  strategy: 310,
  partners: 80,
  footer: 130,
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

/**
 * Line heights the portrait draws at: the first priority 30px, the rest 24px,
 * strategy 20px. The title block is the rule plus the section's top padding;
 * the section label sits in the margin column and takes no height of its own.
 */
export const SHARE_LINE = { titleBlock: 24, priorityFirst: 38, priorityRest: 31, priorityGap: 10, strategyLabel: 28, strategyLine: 25, strategyGap: 12 } as const;

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
    { key: "brand", height: h.brand },
    { key: "letterhead", height: h.letterhead },
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
