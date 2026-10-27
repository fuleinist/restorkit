import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyStore } from "../src/store.js";
import { addSite, logCheck, logPlanting } from "../src/sites.js";
import {
  DEFAULT_DAYS,
  DEFAULT_RADIUS_KM,
  canopySeverity,
  eventKey,
  fireSeverity,
  listThreats,
  scanThreats,
} from "../src/threats.js";
import { severityRank } from "../src/types.js";
import type { Store } from "../src/types.js";
import { FIRMS_CSV, FIRMS_URL_MATCH, WEATHER_JSON, WEATHER_URL_MATCH, fakeFetch } from "./helpers.js";

const NOW = new Date(2026, 9, 27, 12, 0, 0);

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "restorkit-threats-"));
}

function seededStore(): { store: Store; dir: string; siteId: string } {
  const dir = tempDir();
  const store = emptyStore();
  const site = addSite(
    store,
    { name: "Bellbird Ridge", lat: -33.7, lon: 151.1, areaHa: 3 },
    NOW,
  );
  logPlanting(store, { siteRef: site.id, species: "Eucalyptus pilularis", count: 120, date: "2026-09-01" }, NOW);
  logCheck(store, { siteRef: site.id, alive: 96, date: "2026-10-20" }, NOW);
  return { store, dir, siteId: site.id };
}

function routes() {
  return fakeFetch([
    { match: FIRMS_URL_MATCH, body: FIRMS_CSV },
    { match: WEATHER_URL_MATCH, body: WEATHER_JSON },
  ]);
}

test("scanThreats combines fire and fire-weather events", async () => {
  const { store, dir } = seededStore();
  const fetchImpl = routes();
  const result = await scanThreats(store, {
    dir,
    gfwApiKey: "",
    fetchImpl,
    now: NOW,
  });
  assert.equal(result.scan.offline, false);
  assert.equal(result.scan.radiusKm, DEFAULT_RADIUS_KM);
  assert.equal(result.scan.days, DEFAULT_DAYS);
  assert.equal(result.events.length, 3);
  assert.equal(result.events.filter((event) => event.kind === "fire").length, 2);
  assert.equal(result.events.filter((event) => event.kind === "fire-weather").length, 1);
  assert.equal(store.threats.length, 3);
  assert.equal(store.scans.length, 1);
});

test("scanThreats records source status including a skipped GFW", async () => {
  const { store, dir } = seededStore();
  const result = await scanThreats(store, { dir, gfwApiKey: "", fetchImpl: routes(), now: NOW });
  const bySource = new Map(result.sources.map((row) => [row.source, row]));
  assert.equal(bySource.get("firms")?.state, "ok");
  assert.equal(bySource.get("open-meteo")?.state, "ok");
  assert.equal(bySource.get("gfw")?.state, "skipped");
  assert.match(bySource.get("gfw")?.message ?? "", /GFW_API_KEY/);
});

test("scanThreats maps FIRMS confidence to severity", async () => {
  const { store, dir } = seededStore();
  const result = await scanThreats(store, { dir, gfwApiKey: "", fetchImpl: routes(), now: NOW });
  const fires = result.events.filter((event) => event.kind === "fire");
  const severities = fires.map((event) => event.severity).sort();
  assert.deepEqual(severities, ["info", "warning"]);
  assert.ok(fires.every((event) => typeof event.distanceKm === "number"));
});

test("scanThreats is idempotent for repeat events", async () => {
  const { store, dir } = seededStore();
  const fetchImpl = routes();
  await scanThreats(store, { dir, gfwApiKey: "", fetchImpl, now: NOW });
  const second = await scanThreats(store, { dir, gfwApiKey: "", fetchImpl, now: NOW });
  assert.equal(second.events.length, 0);
  assert.equal(store.threats.length, 3);
  assert.equal(store.scans.length, 2);
});

test("scanThreats keeps going when FIRMS fails", async () => {
  const { store, dir } = seededStore();
  const fetchImpl = fakeFetch([
    { match: FIRMS_URL_MATCH, body: "down", status: 500 },
    { match: WEATHER_URL_MATCH, body: WEATHER_JSON },
  ]);
  const result = await scanThreats(store, { dir, gfwApiKey: "", fetchImpl, now: NOW });
  const firms = result.sources.find((row) => row.source === "firms");
  assert.equal(firms?.state, "error");
  assert.equal(result.events.filter((event) => event.kind === "fire-weather").length, 1);
});

test("scanThreats keeps going when weather fails", async () => {
  const { store, dir } = seededStore();
  const fetchImpl = fakeFetch([
    { match: FIRMS_URL_MATCH, body: FIRMS_CSV },
    { match: WEATHER_URL_MATCH, body: "down", status: 503 },
  ]);
  const result = await scanThreats(store, { dir, gfwApiKey: "", fetchImpl, now: NOW });
  assert.equal(result.sources.find((row) => row.source === "open-meteo")?.state, "error");
  assert.equal(result.events.filter((event) => event.kind === "fire").length, 2);
});

