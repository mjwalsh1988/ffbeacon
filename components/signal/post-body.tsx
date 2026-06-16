import { Fragment } from "react";

/**
 * Render a plain-text post/comment body, turning bare http(s) URLs into safe
 * anchors. We never use dangerouslySetInnerHTML: the text is split on a URL
 * pattern and rendered as alternating text nodes and <a> elements, so user input
 * can never inject markup. Links open in a new tab with rel="noopener noreferrer"
 * and a screen-reader "(opens in a new tab)" note, matching LinksBlock.
 *
 * Whitespace and line breaks are preserved (whitespace-pre-wrap) so multi-line
 * posts read as written.
 */

// Match http(s) URLs. The trailing class stops the match before sentence
// punctuation that commonly abuts a URL.
const URL_RE = /(https?:\/\/[^\s<>"')]+)/gi;

export function PostBody({ body }: { body: string }) {
  const parts = body.split(URL_RE);

  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
      {parts.map((part, index) => {
        if (index % 2 === 1 && /^https?:\/\//i.test(part)) {
          return (
            <Fragment key={index}>
              <a
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {part}
              </a>
              <span className="sr-only">(opens in a new tab)</span>
            </Fragment>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </p>
  );
}
