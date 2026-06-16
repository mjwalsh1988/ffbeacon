"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Send, Trash2, Film, Smile } from "lucide-react";
import {
  POST_BODY_MAX,
  POST_LINKS_MAX,
  codePointLength,
  countLinks,
  graphemeLength,
  type SignalGifInput,
} from "@/lib/signal";
import { GifPicker } from "@/components/signal/gif-picker";
import { AnimatedGif } from "@/components/signal/animated-gif";
import { EmojiPicker } from "@/components/signal/emoji-picker";
import { insertAtCursor } from "@/lib/signal/insert-at-cursor";
import type { EmojiEntry } from "@/lib/signal/emoji-data";
import { createPost, type PostImageInput } from "./wall-actions";

/**
 * Composer for a new Wall post (owner only). Text plus up to 4 images, each with
 * REQUIRED alt text (creators and viewers may be blind). The character counter
 * shows a grapheme-aware count for readability but the over-limit gate uses
 * codePointLength so it agrees with the database char_length CHECK. Images upload
 * one at a time through the hardening route; submit is blocked until every image
 * has a description. Polite live region confirms success; assertive carries errors.
 */

const IMAGES_MAX = 4;

type DraftImage = {
  key: string;
  path: string;
  url: string;
  alt: string;
  width: number;
  height: number;
};

let imageKeySeq = 0;