test("scanThreats uses the cache in offline mode", async () => {
  const { store, dir } = seededStore();
  const online = routes();
  await scanThreats(store, { dir, gfwApiKey: "", fetchImpl: online, now: NOW });
  const offlineFetch = fakeFetch([]);
  const result = await scanThreats(store, {
    dir,
    gfwApiKey: "",
    fetchImpl: offlineFetch,
    offline: true,
    now: NOW,
  });
  assert.equal(result.scan.offline, true);
  assert.equal(offlineFetch.calls.length, 0);
  assert.equal(result.sources.find((row) => row.source === "firms")?.state, "ok");
  assert.equal(result.events.length, 0);
});

test("scanThreats honours the radius", async () => {
  const { store, dir } = seededStore();
  const result = await scanThreats(store, {
    dir,
    gfwApiKey: "",
    fetchImpl: routes(),
    now: NOW,
    radiusKm: 0.5,
  });
  // The first detection sits on the site; the second is about 0.7 km away.
  assert.equal(result.events.filter((event) => event.kind === "fire").length, 1);
  assert.equal(result.events.filter((event) => event.kind === "fire-weather").length, 1);
});

test("scanThreats reads a local alerts file", async () => {
  const { store, dir, siteId } = seededStore();
  const alertsPath = join(dir, "alerts.csv");
  writeFileSync(alertsPath, "lat,lon,date,kind,severity,summary\n-33.701,151.101,2026-10-26,canopy-loss,warning,Canopy gap\n", "utf8");
  const result = await scanThreats(store, {
    dir,
    gfwApiKey: "",
    fetchImpl: routes(),
    now: NOW,
    alertsFile: alertsPath,
  });
  const local = result.events.filter((event) => event.source === "alerts-file");
  assert.equal(local.length, 1);
  assert.equal(local[0].siteId, siteId);
  assert.equal(result.sources.find((row) => row.source === "alerts-file")?.state, "ok");
});

test("scanThreats reports a missing alerts file without failing", async () => {
  const { store, dir } = seededStore();
  const result = await scanThreats(store, {
    dir,
    gfwApiKey: "",
    fetchImpl: routes(),
    now: NOW,
    alertsFile: join(dir, "missing.csv"),
  });
  assert.equal(result.sources.find((row) => row.source === "alerts-file")?.state, "error");
  assert.ok(result.events.length > 0);
});

test("scanThreats refuses to run with no sites", async () => {
  await assert.rejects(
    () => scanThreats(emptyStore(), { dir: tempDir(), gfwApiKey: "", now: NOW }),
    /no sites are registered/,
  );
});

test("scanThreats clamps a huge radius and a huge window", async () => {
  const { store, dir } = seededStore();
  const result = await scanThreats(store, {
    dir,
    gfwApiKey: "",
    fetchImpl: routes(),
    now: NOW,
    radiusKm: 5000,
    days: 99,
  });
  assert.equal(result.scan.radiusKm, 100);
  assert.equal(result.scan.days, 7);
});

test("listThreats sorts newest first and filters by severity", async () => {
  const { store, dir } = seededStore();
  await scanThreats(store, { dir, gfwApiKey: "", fetchImpl: routes(), now: NOW });
  const all = listThreats(store);
  assert.equal(all.length, 3);
  assert.ok(all[0].date >= all[all.length - 1].date);
  const warnings = listThreats(store, { severity: "warning" });
  assert.ok(warnings.every((event) => severityRank(event.severity) >= severityRank("warning")));
  assert.equal(warnings.length, 2);
  assert.equal(listThreats(store, { limit: 1 }).length, 1);
});

test("fireSeverity handles letters and numeric scores", () => {
  assert.equal(fireSeverity("h"), "warning");
  assert.equal(fireSeverity("n"), "watch");
  assert.equal(fireSeverity("l"), "info");
  assert.equal(fireSeverity("85"), "warning");
  assert.equal(fireSeverity("55"), "watch");
  assert.equal(fireSeverity("10"), "info");
});

test("canopySeverity maps confidence bands", () => {
  assert.equal(canopySeverity(4), "warning");
  assert.equal(canopySeverity(3), "watch");
  assert.equal(canopySeverity(2), "info");
  assert.equal(canopySeverity(null), "watch");
});

test("eventKey ignores case in the summary", () => {
  const base = { siteId: "s", kind: "fire" as const, date: "2026-10-27", summary: "Fire Near" };
  assert.equal(eventKey(base), eventKey({ ...base, summary: "fire near" }));
});