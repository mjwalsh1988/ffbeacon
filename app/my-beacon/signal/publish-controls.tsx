"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Lock, ExternalLink } from "lucide-react";
import { setPublishState } from "./actions";

/**
 * Publish state + visibility for a Signal. Publishing a public profile is what
 * makes it readable by anyone, so the consequence is spelled out and announced
 * via an assertive live region. Visibility is a radio group; publish is a
 * toggle button. Both persist through the setPublishState server action.
 */
export function PublishControls({
  initialStatus,
  initialVisibility,
  publicUrl,
}: {
  initialStatus: "draft" | "published";
  initialVisibility: "public" | "private";
  publicUrl: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const persist = (next: { status: "draft" | "published"; visibility: "public" | "private" }) => {
    const prev = { status, visibility };
    setStatus(next.status);
    setVisibility(next.visibility);
    setError(null);
    startTransition(async () => {
      const res = await setPublishState(next);
      if (res.ok) {
        const live =
          next.status === "published"
            ? next.visibility === "public"
              ? "Profile published and public. Anyone can view it at your handle."
              : "Profile published but private. Only you can view it."
            : "Profile set to draft. It is not visible to anyone but you.";
        setAnnounce(live);
        router.refresh();
      } else {
        setStatus(prev.status);
        setVisibility(prev.visibility);
        setError(res.error);
      }
    });
  };

  const isLive = status === "published" && visibility === "public";

  return (
    <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Publish status</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {status === "published"
              ? isLive
                ? "Your profile is live and visible to anyone."
                : "Published, but private: only you can see it."
              : "Draft: only you can see your profile."}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          aria-pressed={status === "published"}
          onClick={() => persist({ status: status === "published" ? "draft" : "published", visibility })}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          {status === "published" ? "Switch to draft" : "Publish profile"}
        </button>
      </div>

      <fieldset className="mt-5 border-t border-line pt-5">
        <legend className="text-sm font-medium text-ink">Who can see it</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <VisibilityOption
            checked={visibility === "public"}
            disabled={pending}
            onSelect={() => persist({ status, visibility: "public" })}
            icon={<Globe aria-hidden="true" className="h-4 w-4" />}
            title="Public"
            description="Anyone on the web (when published)."
          />
          <VisibilityOption
            checked={visibility === "private"}
            disabled={pending}
            onSelect={() => persist({ status, visibility: "private" })}
            icon={<Lock aria-hidden="true" className="h-4 w-4" />}
            title="Private"
            description="Only you, even when published."
          />
        </div>
      </fieldset>

      {isLive && (
        <p className="mt-4 text-sm text-ink-muted">
          Live at{" "}
          <Link
            href={`/u/${publicUrl.split("/u/")[1] ?? ""}`}
            className="inline-flex items-center gap-1 font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {publicUrl}
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </p>
      )}

      <p aria-live="assertive" className="sr-only">
        {announce}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-signal-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function VisibilityOption({
  checked,
  disabled,
  onSelect,
  icon,
  title,
  description,
}: {
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-card border p-3 ${
        checked ? "border-brand-purple/60 bg-brand-purple/10" : "border-line bg-base"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="signal-visibility"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 h-4 w-4 accent-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-ink-subtle">{description}</span>
      </span>
    </label>
  );
}
