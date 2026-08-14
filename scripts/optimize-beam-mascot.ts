/**
 * Turn the full-size BEAM mascot artwork into the two web assets the Ask BEAM
 * panel uses.
 *
 * Run: npm run img:beam-mascot -- --in "C:/path/to/beam.png"
 *
 * Source art is a ~1.2 MB transparent PNG, which is roughly thirty times more
 * bytes than a panel that opens on a phone should ever pay for. Two outputs,
 * both WebP with the alpha channel kept:
 *
 *   public/img/beam-mascot.webp   full mascot, transparent margin trimmed,
 *                                 512 px wide. The empty-state greeting.
 *   public/img/beam-avatar.webp   head crop, 192 px square. The small avatar
 *                                 beside each answer and in the panel header.
 *
 * The avatar is a crop rather than a downscale of the whole mascot: at 32 px the
 * full body renders the face about eight pixels tall, which is a smudge. The
 * crop box is expressed as a fraction of the source so re-exported art at a
 * different resolution still lands on the head.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Head crop as fractions of the source square: left, top, width, height. */
const HEAD_BOX = { left: 285 / 1254, top: 180 / 1254, size: 730 / 1254 };

const MASCOT_WIDTH = 512;
const AVATAR_SIZE = 192;

function readInputPath(): string {
  const argv = process.argv.slice(2);
  const flag = argv.indexOf("--in");
  const value = flag >= 0 ? argv[flag + 1] : undefined;
  if (!value) {
    console.error(
      'Usage: npm run img:beam-mascot -- --in "C:/path/to/beam.png"\n' +
        "The source artwork lives outside the repo, so there is no default.",
    );
    process.exit(1);
  }
  return value;
}

async function main() {
  const input = readInputPath();
  const outDir = path.join(process.cwd(), "public", "img");
  await mkdir(outDir, { recursive: true });

  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read image dimensions from ${input}`);
  }

  // Full mascot. trim() drops the transparent border so the visible art fills
  // the box it is given rather than floating in dead space.
  const mascotPath = path.join(outDir, "beam-mascot.webp");
  const mascot = await sharp(input)
    .trim({ threshold: 1 })
    .resize({ width: MASCOT_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, alphaQuality: 90 })
    .toFile(mascotPath);

  // Head crop.
  const avatarPath = path.join(outDir, "beam-avatar.webp");
  const avatar = await sharp(input)
    .extract({
      left: Math.round(HEAD_BOX.left * meta.width),
      top: Math.round(HEAD_BOX.top * meta.height),
      width: Math.round(HEAD_BOX.size * meta.width),
      height: Math.round(HEAD_BOX.size * meta.height),
    })
    .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
    .webp({ quality: 84, effort: 6, alphaQuality: 90 })
    .toFile(avatarPath);

  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;
  console.log(`source        ${input} (${meta.width}x${meta.height})`);
  console.log(
    `beam-mascot   ${mascot.width}x${mascot.height}  ${kb(mascot.size)}`,
  );
  console.log(
    `beam-avatar   ${avatar.width}x${avatar.height}  ${kb(avatar.size)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
