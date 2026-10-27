import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGfwQuery,
  loadGfwAlerts,
  parseGfwResponse,
} from "../src/gfw.js";
import { GFW_URL_MATCH, fakeFetch } from "./helpers.js";

const BBOX = { south: -34, west: 150, north: -33, east: 152 };

test("buildGfwQuery encodes a bounded SQL query", () => {
  const url = buildGfwQuery(BBOX, "2026-10-20", 50);
  assert.match(url, /^https:\/\/data-api\.globalforestwatch\.org\/dataset\/umd_glad_landsat_alerts\/latest\/query\?sql=/);
  assert.match(url, /latitude%20%3E%3D%20-34/);
  assert.match(url, /LIMIT%2050/);
  assert.match(url, /2026-10-20/);
});

test("parseGfwResponse maps the documented columns", () => {
  const alerts = parseGfwResponse({
    data: [
      {
        latitude: -33.7,
        longitude: 151.1,
        umd_glad_landsat_alerts__date: "2026-10-21T00:00:00",
        umd_glad_landsat_alerts__confidence: 3,
      },
    ],
  });
  assert.deepEqual(alerts, [{ lat: -33.7, lon: 151.1, date: "2026-10-21", confidence: 3 }]);
});

test("parseGfwResponse skips rows without coordinates or a date", () => {
  const alerts = parseGfwResponse({
    data: [
      { latitude: -33.7, longitude: 151.1 },
      { latitude: "x", longitude: 151.1, date: "2026-10-21" },
      { latitude: -33.7, longitude: 151.1, date: "2026-10-21" },
    ],
  });
  assert.equal(alerts.length, 1);
});

test("parseGfwResponse accepts alternate key names", () => {
  const alerts = parseGfwResponse({
    data: [{ lat: -33.7, lon: 151.1, alert_date: "2026-10-21", confidence: "4" }],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].confidence, 4);
});

test("loadGfwAlerts refuses to run without a key", async () => {
  await assert.rejects(
    () => loadGfwAlerts({ apiKey: undefined, bbox: BBOX, since: "2026-10-20" }),
    /GFW_API_KEY is not set/,
  );
});

test("loadGfwAlerts sends the key header and parses rows", async () => {
  const fetchImpl = fakeFetch([
    {
      match: GFW_URL_MATCH,
      body: JSON.stringify({
        data: [{ latitude: -33.7, longitude: 151.1, umd_glad_landsat_alerts__date: "2026-10-21", umd_glad_landsat_alerts__confidence: 4 }],
      }),
    },
  ]);
  const alerts = await loadGfwAlerts({ apiKey: "secret-key", bbox: BBOX, since: "2026-10-20", fetchImpl });
  assert.equal(alerts.length, 1);
  assert.equal(fetchImpl.calls[0].headers?.["x-api-key"], "secret-key");
});

test("loadGfwAlerts reports a failed status payload", async () => {
  const fetchImpl = fakeFetch([
    { match: GFW_URL_MATCH, body: JSON.stringify({ status: "failed", message: "Invalid API key" }) },
  ]);
  await assert.rejects(
    () => loadGfwAlerts({ apiKey: "bad", bbox: BBOX, since: "2026-10-20", fetchImpl }),
    /Invalid API key/,
  );
});

test("loadGfwAlerts reports an HTTP error", async () => {
  const fetchImpl = fakeFetch([{ match: GFW_URL_MATCH, body: "denied", status: 403 }]);
  await assert.rejects(
    () => loadGfwAlerts({ apiKey: "bad", bbox: BBOX, since: "2026-10-20", fetchImpl }),
    /HTTP 403/,
  );
});