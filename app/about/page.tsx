import type { Metadata } from "next";
import Link from "next/link";
import { AuthorPortrait } from "@/components/author-portrait";

export const metadata: Metadata = {
  title: "About FF Beacon",
  description:
    "FF Beacon is fantasy football built accessibility-first, for casual fans and screen reader users alike.",
};

export default function AboutPage() {
  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">About</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Fantasy that finally works for everyone.
          </h1>
        </div>
      </header>
      <article className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-lg leading-relaxed text-ink-muted sm:px-6 lg:px-8">
        <p>
          FF Beacon exists to close two gaps at once. Casual fantasy players have nowhere to learn
          how the analytics work without wading through jargon. And almost every fantasy app out
          there is borderline unusable with a screen reader.
        </p>
        <p>
          That is not a niche complaint. It blocks a whole community from playing the game well.
          FF Beacon is built accessibility-first from day one. Real semantic HTML, real ARIA,
          keyboard everywhere, contrast that meets WCAG AAA where possible, and writing that
          actually explains what target share means before assuming you already know.
        </p>
        <p>
          The rest of the site is just good fantasy work: clean rankings, fast Sleeper sync, a
          FAAB calculator that uses market value plus your real need, and player pages that are
          built to be skimmed by ear, not just by eye.
        </p>
        <div className="flex flex-col items-start gap-5 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-center sm:gap-6">
          <Link
            href="/author/michael"
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
            aria-label="Read Michael's full story on the author page"
          >
            <AuthorPortrait size={112} />
          </Link>
          <p className="text-base leading-relaxed text-ink">
            Built by{" "}
            <Link
              href="/author/michael"
              className="text-brand-cyan underline-offset-4 hover:text-brand-purple hover:underline"
            >
              Michael
            </Link>
            , who has played fantasy for 20 years and went from 1 dynasty league to 50 in a single
            year by leaning on stats over visuals. The full story is on his{" "}
            <Link
              href="/author/michael"
              className="text-brand-cyan underline-offset-4 hover:text-brand-purple hover:underline"
            >
              author page
            </Link>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
