"use client";

/**
 * Copy a generated share image to the clipboard AS AN IMAGE.
 *
 * Used by every surface that generates one: the matchup scoreboard under
 * /leagues/[id]/schedules, and the team card on the league's Teams tab. The
 * caller supplies the image URL and a sentence describing what is on it; nothing
 * in here knows or cares which card it is copying.
 *
 * WHY THIS IS NOT JUST ANOTHER CopyLinkButton
 *   Copying a link is the cheap version of sharing a scoreboard, and it is a
 *   worse one: the recipient has to open it, and half the places people paste
 *   these (a text message, a Discord attachment field, a Slack comment box)
 *   render a pasted PNG inline and a pasted URL as a blue word. Writing the
 *   actual bytes puts the picture in the conversation instead of a promise of
 *   one. `CopyLinkButton` still sits beside this for the URL, because a link is
 *   what somebody wants when they mean "go and look at this page".
 *
 * THE ORDER OF ATTEMPTS, AND WHY IT ENDS WHERE IT DOES
 *   1. `navigator.clipboard.write` with an `image/png` ClipboardItem. Chrome,
 *      Edge and Safari support this; Firefox does not (async clipboard writes
 *      are limited to text there), and neither does any insecure context.
 *   2. `navigator.clipboard.writeText` with the image URL. A recipient still
 *      gets the picture, one click later, and every browser can do this.
 *   3. A hidden input, selected, with "press Ctrl+C" said out loud. The floor.
 *   Each step down is ANNOUNCED as what it is, never presented as the thing
 *   that was asked for. A button that says "copied" after copying something
 *   else is a button that gets a blank message pasted into a group chat.
 *
 * THE PROMISE GOES INSIDE THE ClipboardItem, and that is not a style choice.
 * A clipboard write has to happen inside the gesture that triggered it, and
 * Safari treats an `await` before the write as the end of that gesture. Handing
 * the constructor a pending promise is the documented way to keep it: the write
 * is issued immediately and the bytes arrive late. Chrome accepts both forms, so
 * the promise form is the one that works everywhere, with a resolved-blob retry
 * behind it for any engine that rejects a pending one.
 *
 * NOTHING HERE IS SAID ONLY BY THE GLYPH, AND NO STATE IS SILENT. The status is
 * a word in the button and a sentence in a polite live region, so every outcome,
 * both fallbacks included, reaches a screen reader in full. That includes the
 * WAIT: the accessible name is a static aria-label, so the visible text changing
 * to "Building image" announces nothing on its own, and a cold render of the
 * card is a real few seconds of somebody pressing a button and hearing nothing.
 * "Building the image" goes into the live region for that reason, and the
 * outcome follows as a second polite message, which is the normal pattern rather
 * than a double announcement.
 */

import { useEffect, useRef, useState } from "react";

/**
 * How long to wait for the card before giving up on the image and offering the
 * link instead.
 *
 * Without it a hung request leaves `status` at "working" forever: the click
 * guard swallows every retry and no announcement ever fires, so the button is
 * dead and says nothing about it. A cold satori render of a full lineup takes a
 * few seconds, so this is generous rather than tight.
 */
const IMAGE_TIMEOUT_MS = 20_000;

type Status =
  | "idle"
  | "working"
  | "copied-image"
  | "copied-link"
  | "manual"
  | "failed";

