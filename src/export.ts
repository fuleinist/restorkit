import { toCsv } from "./csv.js";
import { plantedTotal, listSites, survivalStats } from "./sites.js";
import type { Store } from "./types.js";

export interface GeoFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number | null>;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/** Sites and threats as one point FeatureCollection. */
export function buildGeoJson(store: Store): FeatureCollection {
  const stats = new Map(survivalStats(store).map((row) => [row.siteId, row]));
  const features: GeoFeature[] = [];

  for (const site of listSites(store)) {
    const stat = stats.get(site.id);
    const threats = store.threats.filter((event) => event.siteId === site.id).length;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [site.lon, site.lat] },
      properties: {
        kind: "site",
        id: site.id,
        name: site.name,
        area_ha: site.areaHa ?? null,
        species: site.species.join("; "),
        seedlings: plantedTotal(store, site.id),
        survival_rate: stat?.rate ?? null,
        last_check: stat?.checkDate ?? null,
        threats,
      },
    });
  }

  for (const threat of store.threats) {
    const site = store.sites.find((row) => row.id === threat.siteId);
    if (threat.lat === undefined || threat.lon === undefined) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [threat.lon, threat.lat] },
      properties: {
        kind: "threat",
        id: threat.id,
        site: site?.name ?? "",
        threat_kind: threat.kind,
        severity: threat.severity,
        date: threat.date,
        summary: threat.summary,
        source: threat.source,
        distance_km: threat.distanceKm ?? null,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export const SITE_CSV_HEADER = [
  "id",
  "name",
  "lat",
  "lon",
  "area_ha",
  "species",
  "plantings",
  "seedlings",
  "survival_rate",
  "last_check",
  "threats",
] as const;

/** One row per site with stable columns. */
export function buildSiteCsv(store: Store): string {
  const stats = new Map(survivalStats(store).map((row) => [row.siteId, row]));
  const rows: (string | number | null)[][] = [[...SITE_CSV_HEADER]];
  for (const site of listSites(store)) {
    const stat = stats.get(site.id);
    rows.push([
      site.id,
      site.name,
      site.lat,
      site.lon,
      site.areaHa ?? null,
      site.species.join("; "),
      store.plantings.filter((row) => row.siteId === site.id).length,
      plantedTotal(store, site.id),
      stat?.rate ?? null,
      stat?.checkDate ?? null,
      store.threats.filter((row) => row.siteId === site.id).length,
    ]);
  }
  return toCsv(rows);
}

export const THREAT_CSV_HEADER = [
  "id",
  "site",
  "kind",
  "severity",
  "date",
  "summary",
  "source",
  "distance_km",
  "lat",
  "lon",
] as const;

export function buildThreatCsv(store: Store): string {
  const rows: (string | number | null)[][] = [[...THREAT_CSV_HEADER]];
  for (const threat of store.threats) {
    const site = store.sites.find((row) => row.id === threat.siteId);
    rows.push([
      threat.id,
      site?.name ?? "",
      threat.kind,
      threat.severity,
      threat.date,
      threat.summary,
      threat.source,
      threat.distanceKm ?? null,
      threat.lat ?? null,
      threat.lon ?? null,
    ]);
  }
  return toCsv(rows);
}

export const PLANTING_CSV_HEADER = [
  "id",
  "site",
  "date",
  "species",
  "count",
  "method",
  "notes",
] as const;

export function buildPlantingCsv(store: Store): string {
  const rows: (string | number | null)[][] = [[...PLANTING_CSV_HEADER]];
  for (const planting of store.plantings) {
    const site = store.sites.find((row) => row.id === planting.siteId);
    rows.push([
      planting.id,
      site?.name ?? "",
      planting.date,
      planting.species,
      planting.count,
      planting.method ?? null,
      planting.notes ?? null,
    ]);
  }
  return toCsv(rows);
}