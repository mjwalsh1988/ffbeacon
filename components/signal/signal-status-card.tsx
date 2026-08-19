"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radio,
  Users,
  MessageSquare,
  ArrowRight,
  ExternalLink,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { CopyLinkButton } from "@/components/copy-link-button";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { ImageWithFallback } from "@/components/image-with-fallback";

/** The minimal Signal shape the hero card needs. Null means no handle claimed. */
export type SignalStatus = {
  handle: string;
  status: "draft" | "published";
  visibility: "public" | "private";
  followerCount: number;
  postCount: number;
  /** Public URL of the uploaded avatar, or null to use the default emblem. */
  avatarUrl: string | null;
} | null;

/**
 * The Signal card that heads the My Beacon rail, in two states (claimed or not)
 * and two layouts:
 *   - Desktop (lg+): the full card.
 *   - Mobile/tablet (below lg): a compact trigger that says "My Signal" with a
 *     status glyph; tapping it slides the full card up from the bottom as a
 *     modal, so a phone gets the summary and the detail on request.
 *
 * The page H1 belongs to the masthead above, so the card's own heading is an H2.
 */
/** Id of the claim-handle section on /my-beacon/signal (set in that page). */
const CLAIM_ANCHOR_ID = "claim-handle";

/** Smooth-scroll the claim form into view and move focus into the handle field,
 * so a user who taps "Claim your handle" while already on the Signal page is
 * taken straight to where they type. Respects reduced-motion. */
function scrollToClaimSection() {
  const el = document.getElementById(CLAIM_ANCHOR_ID);
  if (!el) return;
  const reduce =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const input = el.querySelector<HTMLInputElement>("input");
  if (input) {
    input.focus({ preventScroll: true });
  } else {
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }
}

export function SignalStatusCard({ signal }: { signal: SignalStatus }) {
  const ariaLabel = signal ? "Your Signal status" : "Start your Signal";
  return (
    <>
      {/* Desktop: full card inline. */}
      <div className="hidden lg:block">
        <CardFrame ariaLabel={ariaLabel}>
          <CardBody signal={signal} />
        </CardFrame>
      </div>
      {/* Mobile/tablet: compact trigger opens the full card in a slide-up sheet. */}
      <div className="lg:hidden">
        <CompactCard signal={signal} />
      </div>
    </>
  );
}

function CardBody({
  signal,
  onClaimClick,
}: {
  signal: SignalStatus;
  /** Called when the claim CTA is activated (used to close the mobile sheet). */
  onClaimClick?: () => void;
}) {
  return signal ? (
    <ClaimedBody signal={signal} />
  ) : (
    <PitchBody onClaimClick={onClaimClick} />
  );
}

