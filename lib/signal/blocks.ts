// Signal profile block model. Isomorphic (no server-only imports) so the builder
// (client) and the public resolver (server) share one source of truth for block
// shapes, singleton rules, column placement, the seeder, and (de)serialization.
//
// Blocks live in signals.layout_config jsonb as { version, blocks: [...] }. The
// layout (Layout A vs Layout B) lives in the separate signals.layout column. No
// migration is required: both columns already exist (migration 0059).
//
// GRACEFUL DEGRADE (Phase 5, non-negotiable): a block is only a REFERENCE. The
// server-side resolver (lib/signal-profile.ts) drops any block whose referenced
// entity is gone or no longer public, so a board_top_n for a board later made
// private, and a league_card for a league later un-synced, both render nothing on
// the public page (never error, never leak). The shapes here carry only ids; the
// resolver attaches the live data.

export type ProfileLayout = "feed" | "sidebar" | "spotlight";

/** Layout A = "feed" (single column). Layout B = "sidebar" (full-width header
 * above two columns). Layout C = "spotlight" (centered landing page: editorial
 * hero, beacon-card stack, stats strip, Wall behind a disclosure). All three are
 * permitted by the signals.layout CHECK (migration 0059).
 *
 * PROFILE_LAYOUTS is the set offered in the builder; the builder exposes Layout C
 * in Phase 6.3, so spotlight joins this list there. isProfileLayout / resolveLayout
 * already accept spotlight so a stored value renders correctly. */
export const PROFILE_LAYOUTS: readonly ProfileLayout[] = ["feed", "sidebar"];
export const DEFAULT_LAYOUT: ProfileLayout = "feed";

export function isProfileLayout(value: unknown): value is ProfileLayout {
  return value === "feed" || value === "sidebar" || value === "spotlight";
}

/** Coerce any stored layout value to a known layout, defaulting to Layout A. */
export function resolveLayout(value: unknown): ProfileLayout {
  return isProfileLayout(value) ? value : DEFAULT_LAYOUT;
}

export type SignalBlockType =
  | "about"
  | "text"
  | "links"
  | "favorites"
  | "board_top_n"
  | "league_card";

const BLOCK_TYPES: readonly SignalBlockType[] = [
  "about",
  "text",
  "links",
  "favorites",
  "board_top_n",
  "league_card",
];

/** about, links, and favorites are singletons: at most one of each per profile.
 * The add-menu disables them once present; the coercer keeps only the first. */
export const SINGLETON_BLOCK_TYPES = ["about", "links", "favorites"] as const;

export function isSingletonBlockType(type: SignalBlockType): boolean {
  return (SINGLETON_BLOCK_TYPES as readonly string[]).includes(type);
}

export const TEXT_BLOCK_MAX = 2000;
export const MAX_BLOCKS = 50;

/**
 * A block is a positioning reference, not a content store (except `text`, which
 * owns its copy). `about` renders signals.bio (single source of truth, so editing
 * the bio updates the About block and "nothing is lost" on seed). `links` and
 * `favorites` render the existing signals.links / favorite_* data. `board_top_n`
 * and `league_card` reference an entity by id and degrade to nothing when it is
 * no longer publicly available.
 */
export type SignalBlock =
  | { id: string; type: "about" }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "links" }
  | { id: string; type: "favorites" }
  | { id: string; type: "board_top_n"; boardId: string }
  | { id: string; type: "league_card"; sleeperLeagueId: string };

export type LayoutConfig = { version: number; blocks: SignalBlock[] };
export const LAYOUT_CONFIG_VERSION = 1;

export type BlockColumn = "main" | "sidebar";

/**
 * Auto-placement for Layout B (sidebar). Blocks are NOT manually assigned to a
 * column (the builder is a single one-dimensional reorderable list); column is
 * derived from type so the builder preview and the public render agree. In Layout
 * A every block renders in one column in list order, so this is ignored there.
 */
export function blockColumn(type: SignalBlockType): BlockColumn {
  return type === "board_top_n" || type === "league_card" ? "main" : "sidebar";
}

/** New unique block id. Uses crypto.randomUUID where available (modern Node +
 * browsers), with a non-crypto fallback so the helper never throws. */
