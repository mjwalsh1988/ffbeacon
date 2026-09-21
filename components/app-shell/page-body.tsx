/**
 * PageBody: the padded column a dashboard page's content sits in, matching the
 * one League Pulse uses. It exists so every page has the same gutters and the
 * same distance below the breadcrumb bar without each one restating them.
 *
 * `width="wide"` is the dashboard default: the content uses whatever the rail
 * leaves, edge to edge. `width="reading"` caps the measure for pages that are
 * mostly prose (guides, terms, an article), where a full-width paragraph is
 * hard to read.
 *
 * `width="tool"` is the column a tool page sits in, and it exists because the
 * alternative was every page capping itself. Each of them had picked its own
 * number (88rem here, 90rem there, 96rem somewhere else) and applied it to the
 * tool only, so the explainer below the tool ran to a different width again
 * and the market tables under that ran edge to edge. Three widths stacked down
 * one page reads as broken rather than as spacious, and nobody could tell
 * which one was the page. ONE column now governs a whole tool page, set here,
 * and the blocks inside it stop setting their own.
 *
 * `width="board"` is the one exception, and it is for On The Clock's draft
 * room: the available-players table carries eight columns and is read under a
 * clock, so it gets the extra 6rem. It is a different column, not a second
 * column on the same page, and that page uses it throughout.
 *
 * `flush` drops the bottom padding, for the pages that close this column right
 * after the masthead and follow it with a block that brings its own top
 * padding. Without it the two stack and that page gets roughly double the gap
 * every other page has.
 */

import type { ReactNode } from "react";

const WIDTH_CLASS = {
  wide: "",
  reading: "mx-auto max-w-4xl",
  tool: "mx-auto max-w-[90rem]",
  board: "mx-auto max-w-[96rem]",
} as const;

export function PageBody({
  children,
  width = "wide",
  flush = false,
  className = "",
}: {
  children: ReactNode;
  width?: "wide" | "reading" | "tool" | "board";
  flush?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6 ${flush ? "" : "pb-14"} ${
        WIDTH_CLASS[width]
      } ${className}`}
    >
      {children}
    </div>
  );
}
