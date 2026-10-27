import { findColumn, parseCsv, parseNumber, rowsToObjects, headerKey } from "./csv.js";
import type { Severity, ThreatKind } from "./types.js";

/** Local alert rows, for offline scans or a GFW export. */
export interface LocalAlert {
  lat: number;
  lon: number;
  date: string;
  kind: ThreatKind;
  severity: Severity;
  summary?: string;
}

const KINDS: ThreatKind[] = ["fire", "canopy-loss", "fire-weather"];
const SEVERITIES: Severity[] = ["info", "watch", "warning", "severe"];

function asKind(value: string | undefined): ThreatKind {
  const key = (value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (key === "canopy" || key === "tree-cover-loss" || key === "loss") return "canopy-loss";
  if (key === "weather" || key === "fireweather") return "fire-weather";
  return KINDS.includes(key as ThreatKind) ? (key as ThreatKind) : "canopy-loss";
}

function asSeverity(value: string | undefined): Severity {
  const key = (value ?? "").trim().toLowerCase();
  return SEVERITIES.includes(key as Severity) ? (key as Severity) : "watch";
}

export function parseAlertsCsv(text: string): LocalAlert[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const latCol = findColumn(header, ["lat", "latitude"]);
  const lonCol = findColumn(header, ["lon", "lng", "longitude"]);
  const dateCol = findColumn(header, ["date", "alert_date", "acq_date"]);
  const kindCol = findColumn(header, ["kind", "type", "alert_type"]);
  const sevCol = findColumn(header, ["severity", "confidence"]);
  const sumCol = findColumn(header, ["summary", "note", "description"]);
  if (latCol < 0 || lonCol < 0 || dateCol < 0) return [];

  const out: LocalAlert[] = [];
  for (const row of rowsToObjects(rows)) {
    const lat = parseNumber(row[headerKey(header[latCol])]);
    const lon = parseNumber(row[headerKey(header[lonCol])]);
    const date = row[headerKey(header[dateCol])] ?? "";
    if (lat === null || lon === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      lat,
      lon,
      date,
      kind: asKind(kindCol >= 0 ? row[headerKey(header[kindCol])] : undefined),
      severity: asSeverity(sevCol >= 0 ? row[headerKey(header[sevCol])] : undefined),
      summary: sumCol >= 0 ? row[headerKey(header[sumCol])] : undefined,
    });
  }
  return out;
}

interface GeoJsonFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

interface GeoJsonCollection {
  type?: string;
  features?: GeoJsonFeature[];
}

export function parseAlertsGeoJson(text: string): LocalAlert[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("alerts file is not valid JSON");
  }
  const collection = parsed as GeoJsonCollection;
  const features = Array.isArray(collection.features) ? collection.features : [];
  const out: LocalAlert[] = [];
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const props = feature.properties ?? {};
    const date = String(props.date ?? props.alert_date ?? props.acq_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      lat,
      lon,
      date,
      kind: asKind(String(props.kind ?? props.type ?? "")),
      severity: asSeverity(String(props.severity ?? "")),
      summary: props.summary === undefined ? undefined : String(props.summary),
    });
  }
  return out;
}

/** Read either format, chosen by file extension or by the first non-space character. */
export function parseAlertsFile(text: string, filename: string): LocalAlert[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".geojson")) return parseAlertsGeoJson(text);
  if (lower.endsWith(".csv")) return parseAlertsCsv(text);
  return text.trimStart().startsWith("{") ? parseAlertsGeoJson(text) : parseAlertsCsv(text);
}