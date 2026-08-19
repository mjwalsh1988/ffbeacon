"use client";

import { useEffect, useRef, useState } from "react";

type CopyLinkButtonProps = {
  /** Path or fully-qualified URL to copy. Relative paths are resolved
   * against `window.location.origin` on click. */
  href: string;
  /** aria-label for the button. Required because the visible icon-only
   * variant has no text. */
  ariaLabel: string;
  /** Visible label override. When omitted, the button is icon-only on
   * smaller sizes and shows "Copy link" on default/lg. */
  label?: string;
  /** "xs" and "sm" hide the label and tighten padding for inline use inside
   * trade rows ("xs" is the most condensed). "md" and "lg" are progressively
   * roomier. Every size keeps a 44x44 minimum tap target. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Glyph to show. "image" marks a link that resolves to a generated share
   * image rather than a page. */
  icon?: "link" | "image";
  /** Noun used in the visible confirmation and the live-region announcement.
   * Defaults to "Link". */
  noun?: string;
  /** When set, requesting this URL on first hover / focus warms the CDN so the
   * generated image is already rendered by the time anyone opens the link. */
  prewarmHref?: string;
  /** Drop the visible label below sm, keeping the glyph and a square tap
   * target. For rows that are tight on a phone and roomy above it, such as the
   * League Pulse header, where the league switcher wants the width. The button
   * keeps its aria-label either way, so nothing is lost by ear. */
  compactBelowSm?: boolean;
};

/**
 * Copy-to-clipboard button with full screen-reader feedback.
 *
 * On click:
 *   1. Resolves `href` against the current origin if relative
 *   2. Writes the absolute URL to clipboard
 *   3. Flips visible label to "Link copied" for 2.5s
 *   4. Announces "Link copied to clipboard" via aria-live polite region
 *   5. Restores idle state
 *
 * Failure mode: when clipboard.writeText rejects (e.g. permission denied,
 * insecure context) we fall through to selecting the URL inside a hidden
 * <input> and prompting the user to copy manually. The screen reader
 * announcement reflects this with "Press Ctrl+C to copy".
 */
export function CopyLinkButton({
  href,
  ariaLabel,
  label,
  size = "md",
  icon = "link",
  noun = "Link",
  prewarmHref,
  compactBelowSm = false,
}: CopyLinkButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const prewarmedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (href.startsWith("http")) setResolvedUrl(href);
    else setResolvedUrl(`${window.location.origin}${href.startsWith("/") ? href : `/${href}`}`);
  }, [href]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Rendering the share image is the slow half of sharing it, and it only has
  // to happen once per (team, source): the route caches for an hour at the
  // edge. Kicking it off the moment someone reaches for the button means the
  // render is usually finished before the link is pasted anywhere.
  const prewarm = () => {
    if (!prewarmHref || prewarmedRef.current) return;
    prewarmedRef.current = true;
    const target = prewarmHref.startsWith("http")
      ? prewarmHref
      : `${window.location.origin}${prewarmHref.startsWith("/") ? prewarmHref : `/${prewarmHref}`}`;
    const img = new window.Image();
    img.decoding = "async";
    img.src = target;
  };

  const handleClick = async () => {
    prewarm();
    if (!resolvedUrl) return;
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      setStatus("copied");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("manual");
      const node = fallbackInputRef.current;
      if (node) {
        node.value = resolvedUrl;
        node.removeAttribute("aria-hidden");
        node.style.position = "fixed";
        node.style.top = "50%";
        node.style.left = "50%";
        node.style.opacity = "0";
        node.focus({ preventScroll: true });
        node.select();
      }
    }
  };

  // Every variant clears 44x44, the project's minimum tap target. The icon-only
  // sizes differ in padding and glyph weight, not in how easy they are to hit.
  const sizeClasses =
    size === "xs"
      ? "min-h-11 min-w-11 px-1.5 text-xs"
      : size === "sm"
        ? "min-h-11 min-w-11 px-2 text-xs"
        : size === "lg"
          ? "min-h-11 px-4 text-sm"
          : "min-h-11 px-3 text-sm";
  const iconOnly = size === "xs" || size === "sm";
  // Label hidden below sm, present above it. The glyph has to confirm the copy
  // on its own at the small size, since the "Link copied" text is not there to.
  const labelHiddenBelowSm = compactBelowSm && !iconOnly;
  // Square below sm when the label is gone, so the target never drops under
  // 44x44 on the layout that needs it most.
  const compactClasses = labelHiddenBelowSm ? "min-w-11 sm:min-w-0" : "";
  // An icon-only button confirms with a checkmark and the confirmed color
  // rather than growing a "copied" label. These sit inline in roster and trade
  // headers, where a button that widens mid-row pushes the stats beside it out
  // of the card. Sighted users get the check; the live region below says the
  // rest.
  const confirmInPlace = (iconOnly || labelHiddenBelowSm) && status === "copied";
  const visibleLabel = (iconOnly && status === "copied")
    ? ""
    : status === "copied"
      ? `${noun} copied`
      : status === "manual"
        ? "Press Ctrl+C"
        : (label ?? (iconOnly ? "" : `Copy ${noun.toLowerCase()}`));

  const announcement =
    status === "copied"
      ? `${noun} copied to clipboard.`
      : status === "manual"
        ? "Clipboard unavailable. Press Ctrl+C to copy the selected link."
        : "";

  const glyphSize = size === "xs" ? 12 : 14;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onPointerEnter={prewarm}
        onFocus={prewarm}
        aria-label={ariaLabel}
        title={iconOnly ? ariaLabel : undefined}
        className={`inline-flex items-center justify-center gap-1.5 rounded-card border bg-surface transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline-2 focus-visible:outline-brand-cyan ${
          confirmInPlace
            ? "border-brand-cyan/70 text-brand-cyan"
            : "border-line text-ink-muted"
        } ${sizeClasses} ${compactClasses}`}
      >
        {confirmInPlace ? (
          <CheckIcon size={glyphSize} />
        ) : icon === "image" ? (
          <ImageIcon size={glyphSize} />
        ) : (
          <LinkIcon size={glyphSize} />
        )}
        {visibleLabel && (
          <span className={labelHiddenBelowSm ? "hidden sm:inline" : undefined}>
            {visibleLabel}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
      <input
        ref={fallbackInputRef}
        type="text"
        readOnly
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      />
    </>
  );
}

function LinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

function ImageIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L3 21" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
