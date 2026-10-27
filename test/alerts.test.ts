import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlertsCsv, parseAlertsFile, parseAlertsGeoJson } from "../src/alerts.js";

test("parseAlertsCsv reads alert rows", () => {
  const csv = [
    "lat,lon,date,kind,severity,summary",
    "-33.70,151.10,2026-10-25,canopy-loss,warning,Loss near the creek",
    "-33.71,151.11,2026-10-26,fire,severe,Spot fire",
  ].join("\n");
  const alerts = parseAlertsCsv(csv);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].kind, "canopy-loss");
  assert.equal(alerts[0].severity, "warning");
  assert.equal(alerts[1].kind, "fire");
  assert.equal(alerts[1].summary, "Spot fire");
});

test("parseAlertsCsv defaults unknown kinds and severities", () => {
  const alerts = parseAlertsCsv("lat,lon,date,kind,severity\n-33.7,151.1,2026-10-25,strange,weird\n");
  assert.equal(alerts[0].kind, "canopy-loss");
  assert.equal(alerts[0].severity, "watch");
});

test("parseAlertsCsv skips rows with a bad date or coordinates", () => {
  const alerts = parseAlertsCsv("lat,lon,date\n-33.7,151.1,25/10/2026\nx,151.1,2026-10-25\n-33.7,151.1,2026-10-25\n");
  assert.equal(alerts.length, 1);
});

test("parseAlertsGeoJson reads point features", () => {
  const text = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [151.1, -33.7] },
        properties: { date: "2026-10-25", kind: "fire", severity: "severe", summary: "Fire nearby" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [151.1] },
        properties: { date: "2026-10-25" },
      },
    ],
  });
  const alerts = parseAlertsGeoJson(text);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].lat, -33.7);
  assert.equal(alerts[0].lon, 151.1);
  assert.equal(alerts[0].kind, "fire");
});

test("parseAlertsGeoJson rejects invalid JSON", () => {
  assert.throws(() => parseAlertsGeoJson("{oops"), /not valid JSON/);
});

test("parseAlertsFile chooses the format by extension", () => {
  const csv = "lat,lon,date\n-33.7,151.1,2026-10-25\n";
  assert.equal(parseAlertsFile(csv, "alerts.csv").length, 1);
  const json = JSON.stringify({
    type: "FeatureCollection",
    features: [{ geometry: { type: "Point", coordinates: [151.1, -33.7] }, properties: { date: "2026-10-25" } }],
  });
  assert.equal(parseAlertsFile(json, "alerts.geojson").length, 1);
});

test("parseAlertsFile sniffs unknown extensions", () => {
  const json = JSON.stringify({ type: "FeatureCollection", features: [] });
  assert.deepEqual(parseAlertsFile(json, "alerts.txt"), []);
});