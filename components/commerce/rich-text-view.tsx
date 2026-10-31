/**
 * Renders what `parseRichText` produced as real headings, lists and paragraphs. No
 * dangerouslySetInnerHTML anywhere: every string is a React text node.
 *
 * `headingLevel` is 3 under a section's h2 and steps down when the text sits under
 * an h3 already, so the outline never skips.
 */

import { parseRichText } from "@/lib/commerce/rich-text";

export function RichTextView({
  text,
  headingLevel = 3,
}: {
  text: string;
  headingLevel?: 3 | 4;
}) {
  const Heading = `h${headingLevel}` as "h3" | "h4";
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-muted sm:text-[15px]">
      {parseRichText(text).map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <Heading key={i} className="pt-2 text-base font-bold text-ink">
                {block.text}
              </Heading>
            );
          case "paragraph":
            return (
              <p key={i} className="break-words">
                {block.text}
              </p>
            );
          case "bullets":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j} className="break-words">
                    {item}
                  </li>
                ))}
              </ul>
            );
          case "numbered":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j} className="break-words">
                    {item}
                  </li>
                ))}
              </ol>
            );
          case "link":
            return (
              <p key={i}>
                <a
                  href={block.href}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex min-h-11 items-center break-all text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {block.href}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            );
        }
      })}
    </div>
  );
}