export function newBlockId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // fall through to the non-crypto id below
  }
  return `blk_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function isBlockType(value: unknown): value is SignalBlockType {
  return (
    typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value)
  );
}

/** Coerce one untrusted raw value into a SignalBlock, or null when it cannot be a
 * valid block. Missing/invalid ids are regenerated so a block always has one. */
function coerceBlock(raw: unknown): SignalBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isBlockType(r.type)) return null;
  const id = typeof r.id === "string" && r.id.length > 0 ? r.id : newBlockId();

  switch (r.type) {
    case "about":
    case "links":
    case "favorites":
      return { id, type: r.type };
    case "text": {
      const text = typeof r.text === "string" ? r.text.slice(0, TEXT_BLOCK_MAX) : "";
      return { id, type: "text", text };
    }
    case "board_top_n": {
      const boardId = typeof r.boardId === "string" ? r.boardId : "";
      if (!boardId) return null;
      return { id, type: "board_top_n", boardId };
    }
    case "league_card": {
      const sleeperLeagueId =
        typeof r.sleeperLeagueId === "string" ? r.sleeperLeagueId : "";
      // Sleeper ids are digit strings; reject anything else defensively.
      if (!/^\d{1,32}$/.test(sleeperLeagueId)) return null;
      return { id, type: "league_card", sleeperLeagueId };
    }
    default:
      return null;
  }
}

/**
 * Coerce an untrusted blocks array into a clean SignalBlock[]: drops malformed
 * entries, enforces single occurrence of each singleton type (keeps the first),
 * dedupes block ids (keeps the first), and caps at MAX_BLOCKS. Used on both the
 * read path (resolver) and the write path (saveLayout).
 */
export function coerceBlocks(value: unknown): SignalBlock[] {
  if (!Array.isArray(value)) return [];
  const out: SignalBlock[] = [];
  const seenSingleton = new Set<SignalBlockType>();
  const seenId = new Set<string>();
  for (const raw of value) {
    if (out.length >= MAX_BLOCKS) break;
    const block = coerceBlock(raw);
    if (!block) continue;
    if (seenId.has(block.id)) {
      // A duplicate id would break React keys and reorder; regenerate it.
      block.id = newBlockId();
    }
    if (isSingletonBlockType(block.type)) {
      if (seenSingleton.has(block.type)) continue;
      seenSingleton.add(block.type);
    }
    seenId.add(block.id);
    out.push(block);
  }
  return out;
}

/** Parse the stored signals.layout_config jsonb into a clean block list. */
export function parseLayoutConfig(value: unknown): SignalBlock[] {
  if (!value || typeof value !== "object") return [];
  return coerceBlocks((value as { blocks?: unknown }).blocks);
}

/**
 * Whether the stored layout_config has ever been configured. A configured layout
 * always carries a `blocks` array (serializeLayoutConfig writes one), even when
 * empty. This distinguishes an owner who intentionally removed every block (an
 * empty `blocks` array, which must render nothing) from an un-customized profile
 * (the default `{}` with no `blocks` key, which seeds defaults). Without this an
 * intentionally-empty layout would wrongly re-seed.
 */
export function hasStoredBlocks(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

/** Build the jsonb payload to persist for a block list. */
export function serializeLayoutConfig(blocks: SignalBlock[]): LayoutConfig {
  return { version: LAYOUT_CONFIG_VERSION, blocks: coerceBlocks(blocks) };
}

/** Inputs the seeder needs, derived from the profile bundle. */
export type SeedInput = {
  hasBio: boolean;
  hasFavorites: boolean;
  hasLinks: boolean;
  /** profile_visible boards, already in display order (primary first). */
  boardIds: string[];
  /** synced featured leagues, already in the owner's chosen order. */
  sleeperLeagueIds: string[];
};

/**
 * Default block list for a profile that has not been customized yet (empty
 * layout_config). Seeds an `about` block when a bio exists so the bio is never
 * lost, then the owner's boards and leagues, then favorites and links. The owner
 * can reorder freely afterward. Producing this on first render keeps existing
 * live profiles looking the same until they customize.
 */
export function seedBlocksFromProfile(input: SeedInput): SignalBlock[] {
  const blocks: SignalBlock[] = [];
  if (input.hasBio) blocks.push({ id: newBlockId(), type: "about" });
  for (const boardId of input.boardIds) {
    blocks.push({ id: newBlockId(), type: "board_top_n", boardId });
  }
  for (const sleeperLeagueId of input.sleeperLeagueIds) {
    blocks.push({ id: newBlockId(), type: "league_card", sleeperLeagueId });
  }
  if (input.hasFavorites) blocks.push({ id: newBlockId(), type: "favorites" });
  if (input.hasLinks) blocks.push({ id: newBlockId(), type: "links" });
  return blocks;
}
