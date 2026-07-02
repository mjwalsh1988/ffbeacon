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
   * roomier. */
  size?: "xs" | "sm" | "md" | "lg";
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
}: CopyLinkButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [resolvedUrl, setResolvedUrl] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleClick = async () => {
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

  const sizeClasses =
    size === "xs"
      ? "min-h-8 min-w-8 px-1.5 text-xs"
      : size === "sm"
        ? "min-h-9 min-w-9 px-2 text-xs"
        : size === "lg"
          ? "min-h-11 px-4 text-sm"
          : "min-h-10 px-3 text-sm";

  const iconOnly = size === "xs" || size === "sm";
  const visibleLabel =
    status === "copied"
      ? "Link copied"
      : status === "manual"
        ? "Press Ctrl+C"
        : (label ?? (iconOnly ? "" : "Copy link"));

  const announcement =
    status === "copied"
      ? "Link copied to clipboard."
      : status === "manual"
        ? "Clipboard unavailable. Press Ctrl+C to copy the selected link."
        : "";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        className={`inline-flex items-center justify-center gap-1.5 rounded-card border border-line bg-surface text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline-2 focus-visible:outline-brand-cyan ${sizeClasses}`}
      >
        <LinkIcon size={size === "xs" ? 12 : 14} />
        {visibleLabel && <span>{visibleLabel}</span>}
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
