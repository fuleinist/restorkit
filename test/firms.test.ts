import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectionsNearSites,
  loadFirmsDetections,
  parseFirmsCsv,
} from "../src/firms.js";
import { haversineKm, roundKm } from "../src/geo.js";
import { FIRMS_CSV, FIRMS_URL_MATCH, fakeFetch } from "./helpers.js";

const NOW = new Date(2026, 9, 27, 12, 0, 0);

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "restorkit-firms-"));
}

test("parseFirmsCsv reads the VIIRS header and formats time", () => {
  const rows = parseFirmsCsv(FIRMS_CSV);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    lat: -33.7,
    lon: 151.1,
    date: "2026-10-27",
    time: "03:10",
    confidence: "1.0NRT",
    confidenceScore: 0,
    frp: 12.5,
    satellite: "N",
  });
  assert.equal(rows[1].confidence, "h");
  assert.equal(rows[1].confidenceScore, 90);
});

test("parseFirmsCsv skips rows with bad coordinates or dates", () => {
  const rows = parseFirmsCsv(FIRMS_CSV);
  assert.equal(rows.some((row) => row.date === "2026-10-20"), true);
  assert.equal(rows.length, 3);
});

test("parseFirmsCsv returns nothing for a header-only file", () => {
  assert.deepEqual(parseFirmsCsv("latitude,longitude,acq_date\n"), []);
});

test("parseFirmsCsv returns nothing when required columns are missing", () => {
  assert.deepEqual(parseFirmsCsv("a,b,c\n1,2,3\n"), []);
});

test("detectionsNearSites filters by radius and date", () => {
  const detections = parseFirmsCsv(FIRMS_CSV);
  const sites = [{ id: "site_1", name: "Ridge", lat: -33.7, lon: 151.1 }];
  const nearby = detectionsNearSites(detections, sites, 5, 2, NOW, haversineKm, roundKm);
  assert.equal(nearby.length, 2);
  assert.equal(nearby[0].siteId, "site_1");
  assert.ok(nearby[0].distanceKm <= 1);
});

test("detectionsNearSites excludes old detections", () => {
  const detections = parseFirmsCsv(FIRMS_CSV);
  const sites = [{ id: "site_1", name: "Ridge", lat: -20, lon: 140 }];
  const nearby = detectionsNearSites(detections, sites, 5, 2, NOW, haversineKm, roundKm);
  assert.equal(nearby.length, 0);
});

test("detectionsNearSites picks the nearest site", () => {
  const detections = parseFirmsCsv(FIRMS_CSV);
  const sites = [
    { id: "far", name: "Far", lat: -34.2, lon: 151.1 },
    { id: "near", name: "Near", lat: -33.701, lon: 151.101 },
  ];
  const nearby = detectionsNearSites(detections, sites, 60, 2, NOW, haversineKm, roundKm);
  assert.ok(nearby.length > 0);
  assert.equal(nearby[0].siteId, "near");
});

test("loadFirmsDetections caches a fresh download", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch([{ match: FIRMS_URL_MATCH, body: FIRMS_CSV }]);
  const first = await loadFirmsDetections({ dir, days: 1, fetchImpl, now: NOW });
  assert.equal(first.cached, false);
  assert.equal(first.dataset, "24h");
  const second = await loadFirmsDetections({ dir, days: 1, fetchImpl, now: NOW });
  assert.equal(second.cached, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(second.detections.length, first.detections.length);
});

test("loadFirmsDetections uses the 7 day file for longer windows", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch([{ match: FIRMS_URL_MATCH, body: FIRMS_CSV }]);
  const result = await loadFirmsDetections({ dir, days: 7, fetchImpl, now: NOW });
  assert.equal(result.dataset, "7d");
  assert.match(fetchImpl.calls[0].url, /7d\.csv$/);
});

test("loadFirmsDetections fails clearly when offline without a cache", async () => {
  const dir = tempDir();
  await assert.rejects(
    () => loadFirmsDetections({ dir, days: 1, offline: true, now: NOW }),
    /offline mode has no cached FIRMS/,
  );
});

test("loadFirmsDetections serves a stale cache in offline mode", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch([{ match: FIRMS_URL_MATCH, body: FIRMS_CSV }]);
  await loadFirmsDetections({ dir, days: 1, fetchImpl, now: NOW });
  const later = new Date(2026, 9, 27, 23, 0, 0);
  const result = await loadFirmsDetections({ dir, days: 1, offline: true, now: later });
  assert.equal(result.cached, true);
  assert.equal(result.detections.length, 3);
});

test("loadFirmsDetections reports an HTTP failure", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch([{ match: FIRMS_URL_MATCH, body: "nope", status: 503 }]);
  await assert.rejects(() => loadFirmsDetections({ dir, days: 1, fetchImpl, now: NOW }), /HTTP 503/);
});