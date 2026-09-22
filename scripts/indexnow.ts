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
 *
 * NEXT_PUBLIC_SITE_URL DECIDES WHICH HOST THIS SUBMITS FOR, and .env.local on
 * a developer machine points it at localhost. Override it for the run:
 *
 *   NEXT_PUBLIC_SITE_URL=https://ffbeacon.com npm run indexnow -- /waiver-wire
 *
 * Without that, every public URL is dropped as "a different host" and the run
 * now says so rather than reporting a bare status 0.
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
    return;
  }

  // Say WHY. The common one on a developer machine is `local-host`: .env.local
  // points NEXT_PUBLIC_SITE_URL at localhost, so every public URL is dropped
  // as "a different host" and the run used to print a bare status 0.
  const explain: Record<string, string> = {
    "no-key": "INDEXNOW_KEY is not set in the environment.",
    "local-host":
      "NEXT_PUBLIC_SITE_URL points at a local host, so no public URL could be submitted. Re-run with NEXT_PUBLIC_SITE_URL set to the public site.",
    "nothing-to-submit":
      "No URL resolved to our own host. Pass paths starting with a slash, or absolute URLs on the public site.",
    "request-failed": "The request to IndexNow failed. See the error above.",
  };
  const why = result.reason ? (explain[result.reason] ?? result.reason) : null;
  console.error(`Not submitted (status ${result.status}).`);
  if (why) console.error(why);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
