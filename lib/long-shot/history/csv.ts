/**
 * A small RFC 4180 CSV reader for the nflverse release files. Pure. Handles
 * quoted fields, doubled quotes, CRLF, and treats the literal NA (R's missing
 * value) as an empty string so every consumer tests `=== ""` once.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0] ?? [];
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(1)) {
    if (r.length === 1 && r[0] === "") continue;
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      const v = r[i] ?? "";
      obj[h] = v === "NA" ? "" : v;
    });
    out.push(obj);
  }
  return out;
}

/** An integer column; empty, NA or non-numeric is 0. */
export function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
