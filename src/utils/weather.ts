// Game-day weather for the next-game card. Uses Open-Meteo — free, keyless, no
// committed secret (fits the Spark-plan constraint), with a sibling geocoding
// API to turn a game's free-text location into coordinates. Results are cached
// in localStorage per location+date so opening Home repeatedly doesn't re-hit
// the API. Everything degrades to null silently: weather is a nicety, never a
// blocker, and a field name that doesn't geocode just shows nothing.

export type WeatherIconKey =
  | "sun"
  | "cloud"
  | "rain"
  | "snow"
  | "fog"
  | "storm";

export interface GameWeather {
  code: number;
  label: string;
  icon: WeatherIconKey;
  highF: number | null;
  lowF: number | null;
  precipPct: number | null;
}

// WMO weather-interpretation codes (Open-Meteo `weather_code`) → a short label
// and the icon bucket we render. Pure + exported so the mapping is unit-tested
// without any network.
export const describeWeatherCode = (
  code: number,
): { label: string; icon: WeatherIconKey } => {
  if (code === 0) return { label: "Clear", icon: "sun" };
  if (code === 1) return { label: "Mostly clear", icon: "sun" };
  if (code === 2) return { label: "Partly cloudy", icon: "cloud" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "rain" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "rain" };
  if (code === 85 || code === 86)
    return { label: "Snow showers", icon: "snow" };
  if (code >= 95) return { label: "Thunderstorm", icon: "storm" };
  return { label: "—", icon: "cloud" };
};

// Whole-day difference from today (local) to an ISO yyyy-mm-dd date. Negative =
// past. Used to keep requests inside Open-Meteo's ~16-day forecast horizon.
export const daysUntil = (isoDate: string, now: Date = new Date()): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || "");
  if (!m) return NaN;
  const target = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  ).getTime();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return Math.round((target - today) / 86_400_000);
};

const CACHE_PREFIX = "cc.weather:v1:";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3h — forecasts don't move that fast

interface CacheEntry {
  at: number;
  data: GameWeather | null;
}

const readCache = (key: string): CacheEntry | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (key: string, data: GameWeather | null): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage full / disabled — fine, we just refetch next time.
  }
};

const geocode = async (
  location: string,
): Promise<{ lat: number; lon: number } | null> => {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    location,
  )}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    results?: Array<{ latitude?: number; longitude?: number }>;
  };
  const hit = body.results?.[0];
  if (hit?.latitude == null || hit?.longitude == null) return null;
  return { lat: hit.latitude, lon: hit.longitude };
};

// Fetch the daily forecast for one game (its location + date), or null when the
// location can't be geocoded, the date is outside the forecast window, or any
// request fails. Cached per location+date.
export const getGameWeather = async (
  location: string | null | undefined,
  isoDate: string | null | undefined,
): Promise<GameWeather | null> => {
  const loc = (location || "").trim();
  const date = (isoDate || "").slice(0, 10);
  if (!loc || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof fetch !== "function") return null;

  // Open-Meteo's free forecast spans roughly today..+16 days. Skip past games
  // and anything beyond the horizon — there's nothing to show.
  const delta = daysUntil(date);
  if (Number.isNaN(delta) || delta < 0 || delta > 16) return null;

  const cacheKey = `${CACHE_PREFIX}${loc.toLowerCase()}:${date}`;
  const cached = readCache(cacheKey);
  if (cached) return cached.data;

  try {
    const geo = await geocode(loc);
    if (!geo) {
      writeCache(cacheKey, null);
      return null;
    }
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=fahrenheit&timezone=auto&start_date=${date}&end_date=${date}`;
    const res = await fetch(url);
    if (!res.ok) {
      writeCache(cacheKey, null);
      return null;
    }
    const body = (await res.json()) as {
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };
    const d = body.daily;
    const code = d?.weather_code?.[0];
    if (d == null || code == null) {
      writeCache(cacheKey, null);
      return null;
    }
    const round = (n: number | undefined): number | null =>
      typeof n === "number" && !Number.isNaN(n) ? Math.round(n) : null;
    const { label, icon } = describeWeatherCode(code);
    const weather: GameWeather = {
      code,
      label,
      icon,
      highF: round(d.temperature_2m_max?.[0]),
      lowF: round(d.temperature_2m_min?.[0]),
      precipPct: round(d.precipitation_probability_max?.[0]),
    };
    writeCache(cacheKey, weather);
    return weather;
  } catch {
    return null;
  }
};
