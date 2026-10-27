import { readCachedText, writeCachedText } from "./cache.js";
import { todayISO } from "./geo.js";
import { getJson, type FetchLike } from "./http.js";
import type { Severity } from "./types.js";

export interface FireWeatherInput {
  tmax: number;
  rhMin: number;
  windMax: number;
  precip: number;
}

export interface FireWeatherDay extends FireWeatherInput {
  date: string;
  index: number;
  severity: Severity | null;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Simple fire-weather indicator, 0..100.
 * Heat, low humidity, wind, and a dry day each add weight.
 * This is a planning indicator, not an official fire danger rating.
 */
export function fireWeatherIndex(input: FireWeatherInput): number {
  const heat = clamp01((input.tmax - 20) / 20) * 35;
  const dry = clamp01((60 - input.rhMin) / 50) * 35;
  const wind = clamp01((input.windMax - 10) / 30) * 20;
  const noRain = input.precip <= 0.2 ? 10 : 0;
  return Math.round(heat + dry + wind + noRain);
}

export function fireWeatherSeverity(index: number): Severity | null {
  if (index >= 70) return "severe";
  if (index >= 50) return "warning";
  if (index >= 30) return "watch";
  return null;
}

interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    relative_humidity_2m_min?: number[];
    wind_speed_10m_max?: number[];
    precipitation_sum?: number[];
  };
}

export interface FireWeatherOptions {
  site: { id: string; lat: number; lon: number };
  dir: string;
  days: number;
  offline?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface FireWeatherResult {
  days: FireWeatherDay[];
  cached: boolean;
  fetchedAt: string;
}

const HOUR_MS = 3600 * 1000;

export function buildFireWeatherUrl(lat: number, lon: number, days: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,precipitation_sum",
    forecast_days: String(Math.max(1, Math.min(16, days))),
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function parseFireWeather(payload: OpenMeteoResponse): FireWeatherDay[] {
  const daily = payload.daily;
  if (!daily?.time || daily.time.length === 0) return [];
  const out: FireWeatherDay[] = [];
  for (let i = 0; i < daily.time.length; i += 1) {
    const date = daily.time[i];
    const tmax = daily.temperature_2m_max?.[i];
    const rhMin = daily.relative_humidity_2m_min?.[i];
    const windMax = daily.wind_speed_10m_max?.[i];
    const precip = daily.precipitation_sum?.[i];
    if (typeof tmax !== "number" || typeof rhMin !== "number") continue;
    const input: FireWeatherInput = {
      tmax,
      rhMin,
      windMax: typeof windMax === "number" ? windMax : 0,
      precip: typeof precip === "number" ? precip : 0,
    };
    const index = fireWeatherIndex(input);
    out.push({ date, ...input, index, severity: fireWeatherSeverity(index) });
  }
  return out;
}

export async function loadFireWeather(options: FireWeatherOptions): Promise<FireWeatherResult> {
  const now = options.now ?? new Date();
  const today = todayISO(now);
  const key = `weather-${options.site.id}-${today}-${options.days}d.json`;
  const cached = readCachedText(options.dir, key, 2 * HOUR_MS, now);

  if (cached && !cached.stale) {
    return { days: parseFireWeather(JSON.parse(cached.text) as OpenMeteoResponse), cached: true, fetchedAt: cached.fetchedAt };
  }
  if (options.offline) {
    if (!cached) throw new Error(`offline mode has no cached weather for ${options.site.id}`);
    return { days: parseFireWeather(JSON.parse(cached.text) as OpenMeteoResponse), cached: true, fetchedAt: cached.fetchedAt };
  }

  const payload = await getJson<OpenMeteoResponse>(buildFireWeatherUrl(options.site.lat, options.site.lon, options.days), {
    fetchImpl: options.fetchImpl,
    label: "Open-Meteo forecast",
  });
  writeCachedText(options.dir, key, JSON.stringify(payload), now);
  return { days: parseFireWeather(payload), cached: false, fetchedAt: now.toISOString() };
}