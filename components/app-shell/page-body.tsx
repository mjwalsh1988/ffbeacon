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
 * `flush` drops the bottom padding, for the pages that close this column right
 * after the masthead and follow it with a block that brings its own top
 * padding. Without it the two stack and that page gets roughly double the gap
 * every other page has.
 */

import type { ReactNode } from "react";

export function PageBody({
  children,
  width = "wide",
  flush = false,
  className = "",
}: {
  children: ReactNode;
  width?: "wide" | "reading";
  flush?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6 ${flush ? "" : "pb-14"} ${
        width === "reading" ? "mx-auto max-w-4xl" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
