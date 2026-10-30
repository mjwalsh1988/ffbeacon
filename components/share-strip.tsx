/**
 * The share strip: an h2 "Share" and three buttons (Copy image, Copy image
 * link, Copy page link). Extracted from the single matchup page so the
 * matchup, the leaderboards and the Team Blueprint all render the same strip
 * (Team Blueprint plan 9.14, decision 3.15).
 *
 * EVERY ACCESSIBLE NAME LEADS WITH THE VISIBLE LABEL (WCAG 2.5.3). A speech
 * input user says what they can see, so "Copy image" has to be the start of
 * the name and not a phrase the name happens to be about. The rest of the
 * sentence is what the button will actually put on the clipboard, which is the
 * part a reader cannot check afterwards. The callers supply those sentences.
 *
 * Copy image link prewarms the image route on hover or focus, so the first
 * person to paste the link is not the one who waits for it to render.
 */

import { CopyImageButton } from "@/components/copy-image-button";
import { CopyLinkButton } from "@/components/copy-link-button";

export function ShareStrip({
  id,
  heading = "Share",
  imageHref,
  imageDescription,
  imageAriaLabel,
  imageLinkAriaLabel,
  pageHref,
  pageNoun,
  pageAriaLabel,
}: {
  /** Id for the heading; the section is labelled by it. */
  id: string;
  heading?: string;
  imageHref: string;
  /** One sentence describing the picture, announced after a copy. */
  imageDescription: string;
  imageAriaLabel: string;
  imageLinkAriaLabel: string;
  pageHref: string;
  /** "Matchup link": what the toast calls the copied page address. */
  pageNoun: string;
  pageAriaLabel: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/50 px-3 py-2.5"
    >
      <h2 id={id} className="mr-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-subtle">
        {heading}
      </h2>
      <CopyImageButton imageHref={imageHref} description={imageDescription} ariaLabel={imageAriaLabel} />
      <CopyLinkButton
        href={imageHref}
        prewarmHref={imageHref}
        icon="image"
        noun="Image link"
        label="Copy image link"
        size="md"
        ariaLabel={imageLinkAriaLabel}
      />
      <CopyLinkButton
        href={pageHref}
        icon="link"
        noun={pageNoun}
        label="Copy page link"
        size="md"
        ariaLabel={pageAriaLabel}
      />
    </section>
  );
}
