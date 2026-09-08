/**
 * Shrink the brand PNGs that are served to readers, crawlers and inboxes.
 *
 * Run: npm run img:brand
 *
 * The speed audit (docs/performance/site-speed-audit-and-plan.md, 4.4) found
 * three assets sized for print and served on every first visit:
 *
 *   ff-beacon-logo.png        782x749, the JSON-LD organization logo on every
 *                             article and guide, so crawlers fetch it.
 *   ff-beacon-logo-email.png  1094x1094, embedded in every receipt, Signal
 *                             email and Discord post, and rendered at 78 px.
 *   apple-touch-icon.png      180x180 already, but 48 kB of it.
 *
 * Nothing here needs more than 512 px: the largest consumer draws the logo at
 * 78 px, and Google's structured-data guidance wants at least 112 px. The
 * script is idempotent, because `withoutEnlargement` means a second run on an
 * already-shrunk file is a re-encode rather than an upscale, and it writes
 * through a temp file since sharp cannot read and write the same path.
 */

import { rename, unlink } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/** Longest edge, in pixels, for the two logo PNGs. */
const LOGO_MAX = 512;

interface Job {
  file: string;
  maxEdge: number;
  /** Palette quantisation. The marks are flat brand colors, not photographs. */
  colors: number;
}

const JOBS: Job[] = [
  { file: "ff-beacon-logo.png", maxEdge: LOGO_MAX, colors: 128 },
  { file: "ff-beacon-logo-email.png", maxEdge: LOGO_MAX, colors: 128 },
  { file: "apple-touch-icon.png", maxEdge: 180, colors: 128 },
];

async function shrink(job: Job): Promise<void> {
  const dir = path.join(process.cwd(), "public", "img");
  const target = path.join(dir, job.file);
  const temp = `${target}.tmp`;

  const before = statSync(target).size;
  const meta = await sharp(target).metadata();

  await sharp(target)
    .resize({
      width: job.maxEdge,
      height: job.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: true, colors: job.colors, effort: 10 })
    .toFile(temp);

  const after = statSync(temp).size;
  if (after >= before) {
    // Already at or below what this pass can achieve. Leave the committed file
    // alone rather than churning bytes for nothing.
    await unlink(temp);
    console.log(
      `${job.file.padEnd(26)} unchanged, already ${(before / 1024).toFixed(1)} kB`,
    );
    return;
  }

  await rename(temp, target);
  const out = await sharp(target).metadata();
  console.log(
    `${job.file.padEnd(26)} ${meta.width}x${meta.height} ${(before / 1024).toFixed(1)} kB` +
      `  ->  ${out.width}x${out.height} ${(after / 1024).toFixed(1)} kB`,
  );
}

async function main(): Promise<void> {
  for (const job of JOBS) {
    await shrink(job);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