function CardFrame({
  children,
  ariaLabel,
}: {
  children: React.ReactNode;
  /** Names the region so a screen reader announces its purpose (the visible
   * heading inside stays as the card's title text). */
  ariaLabel: string;
}) {
  return (
    // A section rather than an aside. This card sits inside the My Beacon rail,
    // which is itself the complementary landmark, and a complementary nested in
    // a complementary reads as two of the same thing in a landmark list.
    <section
      aria-label={ariaLabel}
      className="relative overflow-hidden rounded-modal border border-line bg-surface/70 p-5 shadow-lg shadow-black/30 backdrop-blur sm:p-6"
    >
      {/* Beacon-gradient hairline pinned to the top edge, plus a faint corner
          glow, so the card reads as part of the branded hero surface. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(168, 85, 247, 0.14) 0%, transparent 70%)",
        }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}

/** Thin horizontal separator between card sections. */
function Divider() {
  return <div aria-hidden="true" className="my-4 h-px bg-line" />;
}

/** Branded round emblem used as the card's focal mark. Shows the owner's
 * uploaded avatar when present; otherwise the default beacon gradient + Radio. */
function Emblem({
  size = "md",
  avatarUrl,
}: {
  size?: "sm" | "md";
  avatarUrl?: string | null;
}) {
  const px = size === "sm" ? 36 : 44;
  if (avatarUrl) {
    return (
      <ImageWithFallback
        src={avatarUrl}
        alt=""
        size={px}
        className="shadow-md shadow-brand-purple/30"
      />
    );
  }
  const dim = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const icon = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-beacon text-black shadow-md shadow-brand-purple/30 ${dim}`}
    >
      <Radio className={icon} />
    </span>
  );
}

function Eyebrow() {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      <Radio aria-hidden="true" className="h-3.5 w-3.5" />
      My Signal
    </p>
  );
}

/* ---------- Pitch (no Signal yet) ---------- */

function PitchBody({ onClaimClick }: { onClaimClick?: () => void }) {
  const pathname = usePathname();
  const handleClaim = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // From another page, let the link navigate to /my-beacon/signal#claim-handle
    // and the page lands on the form. When already on the Signal page, stay put
    // and smooth-scroll to the form instead.
    if (pathname !== "/my-beacon/signal") return;
    event.preventDefault();
    onClaimClick?.();
    // Defer so a just-closed mobile sheet releases its body scroll-lock first.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToClaimSection()),
    );
  };
  return (
    <>
      <div className="flex items-start gap-3">
        <Emblem />
        <div className="min-w-0">
          <Eyebrow />
          <h2
            id="signal-pitch-heading"
            className="mt-1 text-xl font-semibold tracking-tight text-ink"
          >
            Ready to Boost Your Signal?
          </h2>
        </div>
      </div>

      <Divider />

      <ul role="list" className="space-y-3">
        <PitchRow
          icon={Radio}
          title="For creators"
          body={
            <>
              Claim your @handle and{" "}
              <span className="font-semibold text-brand-purple">
                boost your signal
              </span>{" "}
              to a growing community!
            </>
          }
        />
        <PitchRow
          icon={Users}
          title="For everyone"
          body="Spin up a public profile so people can follow you and talk ball on your Wall."
        />
      </ul>

      <Link
        href="/my-beacon/signal#claim-handle"
        onClick={handleClaim}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Claim your handle
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </>
  );
}

function PitchRow({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
          {body}
        </span>
      </span>
    </li>
  );
}

/* ---------- Claimed Signal ---------- */

/** Publish-status descriptor (Draft vs Published) shared by the full card pill
 * and the compact trigger glyph. */
function statusOf(signal: NonNullable<SignalStatus>) {
  return signal.status === "published"
    ? {
        label: "Published",
        pill: "text-signal-success border-signal-success/40 bg-signal-success/10",
        dot: "bg-signal-success",
      }
    : {
        label: "Draft",
        pill: "text-ink-muted border-line bg-base",
        dot: "bg-ink-subtle",
      };
}

/** Icon-badge stat (followers, posts). The visible number/label split is hidden
 * from screen readers, which instead hear a single clean phrase. */
function Stat({
  icon: Icon,
  value,
  singular,
  plural,
}: {
  icon: LucideIcon;
  value: number;
  singular: string;
  plural: string;
}) {
  const word = value === 1 ? singular : plural;
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div aria-hidden="true">
        <p className="text-sm font-semibold tabular-nums text-ink">
          {value.toLocaleString()}
        </p>
        <p className="text-[11px] uppercase tracking-wide text-ink-muted">{word}</p>
      </div>
      <span className="sr-only">{`${value.toLocaleString()} ${word.toLowerCase()}`}</span>
    </div>
  );
}

function ClaimedBody({ signal }: { signal: NonNullable<SignalStatus> }) {
  const isLive = signal.status === "published" && signal.visibility === "public";
  const publicPath = `/${signal.handle}`;
  const publicUrlLabel = `${new URL(SITE.url).host}/${signal.handle}`;
  const state = statusOf(signal);

  return (
    <>
      {/* Header: eyebrow + glanceable publish-status pill. */}
      <div className="flex items-center justify-between gap-3">
        <Eyebrow />
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${state.pill}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
          <span className="sr-only">Status: </span>
          {state.label}
        </span>
      </div>

      {/* Identity: emblem (avatar if uploaded) + handle + public address. */}
      <div className="mt-4 flex items-center gap-3">
        <Emblem avatarUrl={signal.avatarUrl} />
        <div className="min-w-0">
          <h2
            id="signal-status-heading"
            className="truncate text-lg font-semibold tracking-tight text-ink"
          >
            @{signal.handle}
          </h2>
          <p className="truncate text-xs text-ink-muted">{publicUrlLabel}</p>
        </div>
      </div>

      <Divider />

      {/* Readout: followers + posts, same icon-badge pattern. */}
      <div className="flex items-center gap-6">
        <Stat icon={Users} value={signal.followerCount} singular="Follower" plural="Followers" />
        <Stat icon={MessageSquare} value={signal.postCount} singular="Post" plural="Posts" />
      </div>

      <Divider />

      {/* Actions. Manage pushed to the right. */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={publicPath}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-card bg-beacon px-2.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          aria-label={
            isLive
              ? `View your public profile at ${publicUrlLabel}`
              : `Preview your profile at ${publicUrlLabel}. It is not yet visible to others.`
          }
        >
          {isLive ? "View profile" : "Preview"}
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </Link>
        <CopyLinkButton
          href={publicPath}
          ariaLabel={`Copy your profile link, ${publicUrlLabel}`}
          label="Copy link"
          size="sm"
        />
        <Link
          href="/my-beacon/signal"
          className="ml-auto inline-flex h-9 items-center gap-1 rounded-card px-1.5 text-xs font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          aria-label="Manage your Signal profile"
        >
          Manage
          <ArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      </div>
    </>
  );
}

/* ---------- Compact trigger + slide-up sheet (mobile/tablet) ---------- */

function CompactCard({ signal }: { signal: SignalStatus }) {
  const [open, setOpen] = useState(false);
  const claimed = signal !== null;
  const state = claimed ? statusOf(signal) : null;

  const triggerAria = claimed
    ? `My Signal. Profile @${signal.handle}, ${state!.label.toLowerCase()}. Open for details and actions.`
    : "My Signal. Open to start your public profile.";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerAria}
        className="relative flex w-full items-center gap-3 overflow-hidden rounded-modal border border-line bg-surface/70 p-3 text-left shadow-lg shadow-black/30 backdrop-blur transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        <Emblem size="sm" avatarUrl={claimed ? signal.avatarUrl : null} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            My Signal
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-ink">
            {claimed ? `@${signal.handle}` : "Set up your profile"}
          </span>
        </span>
        {claimed && state ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${state.pill}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
            {state.label}
          </span>
        ) : null}
        <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-subtle" />
      </button>

      <SlideUpDialog
        open={open}
        onClose={() => setOpen(false)}
        label={claimed ? "Your Signal status" : "Start your Signal"}
      >
        <div className="px-5 pb-2 pt-3">
          <CardBody signal={signal} onClaimClick={() => setOpen(false)} />
        </div>
      </SlideUpDialog>
    </>
  );
}
