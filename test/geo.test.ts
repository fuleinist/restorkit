import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO,
  bboxForRadius,
  bboxSpanKm,
  formatLatLon,
  haversineKm,
  inBBox,
  isValidDate,
  mergeBBoxes,
  padBBox,
  project,
  roundKm,
  todayISO,
  validLat,
  validLon,
  withinRadius,
} from "../src/geo.js";

test("haversine matches a known one-degree latitude step", () => {
  const d = haversineKm({ lat: -33, lon: 151 }, { lat: -34, lon: 151 });
  assert.ok(d > 110 && d < 112, `expected about 111 km, got ${d}`);
});

test("haversine is zero for the same point", () => {
  assert.equal(haversineKm({ lat: -33.86, lon: 151.2 }, { lat: -33.86, lon: 151.2 }), 0);
});

test("haversine is symmetric", () => {
  const a = { lat: -33.86, lon: 151.2 };
  const b = { lat: -37.81, lon: 144.96 };
  assert.ok(Math.abs(haversineKm(a, b) - haversineKm(b, a)) < 1e-9);
});

test("validLat and validLon reject out-of-range values", () => {
  assert.equal(validLat(-90), true);
  assert.equal(validLat(90), true);
  assert.equal(validLat(90.1), false);
  assert.equal(validLon(-180), true);
  assert.equal(validLon(180), true);
  assert.equal(validLon(180.5), false);
  assert.equal(validLat(Number.NaN), false);
});

test("withinRadius includes the boundary and excludes beyond it", () => {
  const center = { lat: -33.7, lon: 151.1 };
  const near = { lat: -33.705, lon: 151.105 };
  const far = { lat: -34.2, lon: 151.6 };
  assert.equal(withinRadius(center, near, 2), true);
  assert.equal(withinRadius(center, far, 2), false);
});

test("bboxForRadius covers the circle in all directions", () => {
  const center = { lat: -33.7, lon: 151.1 };
  const radius = 25;
  const box = bboxForRadius(center, radius);
  const points = [
    { lat: center.lat + 0.2, lon: center.lon },
    { lat: center.lat - 0.2, lon: center.lon },
    { lat: center.lat, lon: center.lon + 0.2 },
    { lat: center.lat, lon: center.lon - 0.2 },
  ];
  for (const point of points) assert.equal(inBBox(point, box), true);
});

test("bboxForRadius handles high latitude and poles", () => {
  const box = bboxForRadius({ lat: 89.9, lon: 0 }, 50);
  assert.ok(box.north <= 90);
  assert.ok(box.west <= box.east);
});

test("mergeBBoxes combines boxes and returns null for none", () => {
  assert.equal(mergeBBoxes([]), null);
  const merged = mergeBBoxes([
    { south: -34, west: 150, north: -33, east: 151 },
    { south: -35, west: 151, north: -34, east: 152 },
  ]);
  assert.deepEqual(merged, { south: -35, west: 150, north: -33, east: 152 });
});

test("inBBox handles a box that crosses the antimeridian", () => {
  const box = { south: -10, west: 179, north: 10, east: -179 };
  assert.equal(inBBox({ lat: 0, lon: 179.5 }, box), true);
  assert.equal(inBBox({ lat: 0, lon: -179.5 }, box), true);
  assert.equal(inBBox({ lat: 0, lon: 0 }, box), false);
});

test("project maps corners to the unit square", () => {
  const box = { south: -34, west: 150, north: -33, east: 151 };
  const topLeft = project({ lat: -33, lon: 150 }, box);
  const bottomRight = project({ lat: -34, lon: 151 }, box);
  assert.deepEqual(topLeft, { x: 0, y: 0 });
  assert.deepEqual(bottomRight, { x: 1, y: 1 });
});

test("project clamps points outside the box", () => {
  const box = { south: -34, west: 150, north: -33, east: 151 };
  const outside = project({ lat: -30, lon: 140 }, box);
  assert.deepEqual(outside, { x: 0, y: 0 });
});

test("padBBox expands the box on every side", () => {
  const box = { south: -34, west: 150, north: -33, east: 151 };
  const padded = padBBox(box, 0.1);
  assert.ok(padded.south < box.south);
  assert.ok(padded.north > box.north);
  assert.ok(padded.west < box.west);
  assert.ok(padded.east > box.east);
});

test("bboxSpanKm is the longer side in kilometres", () => {
  const span = bboxSpanKm({ south: -34, west: 150, north: -33, east: 151 });
  assert.ok(span > 90 && span < 150, `unexpected span ${span}`);
});

test("formatLatLon uses hemispheres", () => {
  assert.equal(formatLatLon(-33.7, 151.1), "33.7000S 151.1000E");
  assert.equal(formatLatLon(51.5, -0.12), "51.5000N 0.1200W");
});

test("isValidDate accepts real dates only", () => {
  assert.equal(isValidDate("2026-10-27"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("27/10/2026"), false);
  assert.equal(isValidDate("2026-1-1"), false);
});

test("todayISO returns the local calendar date", () => {
  const fixed = new Date("2026-10-27T02:00:00Z");
  assert.match(todayISO(fixed), /^\d{4}-\d{2}-\d{2}$/);
});

test("addDaysISO crosses month and year boundaries", () => {
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
});

test("roundKm keeps one decimal place", () => {
  assert.equal(roundKm(1.23456), 1.2);
  assert.equal(roundKm(1.25), 1.3);
});