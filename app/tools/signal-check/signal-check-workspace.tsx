"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useStepScroll } from "@/lib/use-step-scroll";
import { SignalCheckBuilder, type FormatOption } from "./signal-check-builder";
import { SleeperImportPanel } from "./sleeper-import-panel";

type Mode = "build" | "import";

/**
 * Holds the two things that can occupy the tool area: the trade builder and
 * the Sleeper import. Only one is on screen at a time, so the builder is the
 * first thing under the hero instead of the third.
 *
 * The builder stays mounted while the import is showing (hidden, not
 * unmounted), so a half-built trade survives a trip to Sleeper and back.
 */
export function SignalCheckWorkspace({
  formats,
  minLength,
  initialFormatSlug,
  initialFormatFromHeader,
  showImport,
  signedIn,
  initialUsername,
}: {
  formats: FormatOption[];
  minLength: number;
  initialFormatSlug: string;
  initialFormatFromHeader: boolean;
  /** False when Sleeper imports are switched off in admin: no button, no panel. */
  showImport: boolean;
  signedIn: boolean;
  initialUsername: string | null;
}) {
  const [mode, setMode] = useState<Mode>("build");
  // The import panel costs a server round trip for the league list, so it is
  // only built once someone asks for it. After that it stays mounted.
  const [importMounted, setImportMounted] = useState(false);
  const [notice, setNotice] = useState("");

  // The swap replaces everything under the hero without changing the URL, so
  // nothing moves the scroll position on its own. Opening the import from
  // partway down a built trade would otherwise drop the reader into the middle
  // of the league picker. Both directions open something the reader has not
  // seen in this state, so both read from the top. "top" moves no focus,
  // because the effect below already places it, and it has to wait for the
  // panel to mount before it can.
  useStepScroll(mode, "top");

  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importRegionRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<Mode | null>(null);

  // /tools/signal-check#sleeper-import is linked from the Sleeper leagues page,
  // and the panel is no longer on the page at load time for that hash to find.
  // Honour the intent instead: open the import.
  useEffect(() => {
    if (!showImport) return;
    if (window.location.hash !== "#sleeper-import") return;
    setImportMounted(true);
    setMode("import");
    pendingFocus.current = "import";
  }, [showImport]);

  // Focus follows the swap, otherwise a keyboard or screen-reader user is left
  // pointing at a button that just disappeared. The target may not exist yet
  // on the commit that requested it (the hash open mounts the panel and moves
  // focus in one go), so hold the request until the element is really there.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null || target !== mode) return;
    const el = target === "import" ? importRegionRef.current : importButtonRef.current;
    if (!el) return;
    pendingFocus.current = null;
    // preventScroll because the swap has just put the page back at the top and
    // a plain focus() would drag it down again to whatever it landed on.
    el.focus({ preventScroll: true });
  }, [mode, importMounted]);

  function openImport() {
    setImportMounted(true);
    setMode("import");
    pendingFocus.current = "import";
    setNotice("Sleeper import open. The trade builder is hidden until you go back.");
  }

  function backToBuilder() {
    setMode("build");
    pendingFocus.current = "build";
    setNotice("Back to the trade builder. Your trade is as you left it.");
  }

  const importButton = showImport ? (
    <button
      ref={importButtonRef}
      type="button"
      onClick={openImport}
      className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <Download aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
      Import a trade from Sleeper
    </button>
  ) : null;

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      <div hidden={mode !== "build"}>
        <SignalCheckBuilder
          formats={formats}
          minLength={minLength}
          initialFormatSlug={initialFormatSlug}
          initialFormatFromHeader={initialFormatFromHeader}
          toolbarLeading={importButton}
        />
      </div>

      {importMounted && (
        <div
          ref={importRegionRef}
          tabIndex={-1}
          hidden={mode !== "import"}
          className="scroll-mt-24 outline-none"
        >
          <SleeperImportPanel
            signedIn={signedIn}
            initialUsername={initialUsername}
            onBack={backToBuilder}
          />
        </div>
      )}
    </>
  );
}
