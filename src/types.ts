/** Domain types for restorkit. */

export type Severity = "info" | "watch" | "warning" | "severe";

export type ThreatKind = "fire" | "canopy-loss" | "fire-weather";

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  areaHa?: number;
  species: string[];
  plantedOn?: string;
  notes?: string;
  createdAt: string;
}

export interface Planting {
  id: string;
  siteId: string;
  date: string;
  species: string;
  count: number;
  method?: string;
  notes?: string;
  createdAt: string;
}

export interface SurvivalCheck {
  id: string;
  siteId: string;
  date: string;
  planted: number;
  alive: number;
  avgHeightCm?: number;
  notes?: string;
  createdAt: string;
}

export interface ThreatEvent {
  id: string;
  siteId: string;
  kind: ThreatKind;
  severity: Severity;
  date: string;
  summary: string;
  source: string;
  distanceKm?: number;
  lat?: number;
  lon?: number;
  detail?: Record<string, string | number | boolean>;
}

export type SourceState = "ok" | "skipped" | "error";

export interface SourceStatus {
  source: string;
  state: SourceState;
  message?: string;
  fetchedAt?: string;
}

export interface ThreatScan {
  id: string;
  scannedAt: string;
  siteIds: string[];
  radiusKm: number;
  days: number;
  offline: boolean;
  events: number;
  sources: SourceStatus[];
}

export interface Store {
  version: 1;
  sites: Site[];
  plantings: Planting[];
  checks: SurvivalCheck[];
  threats: ThreatEvent[];
  scans: ThreatScan[];
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface SurvivalStat {
  siteId: string;
  siteName: string;
  planted: number;
  alive: number;
  rate: number | null;
  checkDate: string | null;
  checks: number;
}