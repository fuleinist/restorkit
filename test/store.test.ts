import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyStore,
  initStore,
  loadStore,
  newId,
  normalizeStore,
  resolveDataDir,
  saveStore,
  storePath,
} from "../src/store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "restorkit-store-"));
}

test("initStore creates a store file and reports it", () => {
  const dir = tempDir();
  const result = initStore(dir);
  assert.equal(result.created, true);
  assert.equal(result.path, storePath(dir));
  assert.ok(existsSync(result.path));
  const store = loadStore(dir);
  assert.deepEqual(store, emptyStore());
});

test("initStore keeps existing data on a second call", () => {
  const dir = tempDir();
  initStore(dir);
  const store = loadStore(dir);
  store.sites.push({
    id: newId("site"),
    name: "Bellbird Ridge",
    lat: -33.7,
    lon: 151.1,
    species: ["Eucalyptus pilularis"],
    createdAt: new Date().toISOString(),
  });
  saveStore(dir, store);

  const second = initStore(dir);
  assert.equal(second.created, false);
  assert.equal(loadStore(dir).sites.length, 1);
});

test("loadStore returns an empty store when no file exists", () => {
  const dir = tempDir();
  assert.deepEqual(loadStore(dir), emptyStore());
});

test("loadStore treats a blank file as empty", () => {
  const dir = tempDir();
  writeFileSync(storePath(dir), "   \n", "utf8");
  assert.deepEqual(loadStore(dir), emptyStore());
});

test("loadStore rejects invalid JSON with the file path", () => {
  const dir = tempDir();
  writeFileSync(storePath(dir), "{ not json", "utf8");
  assert.throws(() => loadStore(dir), /not valid JSON/);
});

test("loadStore rejects a future version", () => {
  const dir = tempDir();
  writeFileSync(storePath(dir), JSON.stringify({ version: 99, sites: [] }), "utf8");
  assert.throws(() => loadStore(dir), /unsupported data version 99/);
});

test("normalizeStore fills missing collections", () => {
  const store = normalizeStore({ version: 1, sites: [] });
  assert.deepEqual(store.plantings, []);
  assert.deepEqual(store.checks, []);
  assert.deepEqual(store.threats, []);
  assert.deepEqual(store.scans, []);
});

test("normalizeStore rejects a non-object", () => {
  assert.throws(() => normalizeStore([]), /not a JSON object/);
  assert.throws(() => normalizeStore("x"), /not a JSON object/);
});

test("saveStore writes pretty JSON and leaves no temp file", () => {
  const dir = tempDir();
  const store = emptyStore();
  saveStore(dir, store);
  const files = readdirSync(dir);
  assert.deepEqual(files, ["store.json"]);
});

test("saveStore creates nested directories", () => {
  const dir = join(tempDir(), "a", "b");
  saveStore(dir, emptyStore());
  assert.ok(existsSync(storePath(dir)));
});

test("resolveDataDir prefers the flag, then env, then the working directory", () => {
  const explicit = resolveDataDir("/tmp/explicit", { RESTORKIT_DIR: "/tmp/env" } as NodeJS.ProcessEnv);
  assert.match(explicit, /explicit$/);
  const fromEnv = resolveDataDir(undefined, { RESTORKIT_DIR: "/tmp/from-env" } as NodeJS.ProcessEnv);
  assert.match(fromEnv, /from-env$/);
  const fallback = resolveDataDir(undefined, {} as NodeJS.ProcessEnv);
  assert.match(fallback, /\.restorkit$/);
});

test("newId is unique and carries the prefix", () => {
  const a = newId("site");
  const b = newId("site");
  assert.notEqual(a, b);
  assert.match(a, /^site_[0-9a-f]{10}$/);
});