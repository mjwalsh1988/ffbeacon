/**
 * Manually push one or more URLs to IndexNow, via lib/indexnow.ts. This is the
 * "npm run indexnow" the SEO plan calls for (docs/seo/who-should-i-start-and-site-seo-plan.md,
 * section 5): the scheduled callers (Beacon Brief publish, the nightly
 * projection sync, the derived-data rebuild) cover their own writes, so this
 * exists for the one-off cases those do not, chiefly the two slug moves,
 * where a redirect target needs a manual ping.
 *
 * Run:
 *   npm run indexnow -- /brief
 *   npm run indexnow -- /brief https://ffbeacon.com/rankings
 *
 * Arguments may be relative paths ("/brief") or absolute URLs on our own
 * host; submitIndexNow resolves relative paths against SITE.url and drops
 * anything on a different host. Running with no arguments is refused rather
 * than silently doing nothing.
 */

import { submitIndexNow } from "../lib/indexnow";

async function main() {
  const urls = process.argv.slice(2);

  if (urls.length === 0) {
    console.error("Usage: npm run indexnow -- <url> [url...]");
    console.error("Pass at least one path (\"/brief\") or absolute URL on our own host.");
    process.exit(1);
  }

  console.log(`Submitting ${urls.length} URL(s) to IndexNow:`);
  for (const url of urls) {
    console.log(`  ${url}`);
  }

  const result = await submitIndexNow(urls);

  if (result.ok) {
    console.log(`Submitted (status ${result.status}).`);
  } else {
    console.error(`Not submitted (status ${result.status}).`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
