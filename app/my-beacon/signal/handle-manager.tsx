"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Check } from "lucide-react";
import {
  checkHandleAvailability,
  claimHandle,
  updateHandle,
  type HandleStatus,
} from "./actions";
import { normalizeHandle, validateHandleFormat, HANDLE_MAX } from "@/lib/signal";
import { SITE } from "@/lib/site";

/**
 * Claim (first time) or change a Signal handle. Availability is checked live as
 * the user types (debounced), announced politely for screen readers; submit
 * results and errors are announced assertively. The database triggers are the
 * real backstop for reserved words, reclaim blocking, and the rename rate limit.
 */
export function HandleManager({ currentHandle }: { currentHandle: string | null }) {
  const router = useRouter();
  const isClaim = currentHandle === null;

  const [value, setValue] = useState(currentHandle ?? "");
  const [availability, setAvailability] = useState<{
    status: HandleStatus | "checking" | "idle";
    message: string;
  }>({ status: "idle", message: "" });
  const [result, setResult] = useState<
    { kind: "idle" } | { kind: "saved"; message: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const inputId = useId();
  const hintId = useId();
  const statusId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = normalizeHandle(value);
  const unchanged = !isClaim && normalized === normalizeHandle(currentHandle ?? "");

  // Debounced live availability check.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (unchanged) {
      setAvailability({ status: "idle", message: "" });
      return;
    }
    const formatError = validateHandleFormat(normalized);
    if (formatError) {
      setAvailability({ status: "invalid", message: formatError });
      return;
    }
    setAvailability({ status: "checking", message: "Checking availability..." });
    debounceRef.current = setTimeout(() => {
      checkHandleAvailability(normalized).then((res) => {
        // Ignore stale responses if the input moved on.
        setAvailability((prev) =>
          prev.status === "checking" ? { status: res.status, message: res.message } : prev,
        );
      });
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [normalized, unchanged]);

  const canSubmit =
    !pending &&
    !unchanged &&
    (availability.status === "available" || availability.status === "unchanged");

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setResult({ kind: "idle" });
    startTransition(async () => {
      const res = isClaim ? await claimHandle(normalized) : await updateHandle(normalized);
      if (res.ok) {
        setResult({
          kind: "saved",
          message: isClaim
            ? `Your handle is set. Your profile lives at ${SITE.url}/${normalized}.`
            : `Handle updated to ${normalized}.`,
        });
        router.refresh();
      } else {
        setResult({ kind: "error", message: res.error });
      }
    });
  };

  const statusTone =
    availability.status === "available" || availability.status === "unchanged"
      ? "text-signal-success"
      : availability.status === "checking" || availability.status === "idle"
        ? "text-ink-subtle"
        : "text-signal-danger";

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {isClaim ? "Choose your handle" : "Your handle"}
      </label>
      <p id={hintId} className="mt-1 text-xs text-ink-subtle">
        Your public address is {SITE.url}/u/your-handle. 3 to {HANDLE_MAX} lowercase
        letters, numbers, or underscores.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-center rounded-card border border-line bg-base focus-within:border-brand-purple">
          <span aria-hidden="true" className="pl-3 text-ink-subtle">
            <AtSign className="h-4 w-4" />
          </span>
          <input
            id={inputId}
            value={value}
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={HANDLE_MAX}
            aria-describedby={`${hintId} ${statusId}`}
            aria-invalid={
              availability.status === "invalid" ||
              availability.status === "taken" ||
              availability.status === "reserved"
            }
            onChange={(e) => setValue(e.target.value)}
            className="w-full bg-transparent px-2 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:outline-none sm:text-sm"
            placeholder="your_handle"
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          {isClaim ? "Claim handle" : "Save handle"}
        </button>
      </div>

      {/* Live availability (polite) */}
      <p id={statusId} aria-live="polite" className={`mt-2 min-h-[1.25rem] text-sm ${statusTone}`}>
        {availability.message}
      </p>

      {/* Submit result (assertive) */}
      <div aria-live="assertive" className="min-h-[1.25rem]">
        {result.kind === "saved" && (
          <p role="status" className="text-sm text-signal-success">
            {result.message}
          </p>
        )}
        {result.kind === "error" && (
          <p role="alert" className="text-sm text-signal-danger">
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}
