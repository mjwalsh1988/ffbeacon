/**
 * The editor's take (plan section 23.5): the owner's own two or three
 * sentences, written on the review page and placed right under the summary.
 * It is the one part of an edition no run may write (the validator refuses a
 * draft that carries one), so it is labelled with the owner's name.
 *
 * Renders nothing when the edition has no take. Server component.
 */

import { PenLine } from "lucide-react";
import { ArticleMarkdown } from "@/components/beacon-brief/article-markdown";

export function EditorTake({ take }: { take: string | null | undefined }) {
  if (!take || !take.trim()) return null;
  return (
    <aside aria-labelledby="editor-take-label" className="mt-6 rounded-card border border-brand-purple/50 bg-brand-purple/10 p-4 sm:p-5">
      <p id="editor-take-label" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple-light">
        <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
        Editor&apos;s take, Michael Walsh
      </p>
      <div className="mt-2 text-ink">
        <ArticleMarkdown content={take} />
      </div>
    </aside>
  );
}
