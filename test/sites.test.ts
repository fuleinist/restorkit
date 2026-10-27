import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStore, newId } from "../src/store.js";
import {
  DomainError,
  addSite,
  earliestPlanting,
  findSite,
  latestCheck,
  listChecks,
  listPlantings,
  logCheck,
  logPlanting,
  nearestSites,
  plantedTotal,
  portfolioTotals,
  removeSite,
  requireSite,
  siteSummary,
  survivalRate,
  survivalStats,
} from "../src/sites.js";
import type { Store } from "../src/types.js";

const NOW = new Date(2026, 9, 27, 12, 0, 0);

function storeWithSite(name = "Bellbird Ridge", lat = -33.7, lon = 151.1): { store: Store; id: string } {
  const store = emptyStore();
  const site = addSite(store, { name, lat, lon, areaHa: 2.5, species: ["Eucalyptus pilularis"] }, NOW);
  return { store, id: site.id };
}

test("addSite stores a full record", () => {
  const store = emptyStore();
  const site = addSite(
    store,
    {
      name: "  Bellbird Ridge  ",
      lat: -33.7,
      lon: 151.1,
      areaHa: 2.456,
      species: ["Eucalyptus pilularis", "Acacia melanoxylon", "eucalyptus pilularis"],
      plantedOn: "2026-09-01",
      notes: "  creek bank  ",
    },
    NOW,
  );
  assert.equal(site.name, "Bellbird Ridge");
  assert.equal(site.areaHa, 2.46);
  assert.deepEqual(site.species, ["Eucalyptus pilularis", "Acacia melanoxylon"]);
  assert.equal(site.plantedOn, "2026-09-01");
  assert.equal(site.notes, "creek bank");
  assert.match(site.id, /^site_/);
});

test("addSite rejects a blank name", () => {
  assert.throws(() => addSite(emptyStore(), { name: "   ", lat: -33, lon: 151 }, NOW), DomainError);
});

test("addSite rejects out-of-range coordinates", () => {
  assert.throws(() => addSite(emptyStore(), { name: "A", lat: 91, lon: 151 }, NOW), /latitude/);
  assert.throws(() => addSite(emptyStore(), { name: "A", lat: -33, lon: 181 }, NOW), /longitude/);
});

test("addSite rejects a non-positive area", () => {
  assert.throws(() => addSite(emptyStore(), { name: "A", lat: -33, lon: 151, areaHa: 0 }, NOW), /area/);
  assert.throws(() => addSite(emptyStore(), { name: "A", lat: -33, lon: 151, areaHa: -1 }, NOW), /area/);
});

test("addSite rejects a future planting date", () => {
  assert.throws(
    () => addSite(emptyStore(), { name: "A", lat: -33, lon: 151, plantedOn: "2026-10-28" }, NOW),
    /future/,
  );
});

test("addSite rejects a malformed planting date", () => {
  assert.throws(
    () => addSite(emptyStore(), { name: "A", lat: -33, lon: 151, plantedOn: "01/09/2026" }, NOW),
    /YYYY-MM-DD/,
  );
});

test("addSite rejects a duplicate name at the same place", () => {
  const { store } = storeWithSite();
  assert.throws(() => addSite(store, { name: "bellbird ridge", lat: -33.70001, lon: 151.10001 }, NOW), /already exists/);
});

test("addSite allows the same name at a distant place", () => {
  const { store } = storeWithSite();
  const second = addSite(store, { name: "Bellbird Ridge", lat: -37.8, lon: 144.9 }, NOW);
  assert.equal(store.sites.length, 2);
  assert.notEqual(second.id, store.sites[0].id);
});

test("findSite resolves by id, name, and unique prefix", () => {
  const { store, id } = storeWithSite();
  assert.equal(findSite(store, id)?.id, id);
  assert.equal(findSite(store, "bellbird ridge")?.id, id);
  assert.equal(findSite(store, "Bellb")?.id, id);
  assert.equal(findSite(store, "nothing"), undefined);
});

test("findSite rejects an ambiguous prefix", () => {
  const store = emptyStore();
  addSite(store, { name: "Bellbird Ridge", lat: -33.7, lon: 151.1 }, NOW);
  addSite(store, { name: "Bellbird Creek", lat: -33.9, lon: 151.3 }, NOW);
  assert.throws(() => findSite(store, "Bellbird"), /matches 2 sites/);
});

test("requireSite throws a clear error", () => {
  assert.throws(() => requireSite(emptyStore(), "Ridge"), /no site matches/);
});