export function WallComposer() {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<DraftImage[]>([]);
  const [gif, setGif] = useState<SignalGifInput | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const fieldId = useId();
  const helpId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  const codePoints = codePointLength(body);
  const graphemes = graphemeLength(body);
  const links = countLinks(body);
  const trimmedEmpty = body.trim().length === 0;
  const overLength = codePoints > POST_BODY_MAX;
  const overLinks = links > POST_LINKS_MAX;
  const missingAlt = images.some((img) => img.alt.trim().length === 0);
  // A post is images XOR a GIF.
  const hasImages = images.length > 0;
  const hasGif = gif !== null;
  const disabled =
    pending || uploading || trimmedEmpty || overLength || overLinks || missingAlt;

  const onPickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (hasGif) {
      setError("A post can have images or a GIF, not both. Remove the GIF first.");
      return;
    }
    if (images.length >= IMAGES_MAX) {
      setError(`You can attach at most ${IMAGES_MAX} images.`);
      return;
    }
    setError(null);
    setUploading(true);
    setStatus("Uploading image...");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/signal/post-image", {
        method: "POST",
        headers: { "x-requested-with": "ff-beacon" },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        path?: string;
        url?: string;
        width?: number;
        height?: number;
        error?: string;
      };
      if (res.ok && data.ok && data.path && data.url) {
        setImages((prev) => [
          ...prev,
          {
            key: `img-${imageKeySeq++}`,
            path: data.path!,
            url: data.url!,
            alt: "",
            width: data.width ?? 0,
            height: data.height ?? 0,
          },
        ]);
        setStatus("Image added. Add a description for it.");
      } else {
        setError(data.error ?? "Could not upload that image.");
        setStatus("");
      }
    } catch {
      setError("Could not upload that image.");
      setStatus("");
    } finally {
      setUploading(false);
    }
  };

  const setAlt = (key: string, alt: string) =>
    setImages((prev) => prev.map((img) => (img.key === key ? { ...img, alt } : img)));

  const removeImage = (key: string) =>
    setImages((prev) => prev.filter((img) => img.key !== key));

  const insertGif = (g: SignalGifInput) => {
    setGif(g);
    setPickerOpen(false);
    setStatus("GIF added.");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const closePicker = () => {
    setPickerOpen(false);
    requestAnimationFrame(() => gifButtonRef.current?.focus());
  };

  const removeGif = () => {
    setGif(null);
    setStatus("GIF removed.");
    requestAnimationFrame(() => gifButtonRef.current?.focus());
  };

  // Opening one picker closes the other so the composer toolbar stays coherent.
  const toggleGifPicker = () => {
    setEmojiOpen(false);
    setPickerOpen((open) => !open);
  };
  const toggleEmojiPicker = () => {
    setPickerOpen(false);
    setEmojiOpen((open) => !open);
  };
  const insertEmoji = (entry: EmojiEntry) => {
    const { value: next, caret } = insertAtCursor(
      textareaRef.current,
      body,
      entry.char,
    );
    setBody(next);
    setEmojiOpen(false);
    setStatus(`Added emoji ${entry.name}.`);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  };
  const closeEmoji = () => {
    setEmojiOpen(false);
    requestAnimationFrame(() => emojiButtonRef.current?.focus());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus("");
    if (disabled) return;
    const payload: PostImageInput[] = images.map((img) => ({
      path: img.path,
      alt: img.alt.trim(),
      width: img.width,
      height: img.height,
    }));
    startTransition(async () => {
      const res = await createPost(body.trim(), payload, gif ?? undefined);
      if (res.ok) {
        setBody("");
        setImages([]);
        setGif(null);
        setPickerOpen(false);
        setStatus("Post published.");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        Write a post
      </label>
      <p id={helpId} className="mt-1 text-xs text-ink-muted">
        Up to {POST_BODY_MAX} characters, {POST_LINKS_MAX} links, and either{" "}
        {IMAGES_MAX} images or one GIF. Emoji can count as several characters, so
        the limit is measured the way the server stores it.
      </p>
      <textarea
        id={fieldId}
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={helpId}
        aria-invalid={overLength || overLinks}
        rows={4}
        placeholder="Share a take, a lineup call, or a link."
        className="mt-2 w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span className={overLength ? "font-semibold text-signal-danger" : "text-ink-muted"}>
          {graphemes} characters
          {overLength ? " (over the limit)" : ` of ${POST_BODY_MAX}`}
        </span>
        <span className={overLinks ? "font-semibold text-signal-danger" : "text-ink-muted"}>
          {links} of {POST_LINKS_MAX} links
        </span>
      </div>

      {images.length > 0 && (
        <ul role="list" className="mt-4 flex flex-col gap-3">
          {images.map((img, index) => (
            <li
              key={img.key}
              className="flex gap-3 rounded-card border border-line bg-base p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt.trim() ? img.alt : `Image ${index + 1}, awaiting a description`}
                className="h-20 w-20 shrink-0 rounded-card object-cover"
              />
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-medium text-ink">
                  Describe image {index + 1} (required)
                  <input
                    type="text"
                    value={img.alt}
                    maxLength={420}
                    onChange={(e) => setAlt(img.key, e.target.value)}
                    aria-invalid={img.alt.trim().length === 0}
                    aria-describedby={`alt-hint-${img.key}`}
                    placeholder="Who or what is in this image?"
                    className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none"
                  />
                </label>
                <p id={`alt-hint-${img.key}`} className="mt-1 text-xs text-ink-muted">
                  {img.alt.trim().length} of 420 characters. This is read aloud to
                  people using a screen reader.
                </p>
                <button
                  type="button"
                  onClick={() => removeImage(img.key)}
                  className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  Remove image {index + 1}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {gif && (
        <div className="mt-4 rounded-card border border-line bg-base p-3">
          <AnimatedGif
            gif={{
              giphyId: gif.giphy_id,
              url: gif.url,
              previewUrl: gif.preview_url,
              alt: gif.alt,
              width: gif.width,
              height: gif.height,
            }}
          />
          <button
            type="button"
            onClick={removeGif}
            className="mt-2 inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            Remove GIF
          </button>
        </div>
      )}

      {pickerOpen && (
        <GifPicker onInsert={insertGif} onClose={closePicker} />
      )}

      {emojiOpen && (
        <EmojiPicker onSelect={insertEmoji} onClose={closeEmoji} />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPickFile}
        className="sr-only"
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={disabled}
          aria-describedby={missingAlt ? "alt-required-hint" : undefined}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {pending ? "Posting..." : "Post"}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending || uploading || hasGif || images.length >= IMAGES_MAX}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card border border-line px-4 text-sm font-semibold text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
        >
          <ImagePlus aria-hidden="true" className="h-4 w-4" />
          {uploading ? "Uploading..." : "Add image"}
        </button>
        <button
          ref={gifButtonRef}
          type="button"
          onClick={toggleGifPicker}
          disabled={pending || uploading || hasImages || hasGif}
          aria-expanded={pickerOpen}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card border border-line px-4 text-sm font-semibold text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
        >
          <Film aria-hidden="true" className="h-4 w-4" />
          {hasGif ? "GIF added" : "Add GIF"}
        </button>
        <button
          ref={emojiButtonRef}
          type="button"
          onClick={toggleEmojiPicker}
          disabled={pending}
          aria-expanded={emojiOpen}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card border border-line px-4 text-sm font-semibold text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
        >
          <Smile aria-hidden="true" className="h-4 w-4" />
          Insert emoji
        </button>
        <span className="text-xs text-ink-muted">
          {images.length} of {IMAGES_MAX} images
        </span>
        <p aria-live="polite" role="status" className="min-h-[1.25rem] flex-1 text-sm text-signal-success">
          {status}
        </p>
      </div>

      {missingAlt && images.length > 0 && (
        <p id="alt-required-hint" className="mt-2 text-xs text-ink-muted">
          Add a description to each image before posting.
        </p>
      )}

      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
