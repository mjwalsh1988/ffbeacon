/**
 * The shared furniture every generated share image needs: the brand typeface,
 * the beacon mark, and one way to pull a remote photo in without letting it
 * take the whole card down.
 *
 * SERVER ONLY, and node runtime only. It reads from the filesystem at module
 * load and it holds an in-process cache, neither of which means anything in a
 * browser.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COPY PER ROUTE
 * There are two share images now (the matchup scoreboard and the team card) and
 * there will be more. A font read, a base64 mark and a "fetch this photo but
 * never let it throw" helper are the three things all of them need, and three
 * copies is how one card ends up in Geist and the next one in whatever satori
 * falls back to.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The two weights, read once per process.
 *
 * SATORI CANNOT USE WOFF2, which is the format `next/font` ships and the reason
 * these are TTFs. They are copied into `assets/og-fonts/` rather than read out
 * of `node_modules/geist`, because Vercel's file tracing follows imports and
 * nothing here is an import: a path into node_modules resolved at runtime is a
 * path that exists in development and is missing in production. The copy is
 * listed in `outputFileTracingIncludes` in next.config.ts, which is what
 * actually puts the bytes in the bundle.
 *
 * TWO WEIGHTS, NOT FIVE. Black carries every name, score and heading, which is
 * where the weight is doing work; Medium carries everything else. Each one is
 * about 128KB and satori parses it per render, so a third weight would be a
 * third parse for a difference nobody looking at a phone screenshot can see.
 *
 * `readFileSync` at module scope on purpose: it happens once per cold start,
 * before any request, rather than once per image.
 */
const FONT_DIR = join(process.cwd(), "assets", "og-fonts");

function readFont(file: string): Buffer {
  return readFileSync(join(FONT_DIR, file));
}

const GEIST_BLACK = readFont("Geist-Black.ttf");
const GEIST_MEDIUM = readFont("Geist-Medium.ttf");

/** The family name every share image sets in `fontFamily`. */
export const OG_FONT_FAMILY = "Geist";

/**
 * Pass straight into `new ImageResponse(el, { fonts: OG_FONTS })`.
 *
 * Satori picks a face by the numeric `fontWeight` on the element, so a card
 * asks for 900 where it wants the heavy one and 500 everywhere else. Anything
 * in between resolves to the nearer of the two rather than being synthesised:
 * satori does not fake a weight, so a 700 would silently render as one of these
 * anyway. Ask for 500 or 900 and mean it.
 */
export const OG_FONTS = [
  { name: OG_FONT_FAMILY, data: GEIST_BLACK, weight: 900 as const, style: "normal" as const },
  { name: OG_FONT_FAMILY, data: GEIST_MEDIUM, weight: 500 as const, style: "normal" as const },
];

/**
 * The beacon mark, inlined.
 *
 * The 96px asset rather than the full-size one: it renders at 40 to 56px on
 * every card, and the large version is 58KB of detail nobody sees. Read once,
 * encoded once, and handed to satori as a data URI so drawing the logo costs no
 * network call.
 */
const MARK_BYTES = readFileSync(
  join(process.cwd(), "public", "img", "ff-beacon-mark-96.png"),
);
export const OG_LOGO_DATA_URI = `data:image/png;base64,${MARK_BYTES.toString("base64")}`;

/** The wordmark under the logo on every share image. */
export const OG_WORDMARK = "FFBeacon.com";

/**
 * The two formats satori decodes, by MAGIC NUMBER rather than by header.
 *
 * Sleeper's CDN lies: every avatar and photo comes back as
 * `content-type: image/png` and a good number of them are JPEG bytes, EXIF
 * block and all. Labelling those `image/png` in a data URI produces a card
 * where every photo is an empty box, because satori decodes by the type it is
 * given, finds a JPEG behind a PNG label, and silently draws nothing. Two bytes
 * of checking is the whole fix, and it also means a format satori cannot handle
 * falls back to a placeholder instead of vanishing.
 */
export function sniffImageType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** A player photo is around 20KB and an avatar a few. This is generous. */
const MAX_IMAGE_BYTES = 512_000;

/**
 * Remote images already pulled in this process, including the misses.
 *
 * A null is cached as deliberately as a hit: a team defence has no headshot and
 * answers 403 every time, and without the negative entry every render of every
 * card in the process would ask again and wait for the same refusal.
 *
 * Bounded, and evicted oldest-first. A long-lived process rendering many cards
 * would otherwise hold every photo it had ever seen. Map preserves insertion
 * order, which is what makes the eviction one line.
 */
