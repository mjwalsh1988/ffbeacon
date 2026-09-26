import type { BoardScope } from "@/lib/ranking-boards";

/** A format the wizard can offer, with what the fallback chain needs. */
export type WizardFormat = {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  display_order: number | null;
};

/** A source that publishes rankings. */
export type WizardSource = {
  slug: string;
  displayName: string;
  supportedFormatSlugs: string[] | null;
};

/** One of a signed-in reader's saved boards, for "run on a saved board". */
export type WizardBoard = {
  id: string;
  name: string;
  scope: BoardScope;
  includesDefenders: boolean;
  formatSlug: string | null;
  playerCount: number;
};

export type WizardLimits = {
  defaultDepthMulti: number;
  defaultDepthSingle: number;
  maxDepth: number;
  capMulti: number;
  capSingle: number;
  retentionHours: number;
};
