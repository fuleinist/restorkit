import type { FetchLike, HttpResponse } from "../src/http.js";

export interface Route {
  body: string;
  status?: number;
}

export interface FakeFetch extends FetchLike {
  calls: { url: string; headers?: Record<string, string> }[];
}

/** Route by substring. Unmatched calls return 404 with a short message. */
export function fakeFetch(routes: { match: string; body: string; status?: number }[]): FakeFetch {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    const route = routes.find((entry) => url.includes(entry.match));
    const status = route?.status ?? (route ? 200 : 404);
    const body = route?.body ?? "not found";
    const response: HttpResponse = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      headers: { get: () => null },
    };
    return response;
  };
  const wrapped = impl as FakeFetch;
  wrapped.calls = calls;
  return wrapped;
}

export const FIRMS_CSV = [
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight",
  "-33.700,151.100,330.1,0.4,0.6,2026-10-27,0310,N,1.0NRT,1.0NRT,290.1,12.5,D",
  "-33.705,151.105,325.0,0.4,0.6,2026-10-27,0320,N,h,1.0NRT,288.0,8.0,D",
  "-20.000,140.000,300.0,0.4,0.6,2026-10-20,0300,N,n,1.0NRT,280,1,D",
  "not-a-number,151.0,300,0.4,0.6,2026-10-27,0300,N,n,1.0NRT,280,1,D",
].join("\n");

export const WEATHER_JSON = JSON.stringify({
  daily: {
    time: ["2026-10-27", "2026-10-28"],
    temperature_2m_max: [38, 24],
    relative_humidity_2m_min: [15, 55],
    wind_speed_10m_max: [35, 12],
    precipitation_sum: [0, 3],
  },
});

export const FIRMS_URL_MATCH = "firms.modaps.eosdis.nasa.gov";
export const WEATHER_URL_MATCH = "api.open-meteo.com";
export const GFW_URL_MATCH = "data-api.globalforestwatch.org";