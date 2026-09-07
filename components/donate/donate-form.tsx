"use client";

import { useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import {
  DEFAULT_AMOUNT_USD,
  MAX_AMOUNT_LABEL,
  MIN_AMOUNT_LABEL,
  PRESET_AMOUNTS_USD,
  formatUsd,
  parseDonationAmount,
} from "@/lib/donate/amounts";
import { PAY_HANDLE_DISPLAY, paypalUrl, venmoUrl } from "@/lib/donate/links";

/**
 * The donation picker: an amount, then three ways to send it.
 *
 * ONE COMPONENT, TWO HOMES. The header modal and the /donate page both render
 * this, so the amounts, the wording, the validation and the three payment paths
 * cannot drift apart between them. `surface` is the only thing that differs, and
 * it is recorded on the Stripe session so the dashboard can say where a
 * donation came from.
 *
 * WHY THE AMOUNTS ARE NATIVE RADIOS
 *   Arrow-key movement, the checked state, and the single tab stop for the whole
 *   group all come from the platform. Rolling this as buttons with aria-pressed
 *   would mean reimplementing all three, and it would make six tab stops out of
 *   one. The visible radio is `sr-only` rather than `display:none`, because a
 *   hidden input is not focusable and the group would fall out of the tab order
 *   entirely.
 *
 * WHY NOTHING AUTOFOCUSES WHEN "OTHER" IS PICKED
 *   In a native radiogroup the arrow keys move SELECTION, not just focus, so a
 *   reader arrowing along the row lands on Other on the way past. Yanking focus
 *   into a text box at that moment would trap them out of the group they were
 *   still moving through. The box is rendered immediately after the group
 *   instead, so it is simply the next thing Tab reaches.
 *
 * WHY PAYPAL AND VENMO ARE LINKS AND THE CARD BUTTON IS A BUTTON
 *   They are what they are. PayPal and Venmo are a navigation to another site
 *   with the amount already in the URL, and a reader deserves to hear "link" and
 *   to be able to open one in a new tab the way they open any other. The card
 *   path has to ask our server to open a session first, so it is a button. When
 *   the typed amount is not yet a number those two become buttons that say why,
 *   because an anchor pointing at an amount-less URL is a broken link dressed as
 *   a working one.
 */

type Surface = "header_modal" | "donate_page";

/** The chosen amount, formatted for a button label, or "" when there is none. */
function amountWord(cents: number | null): string {
  return cents === null ? "" : ` ${formatUsd(cents)}`;
}

export function DonateForm({
  surface,
  /**
   * Whether the card and wallet path can actually run, resolved on the server
   * from the Stripe key. When it is false the button is not drawn at all: a
   * prominent primary control that answers a press with an apology is worse
   * than an honest sentence, and PayPal and Venmo take the lead instead.
   */
  cardEnabled = true,
  /** Rendered above the amounts. The modal supplies its own heading instead. */
  className = "",
}: {
  surface: Surface;
  cardEnabled?: boolean;
  className?: string;
}) {
  const groupName = useId();
  const otherInputId = useId();
  const otherHintId = useId();
  const fieldErrorId = useId();
  const needAmountId = useId();

  const pathname = usePathname();
  const otherRef = useRef<HTMLInputElement>(null);
  // Guards a second submit while the first is in flight. A ref rather than the
  // `pending` state because a double click can land inside one render.
  const inFlight = useRef(false);

  // The preselected amount comes from lib/donate/amounts.ts so it cannot name a
  // preset that no longer exists. A default is a suggestion, and the one people
  // act on is the one that feels easy rather than the one that looks generous.
  const [choice, setChoice] = useState<string>(String(DEFAULT_AMOUNT_USD));
  const [other, setOther] = useState("");
  /**
   * TWO ERROR CHANNELS, AND THEY ARE NOT INTERCHANGEABLE.
   *
   * `fieldError` is something wrong with the amount box. It drives
   * `aria-invalid` and `aria-describedby` on that input, and it is announced by
   * moving focus there rather than by a live region, so a reader hears it once.
   *
   * `formError` is something wrong with the request: Stripe unreachable, the
   * rate limit, a 502. It goes to the alert region and NEVER touches the input.
   *
   * They were one piece of state to begin with, which meant a Stripe outage
   * marked a perfectly good "50" as invalid and read "check your connection" out
   * as the description of the amount field. The field was not invalid and there
   * was nothing in it to fix.
   */
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [pending, setPending] = useState(false);

  const isOther = choice === "other";
  const parsed = parseDonationAmount(isOther ? other : Number(choice));
  const cents = parsed.ok ? parsed.cents : null;

  /** Clear both channels. Any change to the amount invalidates either message. */
  function clearErrors() {
    setFieldError(null);
    setFormError(null);
  }

  /**
   * Say why there is no amount yet, and put the reader where they can fix it.
   *
   * The focus move IS the announcement: landing on the input reads its label,
   * then its description, which now begins with this message. Putting the same
   * string in an alert region as well made it stutter on the most common failure
   * path in the form.
   */
  function reportMissingAmount() {
    if (!parsed.ok) setFieldError(parsed.error);
    setFormError(null);
    otherRef.current?.focus();
  }

  async function startCardDonation() {
    if (inFlight.current) return;
    if (cents === null) {
      reportMissingAmount();
      return;
    }
    inFlight.current = true;
    setPending(true);
    clearErrors();
    setStatus("Opening the secure payment page.");

    try {
      const res = await fetch("/api/donate/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: cents / 100,
          surface,
          returnPath: pathname ?? "/",
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; url: string }
        | { ok: false; error?: string }
        | null;

      if (res.ok && data && data.ok && typeof data.url === "string") {
        // Deliberately no second status message here. The navigation begins in
        // the same tick, so a reader would hear at most a clipped fragment of it
        // on top of the one they were already given.
        window.location.assign(data.url);
        return;
      }

      setStatus("");
      setFormError(
        (data && !data.ok && data.error) ||
          "We could not open the payment page. Try PayPal or Venmo below.",
      );
    } catch {
      setStatus("");
      setFormError(
        "We could not reach the payment page. Check your connection, or use PayPal or Venmo below.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  /**
   * The selected state is a border colour, a tint and a text colour, and
   * Windows High Contrast overrides all three with system colours, so selected
   * and unselected would render identically with the real radio clipped out of
   * sight. The `forced-colors:` outline restores a visible marker in that mode
   * only, and costs nothing anywhere else.
   */
  const choiceClass = (selected: boolean) =>
    [
      "flex min-h-11 cursor-pointer items-center justify-center rounded-card border px-3 py-2 text-base font-semibold transition-colors",
      selected
        ? "border-brand-purple bg-brand-purple/15 text-ink forced-colors:outline forced-colors:outline-2 forced-colors:outline-offset-[-4px]"
        : "border-line bg-surface text-ink-muted hover:border-line-accent hover:text-ink",
      "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan",
    ].join(" ");

  return (
    <form
      className={`grid gap-5 ${className}`}
      // ENTER IN THE AMOUNT BOX HAS TO DO SOMETHING. A reader types 50 and
      // presses Enter, because that is what a text field means. Without a form
      // around it nothing happened and they had to Tab onward to discover that.
      // There is no action and no method: submission is handled here and the
      // navigation to Stripe happens in JavaScript, so the site's
      // `form-action 'self'` CSP directive is never engaged.
      onSubmit={(event) => {
        event.preventDefault();
        void startCardDonation();
      }}
    >
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="text-sm font-semibold text-ink">Pick an amount</legend>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          One-time, in US dollars. Nothing is stored on this site and nothing repeats
          next month.
        </p>

        {/* No aria-label here. The fieldset's legend already names this group,
            and adding one made a reader hear "Pick an amount, group" followed
            by "Donation amount, radio group" for a single control. */}
        <div role="radiogroup" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESET_AMOUNTS_USD.map((dollars) => {
            const value = String(dollars);
            const selected = choice === value;
            return (
              <label key={value} className={choiceClass(selected)}>
                <input
                  type="radio"
                  name={groupName}
                  value={value}
                  checked={selected}
                  onChange={() => {
                    setChoice(value);
                    clearErrors();
                  }}
                  className="sr-only"
                />
                <span>${dollars}</span>
              </label>
            );
          })}

          <label className={choiceClass(isOther)}>
            <input
              type="radio"
              name={groupName}
              value="other"
              checked={isOther}
              onChange={() => {
                setChoice("other");
                clearErrors();
              }}
              className="sr-only"
            />
            <span>Other</span>
            {/* Picking this reveals a text field, and a reader arrowing across
                the group would otherwise hear "Other, radio button, 6 of 6" and
                stop, with no reason to look further. Said in the LABEL rather
                than by moving focus, because in a native radiogroup the arrow
                keys move selection and a reader passing over Other on the way to
                somewhere else must not be dragged out of the group. */}
            <span className="sr-only">, opens a box to type your own amount</span>
          </label>
        </div>

        {isOther && (
          <div className="mt-3">
            <label
              htmlFor={otherInputId}
              className="block text-sm font-medium text-ink"
            >
              Your amount, in dollars
            </label>
            <div className="mt-1.5 flex items-center gap-2 rounded-card border border-line bg-surface px-3 focus-within:border-brand-purple focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan">
              <span aria-hidden="true" className="text-base font-semibold text-ink-muted">
                $
              </span>
              <input
                ref={otherRef}
                id={otherInputId}
                name="donation-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="35"
                value={other}
                onChange={(e) => {
                  setOther(e.target.value);
                  clearErrors();
                }}
                // The FIELD error only, and named before the hint so a reader
                // hears what is wrong before hearing the permitted range. A
                // request-level failure (Stripe down, rate limited) must never
                // reach this attribute: the field would be announced as invalid
                // when there is nothing in it to fix.
                aria-describedby={
                  fieldError ? `${fieldErrorId} ${otherHintId}` : otherHintId
                }
                aria-invalid={fieldError ? true : undefined}
                className="min-h-11 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle"
              />
            </div>
            {/* NOT a live region. It is the field's description, and it is
                announced by the focus move in reportMissingAmount. Making it an
                alert as well made the same sentence arrive twice. */}
            <p
              id={fieldErrorId}
              className={
                fieldError
                  ? "mt-1.5 text-xs font-medium text-signal-danger"
                  : "sr-only"
              }
            >
              {fieldError ?? ""}
            </p>
            <p id={otherHintId} className="mt-1.5 text-xs text-ink-muted">
              Anything from {MIN_AMOUNT_LABEL} to {MAX_AMOUNT_LABEL}. Cents are fine.
            </p>
          </div>
        )}
      </fieldset>

      {/* Both regions are always in the DOM. A live region inserted at the same
          moment it gets its text is a region a screen reader has often not
          started watching yet, so it goes unread.

          This alert carries REQUEST failures only. Nothing here is wired to the
          amount field, so it can never describe that field as invalid. */}
      <div className="min-h-0">
        <p
          role="alert"
          className={formError ? "text-sm font-medium text-signal-danger" : "sr-only"}
        >
          {formError ?? ""}
        </p>
        <p role="status" className="sr-only">
          {status}
        </p>
      </div>

      {/* Names the reason the PayPal and Venmo controls are buttons rather than
          links while no amount has been chosen. */}
      <span id={needAmountId} className="sr-only">
        Pick an amount first.
      </span>

      <div className="grid gap-2">
        {cardEnabled ? (
          <>
            <button
              type="submit"
              aria-disabled={pending || undefined}
              aria-busy={pending || undefined}
              className={[
                "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity",
                pending ? "opacity-70" : "hover:opacity-90",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan",
              ].join(" ")}
            >
              {pending ? (
                <Loader2
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <CreditCard aria-hidden="true" className="h-4 w-4" />
              )}
              {pending
                ? "Opening secure checkout"
                : `Donate${amountWord(cents)} by card or wallet`}
            </button>
            <p className="text-xs leading-relaxed text-ink-muted">
              Card, Apple Pay, Google Pay and Link, on Stripe&apos;s own secure page.
              Your card details never touch this site, and we email you a receipt
              afterwards.
            </p>
          </>
        ) : (
          <p className="rounded-card border border-dashed border-line bg-base/40 p-3 text-xs leading-relaxed text-ink-muted">
            Card and wallet donations are switched off at the moment. PayPal and Venmo
            work as normal and reach exactly the same place.
          </p>
        )}

        <div className={`grid gap-2 sm:grid-cols-2 ${cardEnabled ? "mt-2" : ""}`}>
          <ExternalPayOption
            label={`Donate${amountWord(cents)} with PayPal`}
            href={cents === null ? null : paypalUrl(cents)}
            onBlocked={reportMissingAmount}
            blockedHintId={needAmountId}
          />
          <ExternalPayOption
            label={`Donate${amountWord(cents)} with Venmo`}
            href={cents === null ? null : venmoUrl(cents)}
            onBlocked={reportMissingAmount}
            blockedHintId={needAmountId}
          />
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          PayPal and Venmo both go to {PAY_HANDLE_DISPLAY}, and both open in a new tab
          with the amount already filled in.
        </p>
      </div>

      <p className="border-t border-line pt-4 text-xs leading-relaxed text-ink-subtle">
        A donation is a gift rather than a purchase, so it is final and is not
        refunded. Nothing on FF Beacon is behind a paywall and giving does not unlock
        anything, because there is nothing locked. The full wording is in the{" "}
        <Link
          href="/terms"
          className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Terms of Service
        </Link>
        .
      </p>
    </form>
  );
}

/**
 * PayPal or Venmo. A real link once there is an amount to put in it, and a
 * button that explains itself before there is one.
 *
 * "(opens in a new tab)" is inside the accessible name rather than only in the
 * title, because a new tab arriving unannounced is disorienting and a tooltip is
 * not a thing every reader has.
 */
function ExternalPayOption({
  label,
  href,
  onBlocked,
  blockedHintId,
}: {
  label: string;
  href: string | null;
  onBlocked: () => void;
  /** Names why this is a button rather than a link, while it is one. */
  blockedHintId: string;
}) {
  const shared =
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

  if (href === null) {
    return (
      <button
        type="button"
        onClick={onBlocked}
        aria-describedby={blockedHintId}
        className={shared}
      >
        {label}
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={shared}
    >
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}
