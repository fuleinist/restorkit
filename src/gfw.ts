import { getJson, type FetchLike } from "./http.js";
import type { BBox } from "./types.js";

/**
 * Global Forest Watch tree-cover loss alerts.
 * The data API needs a free API key (GFW_API_KEY).
 */
export const GFW_DATASET = "umd_glad_landsat_alerts";
export const GFW_QUERY_URL = `https://data-api.globalforestwatch.org/dataset/${GFW_DATASET}/latest/query`;

export interface GfwAlert {
  lat: number;
  lon: number;
  date: string;
  confidence: number | null;
}

interface GfwRow {
  [key: string]: unknown;
}

interface GfwResponse {
  data?: GfwRow[];
  status?: string;
  message?: string;
}

function pick(row: GfwRow, needles: string[]): unknown {
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase();
    if (needles.some((needle) => lower.includes(needle))) return row[key];
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function toDate(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (typeof value === "number") {
    const fromEpoch = new Date(value);
    if (!Number.isNaN(fromEpoch.getTime())) return fromEpoch.toISOString().slice(0, 10);
  }
  return null;
}

export function buildGfwQuery(bbox: BBox, since: string, limit = 2000): string {
  const sql = [
    "SELECT latitude, longitude, umd_glad_landsat_alerts__date, umd_glad_landsat_alerts__confidence",
    "FROM data",
    `WHERE umd_glad_landsat_alerts__date >= '${since}'`,
    `AND latitude >= ${bbox.south} AND latitude <= ${bbox.north}`,
    `AND longitude >= ${bbox.west} AND longitude <= ${bbox.east}`,
    `LIMIT ${limit}`,
  ].join(" ");
  return `${GFW_QUERY_URL}?sql=${encodeURIComponent(sql)}`;
}

export function parseGfwResponse(payload: GfwResponse): GfwAlert[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const out: GfwAlert[] = [];
  for (const row of rows) {
    const lat = toNumber(pick(row, ["latitude", "lat"]));
    const lon = toNumber(pick(row, ["longitude", "lon"]));
    const date = toDate(pick(row, ["date"]));
    if (lat === null || lon === null || date === null) continue;
    const confidence = toNumber(pick(row, ["confidence"]));
    out.push({ lat, lon, date, confidence });
  }
  return out;
}

export interface GfwOptions {
  apiKey: string | undefined;
  bbox: BBox;
  since: string;
  fetchImpl?: FetchLike;
  limit?: number;
}

/** Fetch alerts. Throws a clear error when the key is missing or rejected. */
export async function loadGfwAlerts(options: GfwOptions): Promise<GfwAlert[]> {
  const key = options.apiKey?.trim();
  if (!key) {
    throw new Error("GFW_API_KEY is not set");
  }
  const url = buildGfwQuery(options.bbox, options.since, options.limit ?? 2000);
  const payload = await getJson<GfwResponse>(url, {
    fetchImpl: options.fetchImpl,
    headers: { "x-api-key": key },
    label: "Global Forest Watch query",
    timeoutMs: 30000,
  });
  if (payload.status === "failed") {
    throw new Error(payload.message ?? "Global Forest Watch query failed");
  }
  return parseGfwResponse(payload);
}