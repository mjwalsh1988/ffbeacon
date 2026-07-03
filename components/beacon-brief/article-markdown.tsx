import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for Beacon Brief article bodies.
 *
 * The article body (content_md) is AI-authored Markdown. Rather than pull in a
 * parser dependency, we render a focused subset to real React elements and NEVER
 * touch dangerouslySetInnerHTML, so no source string can inject markup. Links
 * are href-validated (http(s), mailto, or site-relative only); anything else
 * degrades to plain text.
 *
 * Supported: ATX headings (#..######), paragraphs, unordered/ordered lists,
 * blockquotes, horizontal rules, and inline bold / italic / inline-code / links.
 */

/** Allow only safe link targets. Rejects javascript:, data:, and friends. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  if (url.startsWith("/")) return url;
  return null;
}

type InlinePattern = "code" | "link" | "bold" | "italic";

const INLINE_MATCHERS: Array<{ name: InlinePattern; re: RegExp }> = [
  { name: "code", re: /`([^`]+)`/ },
  { name: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  // Bold before italic so `**x**` is not consumed as italic first.
  { name: "bold", re: /\*\*([^*]+?)\*\*|__([^_]+?)__/ },
  { name: "italic", re: /\*([^*]+?)\*|(?<![A-Za-z0-9])_([^_]+?)_(?![A-Za-z0-9])/ },
];

/** Parse inline Markdown in `text` into React nodes. Recursive so emphasis and
 * links can nest. `key` keeps React keys stable and unique per branch. */
function parseInline(text: string, key: string): ReactNode[] {
  if (!text) return [];

  let earliest: { name: InlinePattern; match: RegExpExecArray } | null = null;
  for (const matcher of INLINE_MATCHERS) {
    const m = matcher.re.exec(text);
    if (m && (earliest === null || m.index < earliest.match.index)) {
      earliest = { name: matcher.name, match: m };
    }
  }

  if (!earliest) return [text];

  const { name, match } = earliest;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const nodeKey = `${key}-${match.index}`;
  const nodes: ReactNode[] = [];

  if (before) nodes.push(<Fragment key={`${nodeKey}-b`}>{before}</Fragment>);

  if (name === "code") {
    nodes.push(
      <code
        key={nodeKey}
        className="rounded bg-base px-1.5 py-0.5 font-mono text-[0.85em] text-brand-cyan"
      >
        {match[1]}
      </code>,
    );
  } else if (name === "link") {
    const href = safeHref(match[2]);
    const inner = parseInline(match[1], `${nodeKey}-i`);
    if (href) {
      const external = /^https?:\/\//i.test(href);
      nodes.push(
        <a
          key={nodeKey}
          href={href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {inner}
          {external && <span className="sr-only"> (opens in a new tab)</span>}
        </a>,
      );
    } else {
      // Unsafe scheme: keep the visible text, drop the link.
      nodes.push(<Fragment key={nodeKey}>{inner}</Fragment>);
    }
  } else if (name === "bold") {
    const inner = match[1] ?? match[2] ?? "";
    nodes.push(
      <strong key={nodeKey} className="font-semibold text-ink">
        {parseInline(inner, `${nodeKey}-i`)}
      </strong>,
    );
  } else if (name === "italic") {
    const inner = match[1] ?? match[2] ?? "";
    nodes.push(
      <em key={nodeKey} className="italic">
        {parseInline(inner, `${nodeKey}-i`)}
      </em>,
    );
  }

  nodes.push(...parseInline(after, `${nodeKey}-a`));
  return nodes;
}

const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;

const HEADING_CLASS: Record<number, string> = {
  2: "mt-8 mb-3 text-2xl font-semibold tracking-tight text-ink",
  3: "mt-6 mb-2.5 text-xl font-semibold tracking-tight text-ink",
  4: "mt-5 mb-2 text-lg font-semibold text-ink",
  5: "mt-4 mb-2 text-base font-semibold text-ink",
  6: "mt-4 mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted",
};

function isBlockStart(line: string): boolean {
  return (
    line.trim() === "" ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line)
  );
}

function parseBlocks(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push(<hr key={`b-${i}`} className="my-8 border-line" />);
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const rawLevel = heading[1].length;
      // Shift h1 down to h2 so the article's single visible <h1> (the title)
      // stays the only top-level heading on the page.
      const level = rawLevel === 1 ? 2 : Math.min(rawLevel, 6);
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      out.push(
        <Tag key={`b-${i}`} className={HEADING_CLASS[level]}>
          {parseInline(heading[2].trim(), `b-${i}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        quoteLines.push(lines[i].replace(BLOCKQUOTE_RE, ""));
        i++;
      }
      out.push(
        <blockquote
          key={`b-${i}`}
          className="my-5 border-l-2 border-brand-purple/60 bg-surface/40 py-2 pl-4 pr-3 text-ink-muted"
        >
          {parseBlocks(quoteLines.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(UL_RE.exec(lines[i])![1]);
        i++;
      }
      out.push(
        <ul key={`b-${i}`} className="my-4 list-disc space-y-1.5 pl-6 text-ink">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed marker:text-brand-cyan">
              {parseInline(item, `b-${i}-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(OL_RE.exec(lines[i])![1]);
        i++;
      }
      out.push(
        <ol key={`b-${i}`} className="my-4 list-decimal space-y-1.5 pl-6 text-ink">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed marker:text-ink-subtle">
              {parseInline(item, `b-${i}-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph: gather consecutive lines until a blank line or a new block.
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    out.push(
      <p key={`b-${i}`} className="my-4 leading-relaxed text-ink-muted">
        {parseInline(paragraph.join(" ").trim(), `b-${i}`)}
      </p>,
    );
  }

  return out;
}

export function ArticleMarkdown({ content }: { content: string }) {
  if (!content?.trim()) return null;
  return <div className="text-[15px] sm:text-base">{parseBlocks(content)}</div>;
}
