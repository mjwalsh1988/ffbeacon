/**
 * The public Brief edition (plan section 11.2), built the way the guides are
 * built: PageMasthead with the eyebrow "The Beacon Brief" and chips for the
 * period and the format note, the byline under the title, GuideShell with a
 * GuideToc from the section ids, each section opened by GuideSectionHeader
 * with its eyebrow ("Week 2, part 3 of 7"), its icon and its tone alternating
 * cyan and purple, the body through ArticleMarkdown with the blocks inserted
 * after it at their block_refs, the FAQ accordion, "Relays covered", and the
 * Discord call to action.
 *
 * One h1 (the masthead), h2 per section, h3 inside sections only. Every
 * interactive block is a native control with its default state rendered here
 * on the server. Nothing visible is aria-hidden; section icons are decorative.
 *
 * When the stored draft no longer parses, the page still renders: the whole
 * content_md through ArticleMarkdown, no blocks, the same byline. A published
 * edition never 500s over a payload the review page can repair.
 *
 * Server component. The page (app/brief/[slug]/page.tsx) owns <main>, the
 * JSON-LD and the metadata.
 */

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead, type MastheadChip } from "@/components/app-shell/page-masthead";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc, type GuideTocItem } from "@/components/guides/guide-toc";
import { GuideSectionHeader } from "@/components/guides/guide-section-header";
import { ArticleMarkdown } from "@/components/beacon-brief/article-markdown";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import type { PublishedEdition } from "@/lib/brief-desk/edition-data";
import { formatPeriod, formatsPhrase, periodChipLabel, periodLabel } from "@/lib/brief-desk/period";
import { EditionByline } from "./edition-byline";
import { RelaysCovered, RELAYS_COVERED_ID } from "./relays-covered";
import { sectionIcon } from "./section-icons";
import { RenderBlock, type BlockContext } from "./blocks/render-block";

export const FAQ_SECTION_ID = "questions-people-ask";

/**
 * A markdown answer as plain text, for the accordion and the FAQPage schema,
 * which both take one string. Links keep their text, emphasis markers go,
 * paragraphs join with a space.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*[#>]+[ \t]*/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/\*\*|__|[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The FAQ as the accordion and the schema both read it. */
export function editionFaqItems(edition: PublishedEdition): FaqAccordionItem[] {
  return (edition.draft?.faq ?? []).map((f) => ({ question: f.question, answer: markdownToPlainText(f.answer_md) }));
}

export function EditionPage({ edition }: { edition: PublishedEdition }) {
  const { article, draft, meta } = edition;
  const label = periodLabel(edition.week, meta.phase);
  const period = formatPeriod(edition.periodStart, edition.periodEnd);
  const phrase = formatsPhrase(meta.formats);
  const faq = editionFaqItems(edition);
  const sections = draft?.sections ?? [];
  const blocksById = new Map((draft?.blocks ?? []).map((b) => [b.id, b]));
  const relaysCovered = Object.values(edition.relays);

  const chips: MastheadChip[] = [{ label: periodChipLabel(edition.season, edition.week, meta.phase), tone: "cyan" }];
  if (period) chips.push({ label: period, tone: "plain" });
  if (phrase) chips.push({ label: phrase, tone: "purple" });

  const toc: GuideTocItem[] = sections.map((s) => ({ id: s.id, label: s.heading }));
  if (faq.length > 0) toc.push({ id: FAQ_SECTION_ID, label: "Questions people ask", count: faq.length });
  if (relaysCovered.length > 0) toc.push({ id: RELAYS_COVERED_ID, label: "Relays covered", count: relaysCovered.length });

  const ctx: BlockContext = {
    datasets: meta.datasets,
    relays: edition.relays,
    players: edition.players,
    formats: meta.formats,
  };

  const tlDr = draft?.tl_dr ?? article.tlDr;

  return (
    <>
      <SetBreadcrumbLabel value={article.title} />

      <PageBody flush>
        <PageMasthead eyebrow="The Beacon Brief" title={article.title} chips={chips}>
          <EditionByline
            publishedAt={article.publishedAt}
            periodStart={edition.periodStart}
            periodEnd={edition.periodEnd}
            formats={meta.formats}
            sourceDisplay={meta.sourceDisplay}
            formatNote={draft?.format_note ?? null}
          />
        </PageMasthead>
      </PageBody>

      <GuideShell toc={<GuideToc items={toc} />}>
        <article>
          {tlDr && (
            <aside
              aria-label="Summary"
              className="rounded-card p-px"
              style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
            >
              <div className="rounded-[11px] p-4 sm:p-5" style={{ backgroundColor: "#16162A", color: "#F4F4F8" }}>
                <p
                  className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "#22D3EE" }}
                >
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                  The gist
                </p>
                <p className="text-sm font-medium leading-relaxed sm:text-base" style={{ color: "#F4F4F8" }}>
                  {tlDr}
                </p>
              </div>
            </aside>
          )}

          <div className="text-[15px] sm:text-base">
            {draft ? (
              sections.map((s, i) => {
                const tone = i % 2 === 0 ? "cyan" : "purple";
                const icon = sectionIcon(s.icon) ?? undefined;
                return (
                  <section key={s.id} aria-labelledby={s.id} className="mt-12 first:mt-10">
                    <GuideSectionHeader
                      id={s.id}
                      eyebrow={`${label}, part ${i + 1} of ${sections.length}`}
                      heading={s.heading}
                      tone={tone}
                      icon={icon}
                    />
                    <ArticleMarkdown content={s.body_md} />
                    {s.block_refs.map((ref) => {
                      const block = blocksById.get(ref);
                      return block ? <RenderBlock key={`${s.id}-${ref}`} block={block} ctx={ctx} /> : null;
                    })}
                  </section>
                );
              })
            ) : (
              <div className="mt-10">
                {article.contentMd ? <ArticleMarkdown content={article.contentMd} /> : <p className="text-ink-muted">{article.tlDr}</p>}
              </div>
            )}

            {faq.length > 0 && (
              <section aria-labelledby={FAQ_SECTION_ID} className="mt-12">
                <GuideSectionHeader
                  id={FAQ_SECTION_ID}
                  eyebrow={`${label}, questions people ask`}
                  heading="Questions people ask"
                  tone={sections.length % 2 === 0 ? "cyan" : "purple"}
                  icon={sectionIcon("faq") ?? undefined}
                />
                <div className="mt-5">
                  <FaqAccordion items={faq} />
                </div>
              </section>
            )}

            <RelaysCovered relays={relaysCovered} eyebrow={`${label}, the reports`} />
          </div>

          <div className="mt-12 flex flex-wrap gap-3">
            <Link
              href="/brief/editions"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Every edition
            </Link>
            <Link
              href="/brief"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              The latest reports
            </Link>
          </div>
        </article>
      </GuideShell>

      {/* No isMember prop on purpose: an edition is statically rendered and
          revalidated on a timer, and reading Discord membership would make it
          dynamic. The invite variant is right for a page reached from search. */}
      <DiscordCtaSection
        eyebrow="Talk it through"
        heading="What does this week mean for your roster? Ask real people."
        body="Bring this edition into our Discord and real fantasy managers will help you work out what it means for your specific team, free. Curious what else FF Beacon is building? Read about the project."
        className="mt-4 border-t border-line"
      />
    </>
  );
}
