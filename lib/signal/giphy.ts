// Normalization for GIPHY search responses. Used only by the server-side proxy
// route (/api/signal/gif/search); the GIPHY_API_KEY and the raw GIPHY payload
// never reach the client. We forward only the small normalized shape below, which
// keeps the response payload tiny regardless of how many renditions GIPHY returns.

export type GiphyResult = {
  id: string;
  // Animated rendition (a .gif/.webp that plays). Shown only when the viewer
  // presses play; the picker and renderer default to the static still.
  url: string;
  // Static still frame for the default (no-motion) display.
  preview_url: string;
  // Resolved accessible text: GIPHY alt_text if present, else title, else "".
  // The picker requires the user to supply one when this is empty before insert.
  alt: string;
  width: number;
  height: number;
};

export type GiphySearchResult = {
  results: GiphyResult[];
  hasMore: boolean;
};

type GiphyRendition = {
  url?: unknown;
  width?: unknown;
  height?: unknown;
};

type GiphyImages = Record<string, GiphyRendition | undefined>;

type GiphyGif = {
  id?: unknown;
  alt_text?: unknown;
  title?: unknown;
  images?: GiphyImages;
};

function rendition(images: GiphyImages, key: string): GiphyRendition | null {
  const r = images[key];
  if (!r || typeof r.url !== "string" || !/^https:\/\//.test(r.url)) return null;
  return r;
}

function dim(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// Animated rendition + its matching static still, in preference order. Pairing the
// two from the same family keeps the stored width/height (taken from the animated
// frame) consistent with the still that is shown by default, avoiding a layout
// shift when the GIF is played.
const RENDITION_FAMILIES: { animated: string; still: string }[] = [
  { animated: "fixed_width", still: "fixed_width_still" },
  { animated: "downsized", still: "downsized_still" },
  { animated: "fixed_height", still: "fixed_height_still" },
];

/**
 * Pick a paired animated rendition + STATIC still. We prefer fixed_width (a
 * predictable ~200px size). A result with no usable animated+still pair is dropped
 * (we never render a GIF we cannot pause).
 */
function normalizeGif(gif: GiphyGif): GiphyResult | null {
  const id = typeof gif.id === "string" ? gif.id : "";
  if (!id) return null;
  const images = gif.images ?? {};

  let animated: GiphyRendition | null = null;
  let still: GiphyRendition | null = null;
  for (const family of RENDITION_FAMILIES) {
    const a = rendition(images, family.animated);
    const s = rendition(images, family.still);
    if (a && s) {
      animated = a;
      still = s;
      break;
    }
  }
  if (!animated || !still) return null;

  const width = dim(animated.width);
  const height = dim(animated.height);
  if (width < 1 || height < 1) return null;

  const altText = typeof gif.alt_text === "string" ? gif.alt_text.trim() : "";
  const title = typeof gif.title === "string" ? gif.title.trim() : "";
  const alt = altText || title || "";

  return {
    id,
    url: animated.url as string,
    preview_url: still.url as string,
    alt,
    width,
    height,
  };
}

/** Normalize a GIPHY /v1/gifs/search response into our minimal shape plus a
 * has-more flag derived from GIPHY's pagination block (for offset paging). */
export function normalizeGiphySearch(payload: unknown): GiphySearchResult {
  const body = (payload ?? {}) as {
    data?: unknown;
    pagination?: { total_count?: unknown; count?: unknown; offset?: unknown };
  };
  const data = Array.isArray(body.data) ? (body.data as GiphyGif[]) : [];
  const results: GiphyResult[] = [];
  for (const gif of data) {
    const norm = normalizeGif(gif);
    if (norm) results.push(norm);
  }

  const p = body.pagination ?? {};
  const total = Number(p.total_count);
  const count = Number(p.count);
  const offset = Number(p.offset);
  const hasMore =
    Number.isFinite(total) && Number.isFinite(count) && Number.isFinite(offset)
      ? offset + count < total
      : false;

  return { results, hasMore };
}
