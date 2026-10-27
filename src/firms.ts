import { readCachedText, writeCachedText } from "./cache.js";
import { confidenceScore, findColumn, headerKey, parseCsv, parseNumber, rowsToObjects } from "./csv.js";
import { addDaysISO, todayISO } from "./geo.js";
import { getText, type FetchLike } from "./http.js";

/** NASA FIRMS global VIIRS detections. No key is needed for these files. */
export const FIRMS_24H_URL =
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv";
export const FIRMS_7D_URL =
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv";

export interface FireDetection {
  lat: number;
  lon: number;
  date: string;
  time: string;
  confidence: string;
  confidenceScore: number;
  frp: number | null;
  satellite: string;
}

function formatTime(value: string): string {
  const digits = value.replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** Parse a FIRMS area CSV. Unknown extra columns are ignored. */
export function parseFirmsCsv(csv: string): FireDetection[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0];
  const latCol = findColumn(header, ["latitude", "lat"]);
  const lonCol = findColumn(header, ["longitude", "lon", "lng"]);
  const dateCol = findColumn(header, ["acq_date", "date"]);
  const timeCol = findColumn(header, ["acq_time", "time"]);
  const confCol = findColumn(header, ["confidence", "conf"]);
  const frpCol = findColumn(header, ["frp", "fire_radiative_power"]);
  const satCol = findColumn(header, ["satellite", "instrument"]);
  if (latCol < 0 || lonCol < 0 || dateCol < 0) return [];

  const objects = rowsToObjects(rows);
  const out: FireDetection[] = [];
  for (const row of objects) {
    const lat = parseNumber(row[headerKey(header[latCol])]);
    const lon = parseNumber(row[headerKey(header[lonCol])]);
    const date = row[headerKey(header[dateCol])] ?? "";
    if (lat === null || lon === null) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const rawConfidence = confCol >= 0 ? row[headerKey(header[confCol])] ?? "" : "";
    const frp = frpCol >= 0 ? parseNumber(row[headerKey(header[frpCol])]) : null;
    out.push({
      lat,
      lon,
      date,
      time: timeCol >= 0 ? formatTime(row[headerKey(header[timeCol])] ?? "") : "00:00",
      confidence: rawConfidence.trim(),
      confidenceScore: confidenceScore(rawConfidence),
      frp,
      satellite: satCol >= 0 ? row[headerKey(header[satCol])] ?? "" : "",
    });
  }
  return out;
}

export interface FirmsOptions {
  dir: string;
  days: number;
  offline?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
  force?: boolean;
}

export interface FirmsResult {
  detections: FireDetection[];
  cached: boolean;
  fetchedAt: string;
  dataset: "24h" | "7d";
}

const HOUR_MS = 3600 * 1000;

/** Load FIRMS detections from cache or network. Offline mode never touches the network. */
export async function loadFirmsDetections(options: FirmsOptions): Promise<FirmsResult> {
  const now = options.now ?? new Date();
  const today = todayISO(now);
  const dataset: "24h" | "7d" = options.days > 1 ? "7d" : "24h";
  const key = `firms-${dataset}-${today}.csv`;
  const ttl = dataset === "24h" ? 3 * HOUR_MS : 6 * HOUR_MS;
  const cached = readCachedText(options.dir, key, ttl, now);

  if (cached && !cached.stale && !options.force) {
    return {
      detections: parseFirmsCsv(cached.text),
      cached: true,
      fetchedAt: cached.fetchedAt,
      dataset,
    };
  }
  if (options.offline) {
    if (!cached) {
      throw new Error(`offline mode has no cached FIRMS file for ${today}`);
    }
    return {
      detections: parseFirmsCsv(cached.text),
      cached: true,
      fetchedAt: cached.fetchedAt,
      dataset,
    };
  }

  const url = dataset === "7d" ? FIRMS_7D_URL : FIRMS_24H_URL;
  const text = await getText(url, {
    fetchImpl: options.fetchImpl,
    label: `FIRMS ${dataset} detections`,
    timeoutMs: 45000,
  });
  writeCachedText(options.dir, key, text, now);
  return { detections: parseFirmsCsv(text), cached: false, fetchedAt: now.toISOString(), dataset };
}

export interface NearbyDetection extends FireDetection {
  siteId: string;
  distanceKm: number;
}

/** Filter detections to a date window, then to sites within the radius. */
export function detectionsNearSites(
  detections: FireDetection[],
  sites: { id: string; lat: number; lon: number; name: string }[],
  radiusKm: number,
  days: number,
  now: Date,
  distance: (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => number,
  round: (km: number) => number,
): NearbyDetection[] {
  const since = addDaysISO(todayISO(now), -(Math.max(1, days) - 1));
  const out: NearbyDetection[] = [];
  for (const detection of detections) {
    if (detection.date < since) continue;
    let best: { siteId: string; distanceKm: number } | null = null;
    for (const site of sites) {
      const km = distance(detection, site);
      if (km > radiusKm) continue;
      if (best === null || km < best.distanceKm) {
        best = { siteId: site.id, distanceKm: round(km) };
      }
    }
    if (best) out.push({ ...detection, ...best });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.distanceKm - a.distanceKm);
}