"use client";

/**
 * Per-draft preferences that belong to the browser, not the account.
 *
 * The build mode and the watchlist are both answers to "what am I doing in THIS
 * room", so they are keyed by draft id and stored locally. They deliberately do
 * not go near user_preferences: that table holds the site-wide format and source
 * choices, and a startup draft where someone is rebuilding says nothing about
 * how they want their rankings page to look.
 *
 * Every read is defensive. localStorage can be unavailable (private mode, a
 * hardened browser, a quota that is already full), and a draft room must open
 * regardless, so a failure falls back to the default rather than throwing.
 */

import type { BuildMode } from "@/lib/on-the-clock/types";

const MODE_KEY = (draftId: string) => `otc:mode:${draftId}`;
const WATCH_KEY = (draftId: string) => `otc:watch:${draftId}`;

/** Cap on the watchlist, so one room cannot fill a user's storage quota. */
const MAX_WATCHLIST = 60;

function isMode(value: unknown): value is BuildMode {
  return value === "compete" || value === "balanced" || value === "rebuild";
}

export function readBuildMode(draftId: string, fallback: BuildMode): BuildMode {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(MODE_KEY(draftId));
    return isMode(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

export function writeBuildMode(draftId: string, mode: BuildMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_KEY(draftId), mode);
  } catch {
    // A full or blocked quota is not worth an error state; the mode simply does
    // not survive a reload.
  }
}

export function readWatchlist(draftId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(WATCH_KEY(draftId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_WATCHLIST));
  } catch {
    return new Set();
  }
}

export function writeWatchlist(draftId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      WATCH_KEY(draftId),
      JSON.stringify([...ids].slice(0, MAX_WATCHLIST)),
    );
  } catch {
    // Same as above: losing a watchlist on reload beats breaking the room.
  }
}