export function CopyImageButton({
  imageHref,
  description,
  label = "Copy image",
  ariaLabel,
  size = "md",
}: {
  /** Path to the share image route. Resolved against the origin on click. */
  imageHref: string;
  /**
   * What is on the picture, in a sentence. Announced alongside the
   * confirmation, so a reader who cannot see the image they just copied still
   * knows what it says. A picture is the one thing a reader cannot check for
   * themselves after the fact.
   */
  description: string;
  label?: string;
  ariaLabel: string;
  /**
   * "sm" tightens the padding and the type for a row that is already crowded,
   * such as the team card header where three controls share the strip. Both
   * sizes keep the project's 44px minimum tap target.
   */
  size?: "sm" | "md";
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [resolvedUrl, setResolvedUrl] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const prewarmedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setResolvedUrl(
      imageHref.startsWith("http")
        ? imageHref
        : `${window.location.origin}${imageHref.startsWith("/") ? imageHref : `/${imageHref}`}`,
    );
  }, [imageHref]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Rendering the card is the slow half of copying it, and it only has to
  // happen once per (league, week, roster): the route caches for an hour at the
  // edge. Starting it the moment somebody reaches for the button usually means
  // the bytes are already sitting there when they press it.
  const prewarm = () => {
    if (prewarmedRef.current || !resolvedUrl) return;
    prewarmedRef.current = true;
    const img = new window.Image();
    img.decoding = "async";
    img.src = resolvedUrl;
  };

  const settle = (next: Status) => {
    setStatus(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (next !== "manual") {
      timerRef.current = setTimeout(() => setStatus("idle"), 4000);
    }
  };

  const copyTextFallback = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      settle("copied-link");
      return;
    } catch {
      // Fall through to the selection floor below.
    }

    // The state renders the field; this only moves focus into it, a frame later
    // so it is not racing React's commit. See the header of
    // components/copy-link-button.tsx for why the field is state-driven and
    // genuinely visible rather than an sr-only box focus is parked in.
    settle("manual");
    requestAnimationFrame(() => {
      const node = fallbackInputRef.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      node.select();
    });
  };

  const handleClick = async () => {
    if (!resolvedUrl || status === "working") return;
    prewarm();
    setStatus("working");

    const canWriteImage =
      typeof window !== "undefined" &&
      typeof window.ClipboardItem !== "undefined" &&
      typeof navigator.clipboard?.write === "function";

    if (!canWriteImage) {
      await copyTextFallback();
      return;
    }

    // Started inside the gesture, awaited inside the ClipboardItem. See the
    // header for why the order matters.
    const blobPromise = fetch(resolvedUrl, {
      cache: "force-cache",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    }).then(
      async (response) => {
        if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
        const blob = await response.blob();
        // The route answers with PNG. Anything else is an error page dressed as
        // a response, and pasting it would put a broken attachment in a chat.
        if (!blob.type.startsWith("image/png")) {
          throw new Error(`Unexpected type: ${blob.type}`);
        }
        return blob;
      },
    );

    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blobPromise }),
      ]);
      settle("copied-image");
      return;
    } catch {
      // Some engines reject a pending promise in a ClipboardItem outright. The
      // bytes are already in flight, so one retry with the resolved blob costs
      // nothing and rescues those.
    }

    try {
      const blob = await blobPromise;
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blob }),
      ]);
      settle("copied-image");
      return;
    } catch {
      // The image itself may never have arrived, so the link is the honest
      // remaining offer.
    }

    await copyTextFallback();
  };

  const visibleLabel =
    status === "working"
      ? "Building image"
      : status === "copied-image"
        ? "Image copied"
        : status === "copied-link"
          ? "Link copied"
          : status === "manual"
            ? "Press Ctrl+C"
            : status === "failed"
              ? "Copy failed"
              : label;

  const announcement =
    status === "working"
      ? "Building the image."
      : status === "copied-image"
        ? `Matchup image copied to the clipboard. ${description}`
        : status === "copied-link"
          ? `The image could not be copied on this browser, so its link was copied instead. ${description}`
          : status === "manual"
            ? "Clipboard access was refused. The image link is selected in the field below. Press Control C to copy it."
            : status === "failed"
              ? "The image could not be copied, and neither could its link. Open the image link beside this one and save the picture instead."
              : "";

  const confirmed = status === "copied-image" || status === "copied-link";
  const manual = status === "manual";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onPointerEnter={prewarm}
        onFocus={prewarm}
        aria-label={ariaLabel}
        aria-busy={status === "working"}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card border bg-surface font-semibold transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          size === "sm" ? "px-2 py-2 text-xs" : "px-3 py-2 text-sm"
        } ${
          confirmed
            ? "border-brand-cyan/70 text-brand-cyan"
            : "border-line text-ink-muted"
        }`}
      >
        {confirmed ? <CheckIcon /> : <ImageIcon />}
        <span>{visibleLabel}</span>
      </button>

      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>

      {/* Out of the accessibility tree AND out of the tab order until the
          clipboard has actually refused, then a real labelled field a reader can
          both see and operate. */}
      {/* NO useId, AND NO id/htmlFor PAIR. The label WRAPS the input, which is
          the implicit association and needs no generated id at all. The explicit
          form cost a hydration mismatch: adding a `useId` to a component that
          renders inside the league shell shifted the generated id of the
          bookmark bar beside it, and React reported the tree as hydrated with
          mismatched attributes. The hint sits outside the label so it does not
          land in the accessible name, and it is said in the live region above
          either way, so nothing is lost by ear. */}
      <span className={manual ? "flex w-full flex-col gap-1" : "sr-only"}>
        <label className={manual ? "flex flex-col gap-1" : "sr-only"}>
          <span
            className={manual ? "text-xs font-semibold text-ink-muted" : "sr-only"}
          >
            Image link to copy
          </span>
          <input
            ref={fallbackInputRef}
            type="text"
            readOnly
            value={manual ? resolvedUrl : ""}
            aria-hidden={manual ? undefined : "true"}
            tabIndex={manual ? 0 : -1}
            className={
              manual
                ? "w-full rounded-card border border-brand-cyan/60 bg-base px-2 py-2 text-xs text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                : "sr-only"
            }
          />
        </label>
        <span className={manual ? "text-xs text-ink-muted" : "sr-only"}>
          Clipboard access was refused. Press Control C, or Command C, to copy
          the selected link.
        </span>
      </span>
    </>
  );
}

function ImageIcon() {
  return (
    <svg
      width="14"
      height="14"
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

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
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
