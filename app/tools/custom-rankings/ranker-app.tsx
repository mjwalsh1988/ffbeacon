"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunPayload } from "@/lib/ranking-boards/run-payload";
import { Wizard } from "./wizard";
import { Runner } from "./runner";
import { claimGuestBoardAction } from "./actions";
import type { WizardBoard, WizardFormat, WizardLimits, WizardSource } from "./types";

/**
 * Beacon Ranker's two screens: the setup wizard, and the run. A run in
 * progress (the reader's latest, or the board named in ?board=) opens straight
 * into the run, so "come back later" means exactly that.
 *
 * Focus moves to the run's first heading when a run starts, and back to the
 * wizard's first step when the reader starts over.
 */
export function RankerApp({
  initialPayload,
  signedIn,
  formats,
  sources,
  defaultSourceSlug,
  defaultFormatSlug,
  limits,
  boards,
  presetBoardId,
  hasGuestBoard,
  claim,
  publishedFormatSlugs,
}: {
  initialPayload: RunPayload | null;
  signedIn: boolean;
  formats: WizardFormat[];
  sources: WizardSource[];
  defaultSourceSlug: string | null;
  defaultFormatSlug: string;
  limits: WizardLimits;
  boards: WizardBoard[];
  presetBoardId: string | null;
  hasGuestBoard: boolean;
  /** ?claim=1 with a signed-in reader and a guest cookie. */
  claim: boolean;
  /** Formats whose community board is published, for the finished run's link. */
  publishedFormatSlugs: string[];
}) {
  const router = useRouter();
  const [payload, setPayload] = useState<RunPayload | null>(initialPayload);
  const [claimMessage, setClaimMessage] = useState("");
  const startRef = useRef<HTMLDivElement>(null);
  const claimed = useRef(false);

  // The sign-in hand-off: carry the guest board into the account once, then
  // drop ?claim=1 from the address and reload the page on the claimed board.
  useEffect(() => {
    if (!claim || claimed.current) return;
    claimed.current = true;
    void (async () => {
      const result = await claimGuestBoardAction();
      if (!result.ok) {
        setClaimMessage(result.error);
        return;
      }
      if (result.boardId) {
        setClaimMessage("Your guest board is now saved to your account.");
        router.replace(`/tools/custom-rankings?board=${result.boardId}`);
        router.refresh();
      } else {
        router.replace("/tools/custom-rankings");
      }
    })();
  }, [claim, router]);

  // Only on a CHANGE of screen, never on first load: a page should not move
  // focus on its own before the reader has done anything.
  const firstPayload = useRef(true);
  useEffect(() => {
    if (firstPayload.current) {
      firstPayload.current = false;
      return;
    }
    startRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [payload]);

  const communityHref =
    payload && publishedFormatSlugs.includes(payload.setup.meta.formatSlug)
      ? `/rankings/community?format=${payload.setup.meta.formatSlug}`
      : null;

  return (
    <div ref={startRef}>
      <p role="status" className={claimMessage ? "mb-4 text-sm text-signal-success" : "sr-only"}>
        {claimMessage}
      </p>
      {payload ? (
        <Runner
          key={`${payload.ref.kind}:${payload.ref.kind === "board" ? payload.ref.boardId : "guest"}`}
          payload={payload}
          onRestart={() => setPayload(null)}
          communityHref={communityHref}
        />
      ) : (
        <Wizard
          signedIn={signedIn}
          formats={formats}
          sources={sources}
          defaultSourceSlug={defaultSourceSlug}
          defaultFormatSlug={defaultFormatSlug}
          limits={limits}
          boards={boards}
          presetBoardId={presetBoardId}
          hasGuestBoard={hasGuestBoard}
          onStarted={setPayload}
        />
      )}
    </div>
  );
}
