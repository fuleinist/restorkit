import type {
  Planting,
  Site,
  Store,
  SurvivalCheck,
  SurvivalStat,
  ThreatEvent,
} from "./types.js";
import { haversineKm, isValidDate, roundKm, todayISO, validLat, validLon } from "./geo.js";
import { newId } from "./store.js";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const MAX_NAME = 120;
const MAX_NOTE = 600;
const DUPLICATE_RADIUS_KM = 0.05;

export interface SiteInput {
  name: string;
  lat: number;
  lon: number;
  areaHa?: number;
  species?: string[];
  plantedOn?: string;
  notes?: string;
}

export interface PlantingInput {
  siteRef: string;
  species: string;
  count: number;
  date?: string;
  method?: string;
  notes?: string;
}

export interface CheckInput {
  siteRef: string;
  alive: number;
  planted?: number;
  date?: string;
  avgHeightCm?: number;
  notes?: string;
}

function cleanText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed.slice(0, max);
}

function requireText(value: string | undefined, label: string): string {
  const cleaned = cleanText(value, MAX_NAME);
  if (!cleaned) throw new DomainError(`${label} is required`);
  return cleaned;
}

function normaliseSpecies(species: string[] | undefined): string[] {
  if (!species) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of species) {
    const name = raw.trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function parseCount(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new DomainError(`${label} must be a whole number`);
  }
  return value;
}

function checkNotFuture(date: string, label: string, now: Date): void {
  if (!isValidDate(date)) throw new DomainError(`${label} must be a date in YYYY-MM-DD form`);
  if (date > todayISO(now)) throw new DomainError(`${label} must not be in the future`);
}

export function addSite(store: Store, input: SiteInput, now: Date = new Date()): Site {
  const name = requireText(input.name, "site name");
  if (!validLat(input.lat)) throw new DomainError("latitude must be between -90 and 90");
  if (!validLon(input.lon)) throw new DomainError("longitude must be between -180 and 180");

  let areaHa: number | undefined;
  if (input.areaHa !== undefined) {
    if (!Number.isFinite(input.areaHa) || input.areaHa <= 0) {
      throw new DomainError("area must be a positive number of hectares");
    }
    areaHa = Math.round(input.areaHa * 100) / 100;
  }

  let plantedOn: string | undefined;
  if (input.plantedOn !== undefined && input.plantedOn !== "") {
    checkNotFuture(input.plantedOn, "planting date", now);
    plantedOn = input.plantedOn;
  }

  const location = { lat: input.lat, lon: input.lon };
  const duplicate = store.sites.find(
    (site) =>
      site.name.toLowerCase() === name.toLowerCase() &&
      haversineKm({ lat: site.lat, lon: site.lon }, location) <= DUPLICATE_RADIUS_KM,
  );
  if (duplicate) {
    throw new DomainError(
      `a site named "${duplicate.name}" already exists at this location (${duplicate.id})`,
    );
  }

  const site: Site = {
    id: newId("site"),
    name,
    lat: Math.round(input.lat * 1e6) / 1e6,
    lon: Math.round(input.lon * 1e6) / 1e6,
    species: normaliseSpecies(input.species),
    createdAt: now.toISOString(),
  };
  if (areaHa !== undefined) site.areaHa = areaHa;
  if (plantedOn !== undefined) site.plantedOn = plantedOn;
  const notes = cleanText(input.notes, MAX_NOTE);
  if (notes !== undefined) site.notes = notes;

  store.sites.push(site);
  return site;
}

/** Find a site by id, exact name, or unique name prefix. */
export function findSite(store: Store, ref: string): Site | undefined {
  const needle = ref.trim();
  if (needle === "") return undefined;
  const byId = store.sites.find((site) => site.id === needle);
  if (byId) return byId;

  const lower = needle.toLowerCase();
  const exact = store.sites.filter((site) => site.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new DomainError(
      `site name "${needle}" is ambiguous; use an id: ${exact.map((s) => s.id).join(", ")}`,
    );
  }

  const prefix = store.sites.filter((site) => site.name.toLowerCase().startsWith(lower));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    throw new DomainError(
      `site reference "${needle}" matches ${prefix.length} sites: ${prefix
        .map((s) => s.name)
        .join(", ")}`,
    );
  }
  return undefined;
}

export function requireSite(store: Store, ref: string): Site {
  const site = findSite(store, ref);
  if (!site) throw new DomainError(`no site matches "${ref}"`);
  return site;
}

export interface RemovedSite {
  site: Site;
  removedPlantings: number;
  removedChecks: number;
  removedThreats: number;
}

export function removeSite(store: Store, ref: string): RemovedSite {
  const site = requireSite(store, ref);
  const removedPlantings = store.plantings.filter((row) => row.siteId === site.id).length;
  const removedChecks = store.checks.filter((row) => row.siteId === site.id).length;
  const removedThreats = store.threats.filter((row) => row.siteId === site.id).length;
  store.plantings = store.plantings.filter((row) => row.siteId !== site.id);
  store.checks = store.checks.filter((row) => row.siteId !== site.id);
  store.threats = store.threats.filter((row) => row.siteId !== site.id);
  store.sites = store.sites.filter((row) => row.id !== site.id);
  return { site, removedPlantings, removedChecks, removedThreats };
}

export function listSites(store: Store): Site[] {
  return [...store.sites].sort((a, b) => a.name.localeCompare(b.name));
}

