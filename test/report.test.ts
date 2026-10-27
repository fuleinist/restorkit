import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStore } from "../src/store.js";
import { addSite, logCheck, logPlanting } from "../src/sites.js";
import {
  buildFunderReport,
  escapeHtml,
  formatPercent,
  renderHtml,
  renderMarkdown,
} from "../src/report.js";
import type { Store } from "../src/types.js";

const NOW = new Date(2026, 9, 27, 12, 0, 0);

function seeded(): { store: Store; alpha: string; beta: string } {
  const store = emptyStore();
  const alpha = addSite(store, { name: "Alpha Ridge", lat: -33.7, lon: 151.1, areaHa: 2.5 }, NOW);
  const beta = addSite(store, { name: "Beta Creek <script>", lat: -33.8, lon: 151.2, areaHa: 5 }, NOW);
  logPlanting(store, { siteRef: alpha.id, species: "Eucalyptus", count: 100, date: "2026-08-01" }, NOW);
  logCheck(store, { siteRef: alpha.id, alive: 80, date: "2026-10-01" }, NOW);
  logPlanting(store, { siteRef: beta.id, species: "Acacia", count: 50, date: "2026-08-02" }, NOW);
  logCheck(store, { siteRef: beta.id, alive: 40, date: "2026-10-02" }, NOW);
  store.threats.push({
    id: "t1",
    siteId: alpha.id,
    kind: "fire",
    severity: "warning",
    date: "2026-10-05",
    summary: "Fire detection 2.4 km from Alpha Ridge",
    source: "firms",
  });
  store.threats.push({
    id: "t2",
    siteId: beta.id,
    kind: "fire",
    severity: "info",
    date: "2026-07-01",
    summary: "Old fire",
    source: "firms",
  });
  store.scans.push({
    id: "scan_1",
    scannedAt: NOW.toISOString(),
    siteIds: [alpha.id, beta.id],
    radiusKm: 10,
    days: 2,
    offline: false,
    events: 2,
    sources: [{ source: "firms", state: "ok", message: "2 detection(s)" }],
  });
  return { store, alpha: alpha.id, beta: beta.id };
}

test("buildFunderReport totals area, seedlings, and survival", () => {
  const { store } = seeded();
  const report = buildFunderReport(store, { now: NOW });
  assert.equal(report.totals.sites, 2);
  assert.equal(report.totals.areaHa, 7.5);
  assert.equal(report.totals.seedlings, 150);
  assert.equal(report.totals.alive, 120);
  assert.equal(report.totals.rate, 80);
  assert.equal(report.totals.threats, 2);
});

test("buildFunderReport sorts sites by name", () => {
  const { store } = seeded();
  const report = buildFunderReport(store, { now: NOW });
  assert.equal(report.rows[0].name, "Alpha Ridge");
  assert.equal(report.rows[1].name, "Beta Creek <script>");
});

test("buildFunderReport filters by period", () => {
  const { store } = seeded();
  const report = buildFunderReport(store, { now: NOW, from: "2026-09-01", to: "2026-10-27" });
  assert.equal(report.totals.threats, 1);
  assert.equal(report.recentThreats.length, 1);
});

test("buildFunderReport narrows to one site", () => {
  const { store, beta } = seeded();
  const report = buildFunderReport(store, { now: NOW, siteRef: beta });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].survival, 80);
  assert.equal(report.totals.seedlings, 50);
});

test("buildFunderReport fails for an unknown site", () => {
  const { store } = seeded();
  assert.throws(() => buildFunderReport(store, { siteRef: "nowhere" }), /no site matches/);
});

test("buildFunderReport handles an empty store", () => {
  const report = buildFunderReport(emptyStore(), { now: NOW });
  assert.equal(report.rows.length, 0);
  assert.equal(report.totals.rate, null);
});

test("formatPercent uses one decimal and n/a", () => {
  assert.equal(formatPercent(80), "80.0%");
  assert.equal(formatPercent(33.3), "33.3%");
  assert.equal(formatPercent(null), "n/a");
});

test("renderMarkdown includes summary, sites, and threats", () => {
  const { store } = seeded();
  const text = renderMarkdown(buildFunderReport(store, { now: NOW }));
  assert.match(text, /^# restorkit funder report/m);
  assert.match(text, /\| Alpha Ridge \| 2\.5 \| 100 \| 80\.0% \| 2026-10-01 \| 1 \|/);
  assert.match(text, /Fire detection 2\.4 km from Alpha Ridge/);
  assert.match(text, /## Data sources/);
  assert.match(text, /firms: ok/);
});

test("renderMarkdown notes an empty period", () => {
  const { store } = seeded();
  const text = renderMarkdown(buildFunderReport(store, { now: NOW, from: "2020-01-01", to: "2020-12-31" }));
  assert.match(text, /No threats were recorded in this period/);
});

test("renderMarkdown handles no sites", () => {
  const text = renderMarkdown(buildFunderReport(emptyStore(), { now: NOW }));
  assert.match(text, /No sites/);
});

test("escapeHtml escapes the five dangerous characters", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("renderHtml escapes site names and keeps print styles", () => {
  const { store } = seeded();
  const html = renderHtml(buildFunderReport(store, { now: NOW }));
  assert.match(html, /Beta Creek &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /@media print/);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /80\.0%/);
});

test("renderHtml prints an empty threat note", () => {
  const html = renderHtml(buildFunderReport(emptyStore(), { now: NOW }));
  assert.match(html, /No threats were recorded in this period/);
});