import { ARTICLE_INDEX_LIMIT, buildLlmsFullTxt } from "@/lib/llms/llms-full-txt";
import { loadLlmsData } from "@/lib/llms/data";

/**
 * /llms-full.txt, the companion to /llms.txt.
 *
 * Where /llms.txt is a map of links, this carries the CONTENT: what FF Beacon
 * is, what each tool does, how values and formats and sources relate, the full
 * fantasy football glossary, and an index of the news desk. A model that reads
 * this can answer questions about the site without fetching anything else.
 *
 * The document is built in lib/llms/llms-full-txt.ts, which explains at length
 * what is inlined and what is deliberately left as a canonical retrieval path
 * (rankings and player profiles are the big one: thousands of rows times
 * thirteen formats times four sources, all of it moving nightly).
 *
 * Every read goes through the publishable key, so RLS is the guarantee that
 * nothing private reaches this file.
 */

// Same cadence as /llms.txt and the sitemap. The article index is the only part
// that moves inside an hour, and an hour-old index of a news desk is fine.
export const revalidate = 3600;

export async function GET() {
  const data = await loadLlmsData(ARTICLE_INDEX_LIMIT);

  return new Response(buildLlmsFullTxt(data), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "X-Robots-Tag": "all",
    },
  });
}
