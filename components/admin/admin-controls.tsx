"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * Shared, screen-reader-first primitives for the admin list managers
 * (sources-manager, reactions-manager, and any future sibling). Centralizing
 * these keeps every manager on one correct a11y pattern instead of each one
 * re-deriving (and re-diverging) its own switch and live region.
 */

/**
 * A role="switch" toggle whose CLICKABLE area is a full 44x44 CSS px target (the
 * mobile-first minimum), while the visible pill stays compact. The button is the
 * hit target and carries the focus ring, role, and aria-checked; the pill and
 * knob inside are decorative (aria-hidden), so the accessible name is the passed
 * label and the state is conveyed by aria-checked.
 */
export function AdminSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-card px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
          checked ? "border-brand-cyan bg-brand-cyan/30" : "border-line bg-base"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-ink transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

/**
 * A polite live region plus an announce() that re-announces even when the same
 * message is sent twice in a row. It alternates between two sr-only regions:
 * each call writes the message into one region and clears the other, so the
 * region carrying text always changes content, which a single fixed region would
 * not when the string is identical (the DOM text would not change and the screen
 * reader would stay silent). ASCII-only, no nonce characters in the spoken text.
 */
export function useAdminAnnouncer(): {
  announce: (message: string) => void;
  region: ReactNode;
} {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const slot = useRef(false);

  const announce = useCallback((message: string) => {
    slot.current = !slot.current;
    if (slot.current) {
      setA(message);
      setB("");
    } else {
      setB(message);
      setA("");
    }
  }, []);

  const region = (
    <>
      <p aria-live="polite" className="sr-only">
        {a}
      </p>
      <p aria-live="polite" className="sr-only">
        {b}
      </p>
    </>
  );

  return { announce, region };
}
