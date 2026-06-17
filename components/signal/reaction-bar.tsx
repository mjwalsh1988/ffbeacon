"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { reactionImageUrl, type ReactionType } from "@/lib/signal/reactions";
import type { ReactionTargetData } from "@/lib/signal-wall";
import { addReaction, removeReaction } from "@/app/u/[handle]/reaction-actions";

/**
 * Public reaction picker + counts for a single Wall target (a post or a comment).
 *
 * Counts come straight from the loader's read of signal_reaction_counts; this
 * component never tallies rows. The picker is a keyboard-operable toolbar built
 * from the ACTIVE catalog only: one toggle button per active reaction type, with
 * aria-pressed reflecting the viewer's own state and aria-label set to the catalog
 * label. Image reactions render <img alt=""> INSIDE the labeled button, so the
 * accessible name is always the label, never a bare glyph.
 *
 * Disabled-but-counted reaction types are not in the picker, but their historical
 * counts still show as labeled, read-only chips. Anonymous and view-only (hidden /
 * owner-preview) viewers see counts read-only; signed-in viewers on a live target
 * can toggle. A polite live region announces "Reacted with X, N total" / "Removed
 * X"; an assertive region carries errors. After a successful write the Wall is
 * dynamic, so we router.refresh() to repaint with live counts (no cache bust).
 *
 * Accessibility: the toolbar uses roving tabindex (one Tab stop; Left/Right/Up/Down
 * move between reactions, Home/End jump to the ends; Enter/Space toggle). Every
 * interactive target is at least 44x44 CSS px.
 */

function ReactionGlyph({ type }: { type: ReactionType }) {
  if (type.kind === "image" && type.image_path) {
    // The catalog label is the accessible name (button aria-label / chip text),
    // so the image itself is decorative here.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={reactionImageUrl(type.image_path)}
        alt=""
        className="h-5 w-5 object-contain"
      />
    );
  }
  return (
    <span aria-hidden="true" className="text-base leading-none">
      {type.char}
    </span>
  );
}

export function ReactionBar({
  targetType,
  targetId,
  activeTypes,
  data,
  viewerUserId,
  canReact,
}: {
  targetType: "post" | "comment";
  targetId: string;
  activeTypes: ReactionType[];
  data: ReactionTargetData;
  viewerUserId: string | null;
  canReact: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Display state is derived purely from server props; a successful write calls
  // router.refresh() so the next render carries fresh counts/viewer state.
  const countById = new Map(data.counts.map((c) => [c.type.id, c.count] as const));
  const reactedSet = new Set(data.viewerReactionTypeIds);
  const disabledCounts = data.counts.filter((c) => !c.type.is_active);

  const interactive = canReact && viewerUserId !== null;

  const toggle = (type: ReactionType) => {
    // Guard double-fire instead of disabling the button: a disabled control is
    // pulled from the tab order and loses focus mid-interaction, which would
    // strand a keyboard / screen-reader user. The write is idempotent (a repeat
    // add maps the unique violation to a no-op), so the guard is the only
    // protection needed against an overlapping submit.
    if (pending) return;
    const wasPressed = reactedSet.has(type.id);
    const current = countById.get(type.id) ?? 0;
    setError(null);
    startTransition(async () => {
      const res = wasPressed
        ? await removeReaction(targetType, targetId, type.id)
        : await addReaction(targetType, targetId, type.id);
      if (res.ok) {
        setAnnouncement(
          wasPressed
            ? `Removed ${type.label}`
            : `Reacted with ${type.label}, ${current + 1} total`,
        );
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const n = activeTypes.length;
    if (n === 0) return;
    let next = focusIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (focusIndex + 1) % n;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (focusIndex - 1 + n) % n;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = n - 1;
    } else {
      return;
    }
    event.preventDefault();
    setFocusIndex(next);
    requestAnimationFrame(() => buttonRefs.current[next]?.focus());
  };

  // Nothing to show: no picker (anon / view-only) and no historical counts.
  const hasAnyCount = data.counts.length > 0;
  if (!interactive && !hasAnyCount && !(canReact && viewerUserId === null)) {
    return null;
  }

  return (
    <div className="mt-3">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      <div aria-live="assertive">
        {error && (
          <p role="alert" className="mb-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {interactive && activeTypes.length > 0 && (
          <div
            role="toolbar"
            aria-label="Reactions"
            onKeyDown={onKeyDown}
            className="flex flex-wrap items-center gap-2"
          >
            {activeTypes.map((type, i) => {
              const pressed = reactedSet.has(type.id);
              const count = countById.get(type.id) ?? 0;
              // Clamp the roving tab stop so a shrinking catalog (admin disables a
              // type mid-session) can never leave the toolbar with no tabbable
              // button until the next arrow press.
              const tabStop = Math.min(focusIndex, activeTypes.length - 1);
              return (
                <button
                  key={type.id}
                  ref={(el) => {
                    buttonRefs.current[i] = el;
                  }}
                  type="button"
                  tabIndex={i === tabStop ? 0 : -1}
                  aria-pressed={pressed}
                  aria-label={type.label}
                  title={type.label}
                  aria-busy={pending}
                  onFocus={() => setFocusIndex(i)}
                  onClick={() => toggle(type)}
                  className={`inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    pressed
                      ? "border-brand-purple bg-brand-purple/15 text-ink"
                      : "border-line bg-base text-ink-muted hover:border-brand-cyan/60 hover:text-ink"
                  }`}
                >
                  <ReactionGlyph type={type} />
                  {count > 0 && (
                    <span aria-hidden="true" className="font-semibold tabular-nums">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Read-only counts: for view-only/anon viewers, every counted type; for
            interactive viewers, only the disabled types (active ones live in the
            toolbar above). Each chip keeps its label so historical reactions stay
            named even after a type is removed from the catalog. */}
        {(interactive ? disabledCounts : data.counts).map(({ type, count }) => (
          <span
            key={type.id}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-base px-3 text-sm text-ink-muted"
          >
            <ReactionGlyph type={type} />
            <span>{type.label}</span>
            <span className="font-semibold tabular-nums">{count}</span>
          </span>
        ))}

        {canReact && viewerUserId === null && (
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-full px-2 text-sm font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sign in to react
          </Link>
        )}
      </div>
    </div>
  );
}
