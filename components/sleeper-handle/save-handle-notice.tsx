import Link from "next/link";
import { UserPlus } from "lucide-react";

/**
 * The one sentence that sits under every Sleeper username form.
 *
 * Two states, and the difference between them is where the reader has to go
 * next. A signed-out reader needs an account, so the notice links to sign-in
 * carrying the path they are on. A signed-in reader with nothing saved needs
 * only to tick the box in the form directly above this, so the notice points
 * at that box rather than sending them to another page for something they can
 * do here.
 *
 * A reader who already has a handle saved sees no notice at all: the identity
 * card is the notice.
 *
 * Server-safe, no hooks, so it can render inside a server component.
 */
export function SaveHandleNotice({
  state,
  nextPath,
  className = "",
}: {
  state: "guest" | "member-unsaved";
  /** Where to return after sign-in. Guest state only. */
  nextPath?: string;
  className?: string;
}) {
  const loginHref = nextPath
    ? `/login?next=${encodeURIComponent(nextPath)}`
    : "/login";

  return (
    <p
      className={`mt-4 flex items-start gap-2.5 rounded-card border border-line bg-base/50 p-3 text-sm leading-relaxed text-ink-muted ${className}`}
    >
      <UserPlus
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
      />
      {state === "guest" ? (
        <span>
          Tired of typing this?{" "}
          <Link
            href={loginHref}
            className="font-medium text-brand-purple underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Create a free account
          </Link>{" "}
          and save your Sleeper username once. Every tool then opens on your
          leagues.
        </span>
      ) : (
        <span>
          Tick the save box above and skip this step next time. Every tool then
          opens on your leagues.
        </span>
      )}
    </p>
  );
}
