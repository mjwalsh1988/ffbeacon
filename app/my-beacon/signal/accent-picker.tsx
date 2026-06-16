"use client";

import { useId, useState, useTransition } from "react";
import {
  SIGNAL_ACCENT_SLUGS,
  ACCENT_SPOKEN_NAME,
  accentFillStyle,
  accentInkColor,
  resolveAccent,
  type SignalAccent,
} from "@/lib/signal/accents";
import { saveAccent } from "./actions";

/**
 * Accent picker for a Signal. A real radiogroup built from native radio inputs
 * (one per accent) so screen readers get group semantics and arrow-key
 * selection for free; the visible swatch is the radio's label. Selecting an
 * accent saves immediately via the saveAccent server action (owner-only RLS;
 * the slug is re-validated server-side and by the DB CHECK). A polite live
 * region announces the chosen color and the save result.
 *
 * Contrast rule: the live preview uses accentFillStyle (accent fill, locked
 * near-black text) and accentInkColor (accent as text on the dark background),
 * the exact two ways the accent is used on the public profile.
 */
export function AccentPicker({ initialAccent }: { initialAccent: SignalAccent }) {
  const [selected, setSelected] = useState<SignalAccent>(initialAccent);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const legendId = useId();
  const groupName = useId();

  const choose = (accent: SignalAccent) => {
    if (accent === selected && !error) return;
    const previous = selected;
    setSelected(accent);
    setError(null);
    setAnnouncement(`${ACCENT_SPOKEN_NAME[accent]} selected. Saving.`);
    startTransition(async () => {
      const res = await saveAccent(accent);
      if (res.ok) {
        setAnnouncement(`${ACCENT_SPOKEN_NAME[accent]} saved as your accent.`);
      } else {
        setSelected(previous);
        setError(res.error);
        setAnnouncement("");
      }
    });
  };

  const preview = resolveAccent(selected);

  return (
    <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
      <fieldset disabled={pending}>
        <legend
          id={legendId}
          className="text-sm font-medium text-ink"
        >
          Accent color
        </legend>
        <p className="mt-1 text-xs text-ink-subtle">
          Sets the color of buttons, chips, and highlights on your public
          profile. Use the arrow keys to move between colors.
        </p>

        <div
          role="radiogroup"
          aria-labelledby={legendId}
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"
        >
          {SIGNAL_ACCENT_SLUGS.map((slug) => {
            const isChecked = slug === selected;
            return (
              <label
                key={slug}
                className="group flex cursor-pointer items-center gap-2 rounded-card border border-line bg-base p-2 has-[:checked]:border-line-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan"
              >
                <input
                  type="radio"
                  name={groupName}
                  value={slug}
                  checked={isChecked}
                  onChange={() => choose(slug)}
                  className="sr-only"
                />
                {/* Swatch: accent fill with the locked near-black text, so the
                    sample shows exactly how a filled chip reads. */}
                <span
                  aria-hidden="true"
                  style={accentFillStyle(slug)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                >
                  {isChecked ? "✓" : "Aa"}
                </span>
                <span className="min-w-0 text-sm text-ink">
                  {ACCENT_SPOKEN_NAME[slug]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Live preview of both accent uses. */}
      <div className="mt-5 rounded-card border border-line bg-base/60 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
          Preview
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span
            style={accentFillStyle(selected)}
            className="inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold"
          >
            Filled chip
          </span>
          <span
            style={{ color: accentInkColor(selected) }}
            className="text-sm font-semibold"
          >
            Accent text
          </span>
          <span
            style={{ borderColor: accentInkColor(selected) }}
            className="inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold text-ink"
          >
            {preview.label} outline
          </span>
        </div>
      </div>

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="mt-3 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
