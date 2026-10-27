import { existsSync, readFileSync } from "node:fs";
import { parseAlertsFile } from "./alerts.js";
import { confidenceScore } from "./csv.js";
import { detectionsNearSites, loadFirmsDetections } from "./firms.js";
import { addDaysISO, bboxForRadius, haversineKm, mergeBBoxes, roundKm, todayISO } from "./geo.js";
import { loadGfwAlerts } from "./gfw.js";
import type { FetchLike } from "./http.js";
import { listSites, requireSite } from "./sites.js";
import { newId } from "./store.js";
import { severityRank } from "./types.js";
import type {
  Severity,
  Site,
  SourceStatus,
  Store,
  ThreatEvent,
  ThreatKind,
  ThreatScan,
} from "./types.js";
import { loadFireWeather } from "./weather.js";

export const DEFAULT_RADIUS_KM = 10;
export const DEFAULT_DAYS = 2;

export interface ScanOptions {
  dir: string;
  siteRef?: string;
  radiusKm?: number;
  days?: number;
  offline?: boolean;
  alertsFile?: string;
  gfwApiKey?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface ScanResult {
  scan: ThreatScan;
  events: ThreatEvent[];
  sources: SourceStatus[];
}

export function eventKey(event: Pick<ThreatEvent, "siteId" | "kind" | "date" | "summary">): string {
  return `${event.siteId}|${event.kind}|${event.date}|${event.summary.toLowerCase()}`;
}

export function fireSeverity(confidence: string): Severity {
  const key = confidence.trim().toLowerCase();
  if (key === "h" || key === "high") return "warning";
  if (key === "n" || key === "nominal") return "watch";
  if (key === "l" || key === "low") return "info";
  const score = confidenceScore(confidence);
  if (score >= 80) return "warning";
  if (score >= 50) return "watch";
  return "info";
}

export function canopySeverity(confidence: number | null): Severity {
  if (confidence === null) return "watch";
  if (confidence >= 4) return "warning";
  if (confidence >= 3) return "watch";
  return "info";
}

function makeEvent(
  site: Site,
  kind: ThreatKind,
  severity: Severity,
  date: string,
  summary: string,
  source: string,
  extra: Partial<ThreatEvent> = {},
): ThreatEvent {
  return {
    id: newId("threat"),
    siteId: site.id,
    kind,
    severity,
    date,
    summary,
    source,
    ...extra,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function scanThreats(store: Store, options: ScanOptions): Promise<ScanResult> {
  const now = options.now ?? new Date();
  const offline = options.offline === true;
  const radiusKm = clamp(options.radiusKm ?? DEFAULT_RADIUS_KM, 0.5, 100);
  const days = Math.round(clamp(options.days ?? DEFAULT_DAYS, 1, 7));
  const siteRef = options.siteRef ?? "all";
  const sites = siteRef === "all" ? listSites(store) : [requireSite(store, siteRef)];
  if (sites.length === 0) {
    throw new Error("no sites are registered; add a site before scanning for threats");
  }

  const since = addDaysISO(todayISO(now), -(days - 1));
  const candidates: ThreatEvent[] = [];
  const sources: SourceStatus[] = [];

  try {
    const firms = await loadFirmsDetections({
      dir: options.dir,
      days,
      offline,
      fetchImpl: options.fetchImpl,
      now,
    });
    const nearby = detectionsNearSites(
      firms.detections,
      sites.map((site) => ({ id: site.id, lat: site.lat, lon: site.lon, name: site.name })),
      radiusKm,
      days,
      now,
      haversineKm,
      roundKm,
    );
    for (const detection of nearby) {
      const site = sites.find((row) => row.id === detection.siteId);
      if (!site) continue;
      candidates.push(
        makeEvent(
          site,
          "fire",
          fireSeverity(detection.confidence),
          detection.date,
          `Fire detection ${detection.distanceKm} km from ${site.name}`,
          "firms",
          {
            distanceKm: detection.distanceKm,
            lat: detection.lat,
            lon: detection.lon,
            detail: {
              confidence: detection.confidence,
              frp: detection.frp ?? 0,
              satellite: detection.satellite,
              time: detection.time,
            },
          },
        ),
      );
    }
    sources.push({
      source: "firms",
      state: "ok",
      message: `${nearby.length} detection(s) within ${radiusKm} km (${firms.cached ? "cache" : "live"}, ${firms.dataset})`,
      fetchedAt: firms.fetchedAt,
    });
  } catch (error) {
    sources.push({
      source: "firms",
      state: offline ? "skipped" : "error",
      message: errorText(error),
    });
  }

  let weatherOk = 0;
  const weatherErrors: string[] = [];
  for (const site of sites) {
    try {
      const weather = await loadFireWeather({
        site: { id: site.id, lat: site.lat, lon: site.lon },
        dir: options.dir,
        days,
        offline,
        fetchImpl: options.fetchImpl,
        now,
      });
      weatherOk += 1;
      for (const day of weather.days) {
        if (day.severity === null) continue;
        candidates.push(
          makeEvent(
            site,
            "fire-weather",
            day.severity,
            day.date,
            `Fire weather index ${day.index} at ${site.name}`,
            "open-meteo",
            {
              detail: {
                index: day.index,
                tmaxC: day.tmax,
                rhMin: day.rhMin,
                windMaxKmh: day.windMax,
                precipMm: day.precip,
              },
            },
          ),
        );
      }
    } catch (error) {
      weatherErrors.push(`${site.name}: ${errorText(error)}`);
    }
  }
  if (weatherOk > 0) {
    sources.push({
      source: "open-meteo",
      state: weatherErrors.length > 0 ? "error" : "ok",
      message:
        weatherErrors.length > 0
          ? `${weatherOk} site(s) read, ${weatherErrors.length} failed: ${weatherErrors.join("; ")}`
          : `${weatherOk} site(s) read`,
      fetchedAt: now.toISOString(),
    });
  } else if (weatherErrors.length > 0) {
    sources.push({
      source: "open-meteo",
      state: offline ? "skipped" : "error",
      message: weatherErrors.join("; "),
    });
  }

  const apiKey = options.gfwApiKey ?? process.env.GFW_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    sources.push({
      source: "gfw",
      state: "skipped",
      message: "GFW_API_KEY is not set; tree-cover loss alerts were not checked",
    });
  } else {
    try {
      const boxes = sites.map((site) => bboxForRadius({ lat: site.lat, lon: site.lon }, radiusKm));
      const bbox = mergeBBoxes(boxes);
      if (!bbox) throw new Error("no sites to query");
      const alerts = await loadGfwAlerts({
        apiKey,
        bbox,
        since,
        fetchImpl: options.fetchImpl,
      });
      let used = 0;
      for (const alert of alerts) {
        const site = sites
          .map((candidate) => ({ candidate, km: haversineKm(alert, { lat: candidate.lat, lon: candidate.lon }) }))
          .filter((row) => row.km <= radiusKm)
          .sort((a, b) => a.km - b.km)[0];
        if (!site) continue;
        used += 1;
        candidates.push(
          makeEvent(
            site.candidate,
            "canopy-loss",
            canopySeverity(alert.confidence),
            alert.date,
            `Tree-cover loss alert ${roundKm(site.km)} km from ${site.candidate.name}`,
            "gfw",
            {
              distanceKm: roundKm(site.km),
              lat: alert.lat,
              lon: alert.lon,
              detail: { confidence: alert.confidence ?? 0 },
            },
          ),
        );
      }
      sources.push({
        source: "gfw",
        state: "ok",
        message: `${used} alert(s) within ${radiusKm} km`,
        fetchedAt: now.toISOString(),
      });
    } catch (error) {
      sources.push({ source: "gfw", state: "error", message: errorText(error) });
    }
  }

  if (options.alertsFile) {
    try {
      if (!existsSync(options.alertsFile)) {
        throw new Error(`alerts file not found: ${options.alertsFile}`);
      }
      const text = readFileSync(options.alertsFile, "utf8");
      const alerts = parseAlertsFile(text, options.alertsFile);
      let used = 0;
      for (const alert of alerts) {
        if (alert.date < since) continue;
        const site = sites
          .map((candidate) => ({ candidate, km: haversineKm(alert, { lat: candidate.lat, lon: candidate.lon }) }))
          .filter((row) => row.km <= radiusKm)
          .sort((a, b) => a.km - b.km)[0];
        if (!site) continue;
        used += 1;
        candidates.push(
          makeEvent(
            site.candidate,
            alert.kind,
            alert.severity,
            alert.date,
            alert.summary ?? `${alert.kind} alert ${roundKm(site.km)} km from ${site.candidate.name}`,
            "alerts-file",
            { distanceKm: roundKm(site.km), lat: alert.lat, lon: alert.lon },
          ),
        );
      }
      sources.push({
        source: "alerts-file",
        state: "ok",
        message: `${used} alert(s) imported from ${options.alertsFile}`,
        fetchedAt: now.toISOString(),
      });
    } catch (error) {
      sources.push({ source: "alerts-file", state: "error", message: errorText(error) });
    }
  }

  const existing = new Set(store.threats.map((event) => eventKey(event)));
  const added: ThreatEvent[] = [];
  for (const event of candidates) {
    const key = eventKey(event);
    if (existing.has(key)) continue;
    existing.add(key);
    store.threats.push(event);
    added.push(event);
  }

  const scan: ThreatScan = {
    id: newId("scan"),
    scannedAt: now.toISOString(),
    siteIds: sites.map((site) => site.id),
    radiusKm,
    days,
    offline,
    events: added.length,
    sources,
  };
  store.scans.push(scan);
  if (store.scans.length > 50) store.scans = store.scans.slice(-50);

  return { scan, events: added, sources };
}

export interface ThreatFilter {
  siteRef?: string;
  severity?: Severity;
  limit?: number;
}

export function listThreats(store: Store, filter: ThreatFilter = {}): ThreatEvent[] {
  const siteId = filter.siteRef ? requireSite(store, filter.siteRef).id : undefined;
  const minRank = filter.severity ? severityRank(filter.severity) : 0;
  const rows = store.threats
    .filter((event) => siteId === undefined || event.siteId === siteId)
    .filter((event) => severityRank(event.severity) >= minRank)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || severityRank(b.severity) - severityRank(a.severity),
    );
  return filter.limit === undefined ? rows : rows.slice(0, filter.limit);
}

export function threatsForSite(store: Store, siteId: string): ThreatEvent[] {
  return listThreats(store, { limit: 5 }).filter((event) => event.siteId === siteId);
}