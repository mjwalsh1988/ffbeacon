// Insert text at a textarea's current caret/selection. Returns the new value and
// the caret offset to place after the inserted text. Used by the emoji picker so a
// chosen emoji lands where the user was typing (replacing any active selection),
// not appended at the end. Pure: the caller applies setValue + restores the caret.
export function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  value: string,
  insert: string,
): { value: string; caret: number } {
  if (!textarea) {
    return { value: value + insert, caret: value.length + insert.length };
  }
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + insert + value.slice(end);
  return { value: next, caret: start + insert.length };
}
