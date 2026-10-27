/** Minimal RFC 4180 style CSV reader and writer. No dependencies. */

export type CsvValue = string | number | boolean | null | undefined;

/** Parse CSV text into rows. Handles quotes, escaped quotes, CRLF, and a BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (input[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows.filter((candidate) => !(candidate.length === 1 && candidate[0] === ""));
}

export function csvEscape(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

/** Normalise a header cell for tolerant lookup. */
export function headerKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Find a column index by any of the given aliases. */
export function findColumn(header: string[], aliases: string[]): number {
  const keys = aliases.map(headerKey);
  for (let i = 0; i < header.length; i += 1) {
    if (keys.includes(headerKey(header[i]))) return i;
  }
  return -1;
}

/** Build objects from a header row and data rows. */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[headerKey(name)] = (row[index] ?? "").trim();
    });
    return record;
  });
}

export function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** FIRMS uses "l", "n", "h" for confidence. Map to a 0..100-ish score. */
export function confidenceScore(value: string): number {
  const key = value.trim().toLowerCase();
  if (key === "h" || key === "high") return 90;
  if (key === "n" || key === "nominal") return 60;
  if (key === "l" || key === "low") return 30;
  const num = parseNumber(value);
  if (num !== null) return Math.max(0, Math.min(100, num));
  return 0;
}