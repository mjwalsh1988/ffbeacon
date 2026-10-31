/**
 * A tiny parser for what Michael types into a review.
 *
 * A blank line separates paragraphs. A line starting with "## " is a subheading,
 * a run of lines starting with "- " is a bullet list, a line starting with "1. "
 * begins a numbered list, a URL on its own line becomes a link whose text is the
 * URL, and everything else is a paragraph. No inline formatting and no HTML
 * passthrough: the output is structure, and the two renderers (the page's React
 * elements, the email's escaped table-safe HTML) build their markup from it, so
 * a `<script>` typed into a review stays text on both.
 *
 * Pure, and safe in a client component, because the admin preview uses it.
 */

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "link"; href: string };

const URL_LINE = /^https?:\/\/[^\s<>"']+$/i;
const NUMBERED_LINE = /^\d+\.\s+/;

export function parseRichText(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === "") {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
    } else if (line.startsWith("- ")) {
      flush();
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2).trim());
        i++;
      }
      i--;
      blocks.push({ kind: "bullets", items });
    } else if (NUMBERED_LINE.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && NUMBERED_LINE.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(NUMBERED_LINE, ""));
        i++;
      }
      i--;
      blocks.push({ kind: "numbered", items });
    } else if (URL_LINE.test(line)) {
      flush();
      blocks.push({ kind: "link", href: line });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/**
 * The blocks back as plain words, for an email's text part and for the clip in
 * the delivery email.
 */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
        case "paragraph":
          return b.text;
        case "link":
          return b.href;
        case "bullets":
          return b.items.map((item) => `- ${item}`).join("\n");
        case "numbered":
          return b.items.map((item, i) => `${i + 1}. ${item}`).join("\n");
      }
    })
    .join("\n\n");
}