test("removeSite cascades to plantings, checks, and threats", () => {
  const { store, id } = storeWithSite();
  logPlanting(store, { siteRef: id, species: "Eucalyptus", count: 100, date: "2026-09-01" }, NOW);
  logCheck(store, { siteRef: id, alive: 80, date: "2026-10-01" }, NOW);
  store.threats.push({
    id: newId("threat"),
    siteId: id,
    kind: "fire",
    severity: "warning",
    date: "2026-10-02",
    summary: "test",
    source: "test",
  });
  const removed = removeSite(store, id);
  assert.equal(removed.removedPlantings, 1);
  assert.equal(removed.removedChecks, 1);
  assert.equal(removed.removedThreats, 1);
  assert.equal(store.sites.length, 0);
  assert.equal(store.plantings.length, 0);
  assert.equal(store.checks.length, 0);
  assert.equal(store.threats.length, 0);
});

test("logPlanting defaults to today and sums counts", () => {
  const { store, id } = storeWithSite();
  const first = logPlanting(store, { siteRef: id, species: "Eucalyptus", count: 60 }, NOW);
  logPlanting(store, { siteRef: id, species: "Acacia", count: 40, date: "2026-09-15" }, NOW);
  assert.equal(first.date, "2026-10-27");
  assert.equal(plantedTotal(store, id), 100);
  assert.equal(listPlantings(store, id).length, 2);
});

test("logPlanting rejects bad counts", () => {
  const { store, id } = storeWithSite();
  assert.throws(() => logPlanting(store, { siteRef: id, species: "A", count: 0 }, NOW), /greater than zero/);
  assert.throws(() => logPlanting(store, { siteRef: id, species: "A", count: 2.5 }, NOW), /whole number/);
  assert.throws(() => logPlanting(store, { siteRef: id, species: "A", count: -3 }, NOW), /greater than zero/);
});

test("logPlanting rejects a future date and a missing species", () => {
  const { store, id } = storeWithSite();
  assert.throws(
    () => logPlanting(store, { siteRef: id, species: "A", count: 1, date: "2026-12-01" }, NOW),
    /future/,
  );
  assert.throws(() => logPlanting(store, { siteRef: id, species: "  ", count: 1 }, NOW), /species/);
});

test("logCheck uses the logged planting total by default", () => {
  const { store, id } = storeWithSite();
  logPlanting(store, { siteRef: id, species: "Eucalyptus", count: 120, date: "2026-09-01" }, NOW);
  const check = logCheck(store, { siteRef: id, alive: 96, date: "2026-10-20" }, NOW);
  assert.equal(check.planted, 120);
  assert.equal(check.alive, 96);
});

test("logCheck rejects alive above planted and negative alive", () => {
  const { store, id } = storeWithSite();
  logPlanting(store, { siteRef: id, species: "Eucalyptus", count: 50, date: "2026-09-01" }, NOW);
  assert.throws(() => logCheck(store, { siteRef: id, alive: 51, date: "2026-10-20" }, NOW), /must not exceed/);
  assert.throws(() => logCheck(store, { siteRef: id, alive: -1, date: "2026-10-20" }, NOW), /zero or more/);
});

test("logCheck rejects a date before the first planting", () => {
  const { store, id } = storeWithSite();
  logPlanting(store, { siteRef: id, species: "Eucalyptus", count: 10, date: "2026-09-10" }, NOW);
  assert.throws(() => logCheck(store, { siteRef: id, alive: 5, date: "2026-09-01" }, NOW), /before the first planting/);
});

test("logCheck requires plantings when no count is given", () => {
  const { store, id } = storeWithSite();
  assert.throws(() => logCheck(store, { siteRef: id, alive: 5 }, NOW), /no plantings are logged/);
});

test("logCheck accepts zero alive and rounds height", () => {
  const { store, id } = storeWithSite();
  logPlanting(store, { siteRef: id, species: "Eucalyptus", count: 10, date: "2026-09-01" }, NOW);
  const check = logCheck(store, { siteRef: id, alive: 0, avgHeightCm: 12.345, date: "2026-10-20" }, NOW);
  assert.equal(check.alive, 0);
  assert.equal(check.avgHeightCm, 12.3);
});

