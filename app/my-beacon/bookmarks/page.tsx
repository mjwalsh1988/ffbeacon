import type { Metadata } from "next";
import { readBookmarks } from "@/lib/bookmarks/load";
import { getNavViewer } from "@/lib/nav-viewer";
import { MAX_BOOKMARKS } from "@/lib/bookmarks/types";
import { BookmarksManager } from "./bookmarks-manager";

export const metadata: Metadata = {
  title: "Bookmarks",
  description:
    "Manage the pages you saved: rename them, put them in the order you want, and choose whether the bookmark bar shows.",
};

/**
 * The bookmark bar's home: every saved page, in order, with the controls the
 * bar and the sheet only offer one at a time.
 *
 * THIS PAGE ALWAYS READS THE LIST, handheld or not. The rule about not querying
 * bookmarks on a phone (lib/bookmarks/load.ts) is about CHROME that a phone
 * never paints. This page is the feature itself, and a reader who came here on
 * a phone came for exactly this.
 *
 * THE EMPTY STATE LIVES IN THE MANAGER, not here. A reader who adds their first
 * bookmark with the form on this page has to watch the "nothing saved yet" card
 * disappear in the same moment the row appears, and a server-rendered card
 * cannot do that.
 */
export default async function BookmarksPage() {
  const [bookmarks, viewer] = await Promise.all([
    readBookmarks(),
    getNavViewer(),
  ]);

  return (
    <div className="space-y-6">
      <section aria-labelledby="bookmarks-intro-heading">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Your bookmarks
        </p>
        <h2
          id="bookmarks-intro-heading"
          className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
        >
          The pages you keep coming back to.
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Press the bookmark button at the right of the breadcrumb bar on any
          page and it lands here. On a wide screen they sit in a bar under the
          header; on a phone they open from the bookmark button in the header.
          You can keep {MAX_BOOKMARKS}.
        </p>
      </section>

      <BookmarksManager
        initialBookmarks={bookmarks}
        initialBarEnabled={viewer.bookmarksBarEnabled}
      />
    </div>
  );
}
