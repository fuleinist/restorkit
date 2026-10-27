import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./store.js";

export interface CachedText {
  text: string;
  fetchedAt: string;
  ageMs: number;
  stale: boolean;
}

export function safeCacheKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

export function cachePath(dir: string, key: string): string {
  return join(cacheDir(dir), safeCacheKey(key));
}

export function readCachedText(
  dir: string,
  key: string,
  ttlMs: number,
  now: Date = new Date(),
): CachedText | null {
  const path = cachePath(dir, key);
  if (!existsSync(path)) return null;
  const ageMs = Math.max(0, now.getTime() - statSync(path).mtimeMs);
  return {
    text: readFileSync(path, "utf8"),
    fetchedAt: new Date(statSync(path).mtimeMs).toISOString(),
    ageMs,
    stale: ageMs > ttlMs,
  };
}

export function writeCachedText(dir: string, key: string, text: string, now: Date = new Date()): string {
  const path = cachePath(dir, key);
  mkdirSync(cacheDir(dir), { recursive: true });
  writeFileSync(path, text, "utf8");
  // Touch the timestamp so a passed-in clock controls freshness in tests.
  utimesSync(path, now, now);
  return path;
}