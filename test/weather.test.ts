import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFireWeatherUrl,
  fireWeatherIndex,
  fireWeatherSeverity,
  loadFireWeather,
  parseFireWeather,
} from "../src/weather.js";
import { WEATHER_JSON, WEATHER_URL_MATCH, fakeFetch } from "./helpers.js";

const NOW = new Date(2026, 9, 27, 12, 0, 0);

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "restorkit-weather-"));
}

test("fireWeatherIndex peaks on a hot, dry, windy day", () => {
  assert.equal(fireWeatherIndex({ tmax: 40, rhMin: 10, windMax: 40, precip: 0 }), 100);
});

test("fireWeatherIndex stays low on a cool, damp day", () => {
  const index = fireWeatherIndex({ tmax: 18, rhMin: 80, windMax: 8, precip: 6 });
  assert.equal(index, 0);
});

test("fireWeatherIndex ignores rain in the dry-day term", () => {
  const wet = fireWeatherIndex({ tmax: 40, rhMin: 10, windMax: 40, precip: 1 });
  const dry = fireWeatherIndex({ tmax: 40, rhMin: 10, windMax: 40, precip: 0 });
  assert.equal(dry - wet, 10);
});

test("fireWeatherSeverity applies the spec thresholds", () => {
  assert.equal(fireWeatherSeverity(69), "warning");
  assert.equal(fireWeatherSeverity(70), "severe");
  assert.equal(fireWeatherSeverity(50), "warning");
  assert.equal(fireWeatherSeverity(30), "watch");
  assert.equal(fireWeatherSeverity(29), null);
});

test("buildFireWeatherUrl carries the site and window", () => {
  const url = buildFireWeatherUrl(-33.7, 151.1, 3);
  assert.match(url, /latitude=-33\.7/);
  assert.match(url, /forecast_days=3/);
  assert.match(url, /relative_humidity_2m_min/);
});

test("parseFireWeather maps a full response", () => {
  const days = parseFireWeather(JSON.parse(WEATHER_JSON));
  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-10-27");
  assert.equal(days[0].severity, "severe");
  assert.ok(days[0].index >= 70);
  assert.equal(days[1].severity, null);
});

test("parseFireWeather skips days without a temperature", () => {
  const days = parseFireWeather({
    daily: { time: ["2026-10-27"], temperature_2m_max: [undefined as unknown as number], relative_humidity_2m_min: [20] },
  });
  assert.equal(days.length, 0);
});

test("parseFireWeather handles an empty payload", () => {
  assert.deepEqual(parseFireWeather({}), []);
});

test("loadFireWeather caches the payload", async () => {
  const dir = tempDir();
  const fetchImpl = fakeFetch([{ match: WEATHER_URL_MATCH, body: WEATHER_JSON }]);
  const first = await loadFireWeather({ site: { id: "site_1", lat: -33.7, lon: 151.1 }, dir, days: 2, fetchImpl, now: NOW });
  assert.equal(first.cached, false);
  const second = await loadFireWeather({ site: { id: "site_1", lat: -33.7, lon: 151.1 }, dir, days: 2, fetchImpl, now: NOW });
  assert.equal(second.cached, true);
  assert.equal(fetchImpl.calls.length, 1);
});

test("loadFireWeather fails clearly when offline without a cache", async () => {
  await assert.rejects(
    () =>
      loadFireWeather({
        site: { id: "site_1", lat: -33.7, lon: 151.1 },
        dir: tempDir(),
        days: 2,
        offline: true,
        now: NOW,
      }),
    /offline mode has no cached weather/,
  );
});