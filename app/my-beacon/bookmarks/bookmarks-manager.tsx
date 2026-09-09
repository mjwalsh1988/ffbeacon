"use client";

/**
 * The full manager for the bookmark bar, in My Beacon.
 *
 * The bar and the mobile sheet each offer one action at a time, in a strip that
 * has to stay out of the way. This is the page where all of it is in front of
 * you at once: the order, the names, the destinations, whether the bar shows at
 * all, and a way to add a page you are not standing on.
 *
 * IT SHARES THE SAME STORE AS THE BAR. Reordering here moves the bar behind the
 * page as you do it, because both read one client store fed by one set of
 * server actions (components/bookmarks/store.ts). There is no second
 * implementation of a bookmark list on this page and there must not be one.
 *
 * THIS PAGE PUBLISHES RATHER THAN SEEDS. Every other surface hands the store
 * its server list only if the store is still empty, which is right for chrome
 * that renders on every page. This one is the authoritative view, and the store
 * outlives client-side navigation, so a tab that was open while another tab
 * added a bookmark would otherwise render the list as it stood when this tab
 * first loaded. It overwrites with what the server just said.
 *
 * REORDERING IS BUTTONS, NOT DRAG. A drag handle is a gesture with no keyboard
 * equivalent unless one is built beside it, at which point the buttons are the
 * feature and the drag is decoration. Up and down move one place and say where
 * the row landed.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Bookmark, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BookmarkIcon } from "@/components/bookmarks/bookmark-icon";
import { RenameBookmarkDialog } from "@/components/bookmarks/rename-bookmark-dialog";
import { publishBookmarks, useBookmarks } from "@/components/bookmarks/store";
import { useBookmarkActions } from "@/components/bookmarks/use-bookmark-actions";
import { addBookmark } from "@/app/actions/bookmarks";
import {
  MAX_BOOKMARKS,
  MAX_BOOKMARK_LABEL_LENGTH,
  type Bookmark as BookmarkRow,
} from "@/lib/bookmarks/types";

export function BookmarksManager({
  initialBookmarks,
  initialBarEnabled,
}: {
  initialBookmarks: BookmarkRow[];
  initialBarEnabled: boolean;
}) {
  const { bookmarks, barEnabled } = useBookmarks({
    bookmarks: initialBookmarks,
    barEnabled: initialBarEnabled,
  });
  const {
    busyId,
    message,
    announce,
    error,
    clearError,
    move,
    rename,
    remove,
    setBarEnabled,
  } = useBookmarkActions(bookmarks, barEnabled);

  const [renaming, setRenaming] = useState<BookmarkRow | null>(null);
  const [confirming, setConfirming] = useState<BookmarkRow | null>(null);

  // See the file header. Runs once, on arrival, and only with what the server
  // sent for this render.
  const published = useRef(false);
  useEffect(() => {
    if (published.current) return;
    published.current = true;
    publishBookmarks({
      bookmarks: initialBookmarks,
      barEnabled: initialBarEnabled,
      loaded: true,
    });
  }, [initialBookmarks, initialBarEnabled]);

  // Focus has to go somewhere when the row it was standing on disappears.
  const listRef = useRef<HTMLUListElement>(null);
  const restoreIndex = useRef<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const index = restoreIndex.current;
    if (index === null) return;
    restoreIndex.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-row-link]");
    if (!rows || rows.length === 0) {
      addRef.current?.focus();
      return;
    }
    (rows[Math.min(index, rows.length - 1)] ?? rows[rows.length - 1])?.focus();
  }, [bookmarks]);

  const barBusy = busyId === "bar";

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="bookmark-bar-setting-heading"
        className="rounded-card border border-line bg-surface/50 p-5"
      >
        <h3
          id="bookmark-bar-setting-heading"
          className="text-base font-semibold text-ink"
        >
          The bookmark bar
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
          When this is on, your bookmarks sit in a bar under the header on a
          wide screen. Turning it off hides the bar and keeps every bookmark:
          the bookmark button in the header opens the same list at any width.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={barEnabled}
          // `aria-disabled` rather than `disabled`: this is the control the
          // reader just pressed, and disabling it under their focus hands focus
          // to `body` with nothing to give it back.
          aria-disabled={barBusy || undefined}
          aria-busy={barBusy}
          onClick={() => {
            if (barBusy) return;
            void setBarEnabled(!barEnabled);
          }}
          className="mt-4 inline-flex min-h-11 items-center gap-3 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            // The border gives the track a visible edge against the page at
            // both positions; without one the off state was a 1.5:1 shape.
            className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors motion-reduce:transition-none ${
              barEnabled
                ? "border-brand-cyan bg-brand-cyan"
                : "border-ink-subtle bg-line-accent"
            }`}
          >
            <span
              className={`absolute top-[0.1875rem] h-3.5 w-3.5 rounded-full bg-base transition-all motion-reduce:transition-none ${
                barEnabled ? "left-[1.1875rem]" : "left-[0.1875rem]"
              }`}
            />
          </span>
          {/* The state is in the text as well as in the switch, so nothing here
              depends on seeing which side a dot is on. */}
          {barEnabled ? "Bookmark bar is on" : "Bookmark bar is off"}
        </button>
      </section>

      {bookmarks.length === 0 ? (
        <div className="flex items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
          >
            <Bookmark className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-ink">Nothing saved yet.</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              Go to a page you use often, a league, a draft, a player, and press
              the bookmark button at the right-hand end of the breadcrumb bar.
              You can also add one by hand below.
            </p>
          </div>
        </div>
      ) : (
        <section aria-labelledby="bookmark-list-heading">
          <h3
            id="bookmark-list-heading"
            className="text-base font-semibold text-ink"
          >
            {`${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}, in bar order`}
          </h3>

          <ul ref={listRef} role="list" className="mt-4 space-y-2">
            {bookmarks.map((bookmark, index) => {
              const busy = busyId === bookmark.id;
              return (
                <li
                  key={bookmark.id}
                  aria-busy={busy || undefined}
                  className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
                  >
                    <BookmarkIcon bookmark={bookmark} size={18} />
                  </span>
                  <span className="min-w-0 flex-1 basis-48">
                    <Link
                      href={bookmark.path}
                      prefetch={false}
                      data-row-link
                      className="block truncate text-sm font-semibold text-ink underline-offset-2 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {bookmark.label}
                    </Link>
                    <span className="block truncate text-xs text-ink-subtle">
                      {bookmark.path}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-1">
                    <RowButton
                      label={`Move ${bookmark.label} up, to position ${index}`}
                      icon={ArrowUp}
                      unavailable={index === 0}
                      busy={busy}
                      onClick={() => void move(bookmark, "earlier")}
                    />
                    <RowButton
                      label={`Move ${bookmark.label} down, to position ${index + 2}`}
                      icon={ArrowDown}
                      unavailable={index === bookmarks.length - 1}
                      busy={busy}
                      onClick={() => void move(bookmark, "later")}
                    />
                    <RowButton
                      label={`Rename ${bookmark.label}`}
                      icon={Pencil}
                      unavailable={false}
                      busy={busy}
                      onClick={() => {
                        clearError();
                        setRenaming(bookmark);
                      }}
                    />
                    <RowButton
                      label={`Remove ${bookmark.label}`}
                      icon={Trash2}
                      danger
                      unavailable={false}
                      busy={busy}
                      onClick={() => {
                        clearError();
                        setConfirming(bookmark);
                      }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AddBookmarkForm
        inputRef={addRef}
        full={bookmarks.length >= MAX_BOOKMARKS}
      />

      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {/* One alert for one failure. A dialog owns the error while it is open,
          so the same sentence is not inserted into two assertive regions in the
          same commit and read out twice.

          The element is always in the DOM rather than mounted on demand: an
          alert region that already exists announces a repeat of the same
          sentence more reliably than one that is inserted each time. It goes
          sr-only when empty so it takes no space in the layout. */}
      <p
        role="alert"
        className={
          !renaming && !confirming && error
            ? "text-sm text-signal-danger"
            : "sr-only"
        }
      >
        {renaming || confirming ? "" : (error ?? "")}
      </p>

      {renaming && (
        <RenameBookmarkDialog
          open
          currentLabel={renaming.label}
          path={renaming.path}
          busy={busyId === renaming.id}
          error={error}
          onCancel={() => setRenaming(null)}
          onSave={async (label) => {
            const said = await rename(renaming, label);
            // One commit closes the dialog and says what happened. VoiceOver
            // prunes live regions outside an aria-modal subtree, so announcing
            // while the dialog is still mounted loses the sentence.
            if (said) {
              setRenaming(null);
              announce(said);
            }
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="Remove this bookmark?"
          description={`"${confirming.label}" comes off your bookmarks. The page itself is untouched, and you can save it again any time.`}
          confirmLabel="Remove bookmark"
          cancelLabel="Keep it"
          tone="danger"
          icon={Trash2}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming;
            const index = bookmarks.findIndex((b) => b.id === target.id);
            restoreIndex.current = index < 0 ? 0 : index;
            setConfirming(null);
            void remove(target).then((removed) => {
              // A failed delete leaves the list reference untouched, so the
              // effect above never runs and never clears this. Left armed, it
              // would fire on the next unrelated change.
              if (!removed) restoreIndex.current = null;
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * Add a page by hand.
 *
 * Exists because the button on the page itself cannot help with a page you are
 * not on, and because pasting a link out of the address bar is how most people
 * would try to do this anyway. The address is validated on the server, where a
 * link to somewhere other than FF Beacon is refused outright
 * (lib/bookmarks/path.ts); this form only says so in words.
 */
function AddBookmarkForm({
  inputRef,
  full,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  full: boolean;
}) {
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const blocked = busy || full;

  return (
    <section
      aria-labelledby="add-bookmark-heading"
      className="rounded-card border border-line bg-surface/50 p-5"
    >
      <h3 id="add-bookmark-heading" className="text-base font-semibold text-ink">
        Add a bookmark by hand
      </h3>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Paste an FF Beacon link, or type the part after the domain, like
        /tools/faab. Links to other sites are not accepted.
      </p>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (blocked) return;
          setBusy(true);
          setError(null);
          setMessage("");
          try {
            const result = await addBookmark(path, label);
            if (result.ok) {
              publishBookmarks({
                bookmarks: result.bookmarks,
                barEnabled: result.barEnabled,
                loaded: true,
              });
              if (result.created === false) {
                // Nothing was written, and specifically the existing name was
                // not overwritten. Saying "added" would be a lie about both.
                setError("That page is already in your bookmarks.");
              } else {
                setMessage(`${label.trim()} added to your bookmarks.`);
                setPath("");
                setLabel("");
              }
            } else {
              setError(result.error);
            }
          } catch {
            setError("Could not reach the server. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <span>
          <label
            htmlFor="add-bookmark-path"
            className="block text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            Address
          </label>
          <input
            ref={inputRef}
            id="add-bookmark-path"
            name="path"
            type="text"
            required
            inputMode="url"
            autoComplete="off"
            placeholder="/tools/faab"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "add-bookmark-error" : undefined}
            className="mt-1.5 h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </span>

        <span>
          <label
            htmlFor="add-bookmark-label"
            className="block text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            Name
          </label>
          <input
            id="add-bookmark-label"
            name="label"
            type="text"
            required
            maxLength={MAX_BOOKMARK_LABEL_LENGTH}
            autoComplete="off"
            placeholder="FAAB Calculator"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </span>

        {/* `aria-disabled` rather than `disabled` in both cases. At the cap a
            real disabled button cannot be tabbed to, so the reader never
            reaches the one control that would tell them why nothing happens;
            `aria-describedby` points at the sentence that explains it. */}
        <button
          type="submit"
          aria-disabled={blocked || undefined}
          aria-busy={busy}
          aria-describedby={full ? "add-bookmark-full" : undefined}
          className="mt-1.5 inline-flex h-11 items-center justify-center gap-1.5 self-end rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          {busy ? "Adding" : "Add bookmark"}
        </button>
      </form>

      {full && (
        <p id="add-bookmark-full" className="mt-3 text-sm text-ink-muted">
          {`You have all ${MAX_BOOKMARKS} bookmarks. Remove one to make room.`}
        </p>
      )}
      <p
        id="add-bookmark-error"
        role="alert"
        className={error ? "mt-3 text-sm text-signal-danger" : "sr-only"}
      >
        {error ?? ""}
      </p>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </section>
  );
}

/**
 * One square action at the end of a row. 44 by 44 at every width.
 *
 * Never the `disabled` attribute. Both reasons a button here is unavailable are
 * transient: `busy` clears when the write lands, and "already first" stops
 * being true the moment a move succeeds, which is exactly when this button is
 * holding focus. Disabling it then makes the browser move focus to `body` and
 * nothing hands it back.
 */
function RowButton({
  label,
  icon: Icon,
  unavailable,
  busy,
  danger,
  onClick,
}: {
  label: string;
  icon: typeof ArrowUp;
  unavailable: boolean;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (unavailable || busy) return;
        onClick();
      }}
      aria-disabled={unavailable || busy || undefined}
      aria-label={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-30 ${
        danger
          ? "text-signal-danger hover:border-signal-danger/50 hover:bg-signal-danger/10 hover:text-rose-300"
          : "text-ink-muted hover:border-line-accent hover:text-ink"
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