export function logPlanting(store: Store, input: PlantingInput, now: Date = new Date()): Planting {
  const site = requireSite(store, input.siteRef);
  const species = requireText(input.species, "species");
  const count = parseCount(input.count, "count");
  if (count <= 0) throw new DomainError("count must be greater than zero");
  const date = input.date ?? todayISO(now);
  checkNotFuture(date, "planting date", now);

  const planting: Planting = {
    id: newId("plant"),
    siteId: site.id,
    date,
    species,
    count,
    createdAt: now.toISOString(),
  };
  const method = cleanText(input.method, MAX_NOTE);
  if (method !== undefined) planting.method = method;
  const notes = cleanText(input.notes, MAX_NOTE);
  if (notes !== undefined) planting.notes = notes;

  store.plantings.push(planting);
  return planting;
}

export function listPlantings(store: Store, siteId?: string): Planting[] {
  return store.plantings
    .filter((row) => siteId === undefined || row.siteId === siteId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function plantedTotal(store: Store, siteId: string): number {
  return store.plantings
    .filter((row) => row.siteId === siteId)
    .reduce((sum, row) => sum + row.count, 0);
}

export function earliestPlanting(store: Store, siteId: string): string | null {
  const dates = store.plantings.filter((row) => row.siteId === siteId).map((row) => row.date);
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

export function logCheck(store: Store, input: CheckInput, now: Date = new Date()): SurvivalCheck {
  const site = requireSite(store, input.siteRef);
  const date = input.date ?? todayISO(now);
  checkNotFuture(date, "check date", now);

  const earliest = earliestPlanting(store, site.id);
  if (earliest !== null && date < earliest) {
    throw new DomainError(`check date ${date} is before the first planting at ${site.name} (${earliest})`);
  }

  const alive = parseCount(input.alive, "alive count");
  if (alive < 0) throw new DomainError("alive count must be zero or more");

  let planted: number;
  if (input.planted !== undefined) {
    planted = parseCount(input.planted, "planted count");
    if (planted <= 0) throw new DomainError("planted count must be greater than zero");
  } else {
    planted = plantedTotal(store, site.id);
    if (planted === 0) {
      throw new DomainError(
        `no plantings are logged for ${site.name}; pass --planted or log a planting first`,
      );
    }
  }
  if (alive > planted) {
    throw new DomainError(`alive count (${alive}) must not exceed planted count (${planted})`);
  }

  let avgHeightCm: number | undefined;
  if (input.avgHeightCm !== undefined) {
    if (!Number.isFinite(input.avgHeightCm) || input.avgHeightCm < 0) {
      throw new DomainError("average height must be zero or more centimetres");
    }
    avgHeightCm = Math.round(input.avgHeightCm * 10) / 10;
  }

  const check: SurvivalCheck = {
    id: newId("check"),
    siteId: site.id,
    date,
    planted,
    alive,
    createdAt: now.toISOString(),
  };
  if (avgHeightCm !== undefined) check.avgHeightCm = avgHeightCm;
  const notes = cleanText(input.notes, MAX_NOTE);
  if (notes !== undefined) check.notes = notes;

  store.checks.push(check);
  return check;
}

export function listChecks(store: Store, siteId?: string): SurvivalCheck[] {
  return store.checks
    .filter((row) => siteId === undefined || row.siteId === siteId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function latestCheck(store: Store, siteId: string): SurvivalCheck | null {
  const rows = listChecks(store, siteId);
  return rows.length === 0 ? null : rows[0];
}

export function survivalRate(planted: number, alive: number): number | null {
  if (planted <= 0) return null;
  return Math.round((alive / planted) * 1000) / 10;
}

export function survivalStats(store: Store, siteRef?: string): SurvivalStat[] {
  const sites = siteRef === undefined ? listSites(store) : [requireSite(store, siteRef)];
  return sites.map((site) => {
    const check = latestCheck(store, site.id);
    const checks = store.checks.filter((row) => row.siteId === site.id).length;
    return {
      siteId: site.id,
      siteName: site.name,
      planted: check?.planted ?? 0,
      alive: check?.alive ?? 0,
      rate: check ? survivalRate(check.planted, check.alive) : null,
      checkDate: check?.date ?? null,
      checks,
    };
  });
}

export interface PortfolioTotals {
  sites: number;
  sitesWithChecks: number;
  planted: number;
  alive: number;
  rate: number | null;
  checks: number;
}

export function portfolioTotals(store: Store, stats: SurvivalStat[] = survivalStats(store)): PortfolioTotals {
  const planted = stats.reduce((sum, row) => sum + row.planted, 0);
  const alive = stats.reduce((sum, row) => sum + row.alive, 0);
  return {
    sites: stats.length,
    sitesWithChecks: stats.filter((row) => row.checkDate !== null).length,
    planted,
    alive,
    rate: survivalRate(planted, alive),
    checks: store.checks.length,
  };
}

export interface SiteSummary {
  site: Site;
  plantedLogged: number;
  plantings: number;
  checks: number;
  latestCheck: SurvivalCheck | null;
  survival: number | null;
  latestThreat: ThreatEvent | null;
  threats: number;
}

export function siteSummary(store: Store, site: Site): SiteSummary {
  const threats = store.threats
    .filter((row) => row.siteId === site.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const check = latestCheck(store, site.id);
  return {
    site,
    plantedLogged: plantedTotal(store, site.id),
    plantings: store.plantings.filter((row) => row.siteId === site.id).length,
    checks: store.checks.filter((row) => row.siteId === site.id).length,
    latestCheck: check,
    survival: check ? survivalRate(check.planted, check.alive) : null,
    latestThreat: threats[0] ?? null,
    threats: threats.length,
  };
}

export function nearestSites(store: Store, point: { lat: number; lon: number }, limit = 3): { site: Site; km: number }[] {
  return store.sites
    .map((site) => ({ site, km: roundKm(haversineKm(point, { lat: site.lat, lon: site.lon })) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}