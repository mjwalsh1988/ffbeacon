"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

// Address stored as a charcode array so it never appears as a literal
// string in the server-rendered HTML, and so common email regexes
// (which look for `local@domain.tld`) get nothing to match. Decoded
// client-side after mount via String.fromCharCode. A headless-browser
// scraper that fully hydrates the page can still pull the address from
// the post-mount DOM, but the overwhelming majority of harvesters are
// regex-over-static-HTML and will miss this entirely.
const EMAIL_CHARS = [
  109, 105, 99, 104, 97, 101, 108, 64, 102, 102, 98, 101, 97, 99, 111, 110, 46,
  99, 111, 109,
];

const BUTTON_BASE =
  "inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function EmailReveal() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(String.fromCharCode(...EMAIL_CHARS));
  }, []);

  if (!email) {
    // Pre-hydration / no-JS fallback. Stays semantically a button so
    // screen readers don't announce a broken link target.
    return (
      <button
        type="button"
        aria-label="Email Michael (address loading)"
        disabled
        className={`${BUTTON_BASE} opacity-80`}
      >
        <Mail aria-hidden="true" className="h-4 w-4" />
        Email Michael
      </button>
    );
  }

  return (
    <a
      href={`mailto:${email}`}
      className={`${BUTTON_BASE} transition-opacity hover:opacity-90`}
    >
      <Mail aria-hidden="true" className="h-4 w-4" />
      {email}
    </a>
  );
}
