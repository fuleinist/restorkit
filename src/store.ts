import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Store } from "./types.js";

export const STORE_VERSION = 1 as const;
export const STORE_FILE = "store.json";
export const CACHE_DIR = "cache";

/** Expand a leading tilde and resolve the path. */
export function expandPath(input: string): string {
  const trimmed = input.trim();
  const home = homedir();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return resolve(home, trimmed.slice(2));
  }
  return resolve(trimmed);
}

/** Pick the data directory: flag, then env, then ./.restorkit. */
export function resolveDataDir(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const chosen = explicit?.trim() || env.RESTORKIT_DIR?.trim() || join(process.cwd(), ".restorkit");
  return expandPath(chosen);
}

export function storePath(dir: string): string {
  return join(dir, STORE_FILE);
}

export function cacheDir(dir: string): string {
  return join(dir, CACHE_DIR);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function emptyStore(): Store {
  return { version: STORE_VERSION, sites: [], plantings: [], checks: [], threats: [], scans: [] };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Validate a parsed store. Throws on a shape that cannot be trusted. */
export function normalizeStore(value: unknown, source = STORE_FILE): Store {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`data file is not a JSON object: ${source}`);
  }
  const raw = value as Record<string, unknown>;
  const version = raw.version ?? STORE_VERSION;
  if (version !== STORE_VERSION) {
    throw new Error(
      `unsupported data version ${String(version)} in ${source} (this build reads version ${STORE_VERSION})`,
    );
  }
  return {
    version: STORE_VERSION,
    sites: asArray(raw.sites) as Store["sites"],
    plantings: asArray(raw.plantings) as Store["plantings"],
    checks: asArray(raw.checks) as Store["checks"],
    threats: asArray(raw.threats) as Store["threats"],
    scans: asArray(raw.scans) as Store["scans"],
  };
}

export function loadStore(dir: string): Store {
  const path = storePath(dir);
  if (!existsSync(path)) return emptyStore();
  const raw = readFileSync(path, "utf8");
  if (raw.trim() === "") return emptyStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`data file is not valid JSON: ${path} (${reason})`);
  }
  return normalizeStore(parsed, path);
}

/** Write through a temp file so a crash never leaves a half store. */
export function saveStore(dir: string, store: Store): string {
  mkdirSync(dir, { recursive: true });
  const path = storePath(dir);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(temp, path);
  return path;
}

export interface InitResult {
  created: boolean;
  path: string;
  dir: string;
}

export function initStore(dir: string): InitResult {
  mkdirSync(dir, { recursive: true });
  const path = storePath(dir);
  if (existsSync(path)) {
    loadStore(dir);
    return { created: false, path, dir };
  }
  saveStore(dir, emptyStore());
  return { created: true, path, dir };
}