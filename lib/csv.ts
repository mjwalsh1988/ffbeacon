/**
 * Dependency-free CSV parser (RFC-4180-ish).
 *
 * Written for the DynastyProcess sync, whose player names contain commas
 * ("Smith, A.J." style) and are quoted, so a naive split(",") corrupts rows.
 * Handles: quoted fields, embedded commas inside quotes, escaped quotes ("")
 * inside quotes, and both LF and CRLF line endings. Fields are returned as raw
 * strings; numeric coercion is the caller's job.
 *
 * Intentionally not a streaming parser. The DP files are a few hundred KB, so
 * parsing the whole text in memory is fine and keeps the code obvious.
 */

/** Tokenize raw CSV text into an array of string-cell rows. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let started = false; // did this row get any cell/char yet?

  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // skip the second quote of the escaped pair
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      started = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      started = true;
      continue;
    }
    if (c === "\r") {
      continue; // swallow CR; the LF (or EOF) closes the row
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
      continue;
    }
    field += c;
    started = true;
  }

  // Flush a trailing row that had no terminating newline.
  if (started || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse CSV text into header-keyed records. Blank trailing lines are skipped.
 * Missing trailing cells become "" so every record has every header key.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0] === "") continue; // blank line
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) {
      rec[header[c]] = cells[c] ?? "";
    }
    out.push(rec);
  }
  return out;
}

/**
 * Return just the header (first-row) cell names. Used by the backfill
 * schema-drift guard to compare an old commit's columns without parsing the
 * whole file.
 */
export function parseCsvHeader(text: string): string[] {
  const rows = parseCsvRows(text);
  return rows[0] ?? [];
}
