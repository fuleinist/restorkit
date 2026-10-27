import type { BBox, LatLon } from "./types.js";

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function validLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function validLon(lon: number): boolean {
  return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

export function withinRadius(center: LatLon, point: LatLon, radiusKm: number): boolean {
  return haversineKm(center, point) <= radiusKm;
}

/** Bounding box that contains the circle. Latitude delta is exact, longitude is padded. */
export function bboxForRadius(center: LatLon, radiusKm: number): BBox {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const cosLat = Math.cos(toRad(Math.max(-89.9, Math.min(89.9, center.lat))));
  const lonDelta = latDelta / Math.max(0.01, Math.abs(cosLat));
  const south = Math.max(-90, center.lat - latDelta);
  const north = Math.min(90, center.lat + latDelta);
  let west = center.lon - lonDelta;
  let east = center.lon + lonDelta;
  if (lonDelta >= 180) {
    west = -180;
    east = 180;
  } else {
    west = ((((west + 180) % 360) + 360) % 360) - 180;
    east = ((((east + 180) % 360) + 360) % 360) - 180;
  }
  return { south, west, north, east };
}

export function mergeBBoxes(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((acc, box) => ({
    south: Math.min(acc.south, box.south),
    west: Math.min(acc.west, box.west),
    north: Math.max(acc.north, box.north),
    east: Math.max(acc.east, box.east),
  }));
}

export function inBBox(point: LatLon, box: BBox): boolean {
  const latOk = point.lat >= box.south && point.lat <= box.north;
  if (!latOk) return false;
  if (box.west <= box.east) return point.lon >= box.west && point.lon <= box.east;
  return point.lon >= box.west || point.lon <= box.east;
}

/** Rough area of a bounding box in square kilometres. Used only for map framing. */
export function bboxSpanKm(box: BBox): number {
  const midLat = (box.south + box.north) / 2;
  const height = haversineKm({ lat: box.south, lon: midLat }, { lat: box.north, lon: midLat });
  let widthDeg = box.east - box.west;
  if (widthDeg < 0) widthDeg += 360;
  const width = (widthDeg / 360) * 2 * Math.PI * EARTH_RADIUS_KM * Math.cos(toRad(midLat));
  return Math.max(height, width);
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}${ns} ${Math.abs(lon).toFixed(4)}${ew}`;
}

/** Equirectangular projection into a 0..1 box. Fine for a local site map. */
export function project(
  point: LatLon,
  box: BBox,
): { x: number; y: number } {
  let widthDeg = box.east - box.west;
  if (widthDeg <= 0) widthDeg += 360;
  let lon = point.lon;
  if (box.east < box.west && lon < box.west) lon += 360;
  const x = widthDeg === 0 ? 0.5 : (lon - box.west) / widthDeg;
  const heightDeg = Math.max(0.000001, box.north - box.south);
  const y = 1 - (point.lat - box.south) / heightDeg;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** Pad a box so markers near the edge stay visible. */
export function padBBox(box: BBox, fraction = 0.15): BBox {
  const latPad = Math.max(0.01, (box.north - box.south) * fraction);
  let widthDeg = box.east - box.west;
  if (widthDeg <= 0) widthDeg += 360;
  const lonPad = Math.max(0.01, widthDeg * fraction);
  return {
    south: Math.max(-90, box.south - latPad),
    north: Math.min(90, box.north + latPad),
    west: box.west - lonPad,
    east: box.east + lonPad,
  };
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
}

export function todayISO(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function addDaysISO(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}