test("earliestPlanting returns the first date or null", () => {
  const { store, id } = storeWithSite();
  assert.equal(earliestPlanting(store, id), null);
  logPlanting(store, { siteRef: id, species: "A", count: 1, date: "2026-09-20" }, NOW);
  logPlanting(store, { siteRef: id, species: "A", count: 1, date: "2026-09-10" }, NOW);
  assert.equal(earliestPlanting(store, id), "2026-09-10");
});

test("latestCheck picks the newest date regardless of insert order", () => {
  const { store, id } = storeWithSite();
  logPlanting(store, { siteRef: id, species: "A", count: 80, date: "2026-08-01" }, NOW);
  logCheck(store, { siteRef: id, alive: 40, date: "2026-10-01" }, NOW);
  logCheck(store, { siteRef: id, alive: 70, date: "2026-09-01" }, NOW);
  assert.equal(latestCheck(store, id)?.date, "2026-10-01");
  assert.equal(listChecks(store, id)[0].date, "2026-10-01");
});

test("survivalRate rounds to one decimal percentage", () => {
  assert.equal(survivalRate(120, 96), 80);
  assert.equal(survivalRate(3, 1), 33.3);
  assert.equal(survivalRate(0, 0), null);
});

test("survivalStats reports the latest check per site", () => {
  const store = emptyStore();
  const a = addSite(store, { name: "Alpha", lat: -33.7, lon: 151.1 }, NOW);
  const b = addSite(store, { name: "Beta", lat: -33.8, lon: 151.2 }, NOW);
  logPlanting(store, { siteRef: a.id, species: "A", count: 100, date: "2026-08-01" }, NOW);
  logCheck(store, { siteRef: a.id, alive: 75, date: "2026-10-01" }, NOW);
  logPlanting(store, { siteRef: b.id, species: "B", count: 200, date: "2026-08-02" }, NOW);

  const stats = survivalStats(store);
  const alpha = stats.find((row) => row.siteId === a.id);
  const beta = stats.find((row) => row.siteId === b.id);
  assert.equal(alpha?.rate, 75);
  assert.equal(alpha?.checks, 1);
  assert.equal(beta?.rate, null);
  assert.equal(beta?.checkDate, null);
});

test("portfolioTotals combines latest checks", () => {
  const store = emptyStore();
  const a = addSite(store, { name: "Alpha", lat: -33.7, lon: 151.1 }, NOW);
  const b = addSite(store, { name: "Beta", lat: -33.8, lon: 151.2 }, NOW);
  logPlanting(store, { siteRef: a.id, species: "A", count: 100, date: "2026-08-01" }, NOW);
  logCheck(store, { siteRef: a.id, alive: 80, date: "2026-10-01" }, NOW);
  logPlanting(store, { siteRef: b.id, species: "B", count: 50, date: "2026-08-02" }, NOW);
  logCheck(store, { siteRef: b.id, alive: 25, date: "2026-10-02" }, NOW);

  const totals = portfolioTotals(store);
  assert.equal(totals.sites, 2);
  assert.equal(totals.sitesWithChecks, 2);
  assert.equal(totals.planted, 150);
  assert.equal(totals.alive, 105);
  assert.equal(totals.rate, 70);
  assert.equal(totals.checks, 2);
});

test("siteSummary joins plantings, checks, and threats", () => {
  const { store, id } = storeWithSite();
  const site = requireSite(store, id);
  logPlanting(store, { siteRef: id, species: "A", count: 30, date: "2026-09-01" }, NOW);
  logCheck(store, { siteRef: id, alive: 24, date: "2026-10-01" }, NOW);
  store.threats.push({
    id: newId("threat"),
    siteId: id,
    kind: "fire",
    severity: "warning",
    date: "2026-10-05",
    summary: "fire 3 km away",
    source: "firms",
  });
  const summary = siteSummary(store, site);
  assert.equal(summary.plantedLogged, 30);
  assert.equal(summary.survival, 80);
  assert.equal(summary.threats, 1);
  assert.equal(summary.latestThreat?.date, "2026-10-05");
});

test("nearestSites sorts by distance and limits results", () => {
  const store = emptyStore();
  addSite(store, { name: "Near", lat: -33.70, lon: 151.10 }, NOW);
  addSite(store, { name: "Mid", lat: -33.75, lon: 151.10 }, NOW);
  addSite(store, { name: "Far", lat: -34.50, lon: 151.10 }, NOW);
  const nearest = nearestSites(store, { lat: -33.701, lon: 151.101 }, 2);
  assert.equal(nearest.length, 2);
  assert.equal(nearest[0].site.name, "Near");
  assert.ok(nearest[0].km < nearest[1].km);
});