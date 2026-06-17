"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { followProfile, unfollowProfile } from "@/app/u/[handle]/follow-actions";
import { FollowListModal } from "./follow-list-modal";

/**
 * Follow control + public follower count for a Signal profile (Phase 8).
 *
 * - Follower COUNT is always shown (public, read fresh from the denormalized
 *   signals.follower_count on the dynamic page). For signed-in viewers the count
 *   is a button that opens the follower/following list dialog; for anonymous
 *   viewers it is plain text (the list is authenticated-only).
 * - The Follow/Unfollow toggle renders only for a signed-in viewer who is not
 *   the profile owner (no self-follow). aria-pressed reflects the current state;
 *   the visible label is the accessible name (no aria-label override). A polite
 *   region announces the result and an assertive region carries errors (single
 *   regions, no nested role=alert, matching the post-sweep pattern).
 * - Anonymous viewers (not the owner) get a "Sign in to follow" link, never a
 *   broken button. The owner sees the count + list, no follow button.
 *
 * Display state is derived purely from props; a successful write calls
 * router.refresh() so the dynamic page re-reads the count + viewer follow state.
 * There is NO profile-cache bust (a stranger's follow must not invalidate the
 * owner's cached bundle, matching the Wall reactions decision).
 */
export function FollowControl({
  profileUserId,
  displayName,
  isOwnProfile,
  viewerUserId,
  followerCount,
  viewerIsFollowing,
}: {
  profileUserId: string;
  displayName: string;
  isOwnProfile: boolean;
  viewerUserId: string | null;
  followerCount: number;
  viewerIsFollowing: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const isAuthed = viewerUserId !== null;
  const canFollow = isAuthed && !isOwnProfile;

  const toggle = () => {
    // Guard double-fire instead of disabling (a disabled button drops focus
    // mid-toggle). The write is idempotent server-side.
    if (pending) return;
    const wasFollowing = viewerIsFollowing;
    setError(null);
    startTransition(async () => {
      const res = wasFollowing
        ? await unfollowProfile(profileUserId)
        : await followProfile(profileUserId);
      if (res.ok) {
        setAnnouncement(
          wasFollowing
            ? `Unfollowed ${displayName}.`
            : `Following ${displayName}. ${(followerCount + 1).toLocaleString()} ${
                followerCount + 1 === 1 ? "follower" : "followers"
              }.`,
        );
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      {/* Single assertive live region for errors (no inner role=alert). */}
      <div aria-live="assertive">
        {error && <p className="text-sm text-signal-danger">{error}</p>}
      </div>

      {canFollow && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={viewerIsFollowing}
          aria-busy={pending}
          className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded-full px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            viewerIsFollowing
              ? "border border-line bg-base text-ink hover:border-brand-cyan/60"
              : "bg-beacon text-black hover:opacity-90"
          }`}
        >
          {viewerIsFollowing ? "Following" : "Follow"}
        </button>
      )}

      {!isAuthed && !isOwnProfile && (
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-full px-2 text-sm font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Sign in to follow
        </Link>
      )}

      {isAuthed ? (
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex min-h-11 items-center rounded-card px-1 text-sm text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <span className="font-semibold tabular-nums text-ink">
            {followerCount.toLocaleString()}
          </span>
          <span className="ml-1">
            {followerCount === 1 ? "follower" : "followers"}
          </span>
        </button>
      ) : (
        <span className="inline-flex min-h-11 items-center px-1 text-sm text-ink-muted">
          <span className="font-semibold tabular-nums text-ink">
            {followerCount.toLocaleString()}
          </span>
          <span className="ml-1">
            {followerCount === 1 ? "follower" : "followers"}
          </span>
        </span>
      )}

      {isAuthed && (
        <FollowListModal
          open={listOpen}
          onClose={() => setListOpen(false)}
          profileUserId={profileUserId}
          displayName={displayName}
        />
      )}
    </div>
  );
}
