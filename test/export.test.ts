import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.js";
import { emptyStore } from "../src/store.js";
import { addSite, logCheck, logPlanting } from "../src/sites.js";
import {
  PLANTING_CSV_HEADER,
  SITE_CSV_HEADER,
  THREAT_CSV_HEADER,
  buildGeoJson,
  buildPlantingCsv,
  buildSiteCsv,
  buildThreatCsv,
} from "../src/export.js";
import type { Store } from "../src/types.js";

const NOW = new Date(2026, 9, 27, 12, 0, 0);

function seeded(): { store: Store; siteId: string } {
  const store = emptyStore();
  const site = addSite(
    store,
    { name: "Ridge, North", lat: -33.7, lon: 151.1, areaHa: 3, species: ["Eucalyptus", "Acacia"] },
    NOW,
  );
  logPlanting(store, { siteRef: site.id, species: "Eucalyptus", count: 60, date: "2026-09-01", method: "hand" }, NOW);
  logCheck(store, { siteRef: site.id, alive: 48, date: "2026-10-01" }, NOW);
  store.threats.push({
    id: "threat_1",
    siteId: site.id,
    kind: "fire",
    severity: "warning",
    date: "2026-10-05",
    summary: "Fire detection 1.2 km away",
    source: "firms",
    distanceKm: 1.2,
    lat: -33.71,
    lon: 151.11,
  });
  return { store, siteId: site.id };
}

test("buildGeoJson returns a FeatureCollection with sites and threats", () => {
  const { store } = seeded();
  const collection = buildGeoJson(store);
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features.length, 2);
  const siteFeature = collection.features.find((feature) => feature.properties.kind === "site");
  assert.deepEqual(siteFeature?.geometry.coordinates, [151.1, -33.7]);
  assert.equal(siteFeature?.properties.survival_rate, 80);
  assert.equal(siteFeature?.properties.seedlings, 60);
  const threatFeature = collection.features.find((feature) => feature.properties.kind === "threat");
  assert.deepEqual(threatFeature?.geometry.coordinates, [151.11, -33.71]);
  assert.equal(threatFeature?.properties.severity, "warning");
});

test("buildGeoJson omits threats without coordinates", () => {
  const store = emptyStore();
  const site = addSite(store, { name: "A", lat: -33.7, lon: 151.1 }, NOW);
  store.threats.push({
    id: "t",
    siteId: site.id,
    kind: "fire-weather",
    severity: "watch",
    date: "2026-10-05",
    summary: "hot day",
    source: "open-meteo",
  });
  const collection = buildGeoJson(store);
  assert.equal(collection.features.filter((feature) => feature.properties.kind === "threat").length, 0);
});

test("buildGeoJson is valid JSON", () => {
  const { store } = seeded();
  const parsed = JSON.parse(JSON.stringify(buildGeoJson(store))) as { type: string; features: unknown[] };
  assert.equal(parsed.type, "FeatureCollection");
  assert.equal(parsed.features.length, 2);
});

test("buildSiteCsv has a stable header and one row per site", () => {
  const { store } = seeded();
  const rows = parseCsv(buildSiteCsv(store));
  assert.deepEqual(rows[0], [...SITE_CSV_HEADER]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "Ridge, North");
  assert.equal(rows[1][7], "60");
  assert.equal(rows[1][8], "80");
});

test("buildSiteCsv escapes commas in names", () => {
  const { store } = seeded();
  const text = buildSiteCsv(store);
  assert.match(text, /"Ridge, North"/);
});

test("buildThreatCsv lists threats with site names", () => {
  const { store } = seeded();
  const rows = parseCsv(buildThreatCsv(store));
  assert.deepEqual(rows[0], [...THREAT_CSV_HEADER]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "Ridge, North");
  assert.equal(rows[1][2], "fire");
  assert.equal(rows[1][7], "1.2");
});

test("buildPlantingCsv lists planting records", () => {
  const { store } = seeded();
  const rows = parseCsv(buildPlantingCsv(store));
  assert.deepEqual(rows[0], [...PLANTING_CSV_HEADER]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][3], "Eucalyptus");
  assert.equal(rows[1][4], "60");
  assert.equal(rows[1][5], "hand");
});

test("CSV builders work on an empty store", () => {
  const store = emptyStore();
  assert.equal(parseCsv(buildSiteCsv(store)).length, 1);
  assert.equal(parseCsv(buildThreatCsv(store)).length, 1);
  assert.equal(parseCsv(buildPlantingCsv(store)).length, 1);
  assert.deepEqual(buildGeoJson(store).features, []);
});