const imageCache = new Map<string, string | null>();
const IMAGE_CACHE_LIMIT = 400;

function remember(url: string, value: string | null): string | null {
  if (imageCache.size >= IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(url, value);
  return value;
}

/**
 * One remote image as a data URI, or null.
 *
 * FETCHED HERE RATHER THAN HANDED TO SATORI AS A URL, and the difference
 * matters: satori loading a remote image is a network call inside the renderer,
 * and one slow or missing photo takes the WHOLE CARD down rather than one box.
 * Pulling the bytes first means a failed photo costs a placeholder and nothing
 * else. Nothing in here throws.
 *
 * NO REDIRECTS. Every caller pins a host it trusts and builds the path from a
 * validated id, so nothing we construct can leave that host. Following a 3xx
 * would hand that decision to the CDN, and a 3xx is not how any of these are
 * served, so it is capability with no use.
 */
export async function loadRemoteImage(
  url: string | null,
  { timeoutMs = 2500 }: { timeoutMs?: number } = {},
): Promise<string | null> {
  if (!url) return null;
  const key = url;
  const cached = imageCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (!response.ok) return remember(key, null);

    // Checked against the declared length FIRST, so an oversized body is
    // refused rather than buffered whole and then thrown away.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      return remember(key, null);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return remember(key, null);
    }

    const type = sniffImageType(bytes);
    if (!type) return remember(key, null);

    // HANDED TO SATORI AT FULL SIZE, DELIBERATELY.
    //
    // The obvious optimisation here is to downscale each photo to the box it is
    // drawn in, on the theory that satori decodes whatever it is given into a
    // full bitmap. It was built, measured against a real twenty-player card, and
    // taken back out: three runs at 3.15s with the resize against three at 3.25s
    // without it, which is noise. The render cost of this card is satori laying
    // out several hundred nodes, not decoding photos, so a native image
    // dependency in this path would have bought complexity and nothing else.
    // Measure again before adding it back.
    return remember(key, `data:${type};base64,${bytes.toString("base64")}`);
  } catch {
    return remember(key, null);
  }
}

/**
 * Every image a card needs, at once.
 *
 * One `Promise.all` rather than a loop, because twenty photos fetched in
 * sequence is twenty round trips of latency stacked end to end and the same
 * twenty in parallel is one. Order is preserved, so a caller can zip the result
 * back against its own list.
 */
export async function loadRemoteImages(
  urls: (string | null)[],
  options: { timeoutMs?: number } = {},
): Promise<(string | null)[]> {
  return Promise.all(urls.map((url) => loadRemoteImage(url, options)));
}

const SLEEPER_CDN = "https://sleepercdn.com";

/** What Sleeper's own player ids look like. Digits only, and short. */
const PLAYER_ID_PATTERN = /^[0-9]{1,12}$/;
/** An NFL team code, which is how Sleeper ids a team defence. */
const TEAM_CODE_PATTERN = /^[A-Za-z]{2,4}$/;

/**
 * The photo for one roster slot, whatever kind of thing is in it.
 *
 * A player is a headshot; a TEAM DEFENCE is a team logo, on a different path
 * entirely. Sleeper answers 403 for a defence on the player path, so without
 * the second branch every DEF row on every card would be a blank square.
 *
 * The id is VALIDATED rather than trusted. It arrives from data we stored from
 * an external source, so a value containing a slash or a dot would let a stored
 * string decide which path, or which host, an image points at. Null in, null
 * out, and null for anything that does not look like an id.
 */
export function sleeperPlayerImageUrl(
  sleeperId: string | null | undefined,
  position?: string | null,
): string | null {
  if (typeof sleeperId !== "string") return null;
  const id = sleeperId.trim();

  if (PLAYER_ID_PATTERN.test(id)) {
    return `${SLEEPER_CDN}/content/nfl/players/${id}.jpg`;
  }
  // A defence's "player id" IS the team code, which is also how the logo path
  // is keyed. The position check is belt and braces: an id that is letters and
  // is not a defence has nothing to point at either way.
  if (TEAM_CODE_PATTERN.test(id) && (!position || /^(DEF|DST)$/i.test(position))) {
    return `${SLEEPER_CDN}/images/team_logos/nfl/${id.toLowerCase()}.png`;
  }
  return null;
}
