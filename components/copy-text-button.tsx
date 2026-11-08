"use client";

/**
 * Copy a block of plain text to the clipboard, with screen reader feedback.
 * Built from components/copy-link-button.tsx with the href resolution removed
 * (Long Shot plan 14). Its status region speaks only about the copy.
 *
 * On success the label flips to "{noun} copied" for 2.5 seconds and the
 * region says "{noun} copied to clipboard." When the clipboard is refused the
 * text appears in a visible, labeled, read-only field with focus and the
 * selection in it, and the region says how to copy it by hand.
 */

import { useEffect, useRef, useState } from "react";

export function CopyTextButton({
  text,
  label,
  ariaLabel,
  noun,
  onCopied,
}: {
  text: string;
  label: string;
  ariaLabel: string;
  noun: string;
  onCopied?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.();
      setStatus("copied");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("manual");
      requestAnimationFrame(() => {
        fieldRef.current?.focus({ preventScroll: true });
        fieldRef.current?.select();
      });
    }
  }

  const manual = status === "manual";
  const announcement =
    status === "copied"
      ? `${noun} copied to clipboard.`
      : manual
        ? `Clipboard unavailable. Press Control C, or Command C, to copy the selected ${noun.toLowerCase()}.`
        : "";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card border bg-surface px-4 text-sm font-semibold transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          status === "copied" ? "border-brand-cyan/70 text-brand-cyan" : "border-line text-ink"
        }`}
      >
        {status === "copied" ? `${noun} copied` : label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {manual && (
        <label className="flex w-full flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">{noun} to copy</span>
          <textarea
            ref={fieldRef}
            readOnly
            value={text}
            rows={3}
            className="w-full rounded-card border border-brand-cyan/60 bg-base px-2 py-2 font-mono text-xs text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </label>
      )}
    </>
  );
}
