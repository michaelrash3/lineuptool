import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysUntil, describeWeatherCode, getGameWeather } from "./weather";

describe("describeWeatherCode", () => {
  it("maps representative WMO codes to label + icon bucket", () => {
    expect(describeWeatherCode(0)).toEqual({ label: "Clear", icon: "sun" });
    expect(describeWeatherCode(3)).toEqual({
      label: "Overcast",
      icon: "cloud",
    });
    expect(describeWeatherCode(48)).toEqual({ label: "Fog", icon: "fog" });
    expect(describeWeatherCode(63).icon).toBe("rain");
    expect(describeWeatherCode(75).icon).toBe("snow");
    expect(describeWeatherCode(82).icon).toBe("rain");
    expect(describeWeatherCode(95).icon).toBe("storm");
  });
});

describe("daysUntil", () => {
  const now = new Date(2026, 5, 26); // 2026-06-26 local
  it("counts whole days to a future date", () => {
    expect(daysUntil("2026-06-26", now)).toBe(0);
    expect(daysUntil("2026-06-29", now)).toBe(3);
  });
  it("is negative for past dates and NaN for junk", () => {
    expect(daysUntil("2026-06-20", now)).toBe(-6);
    expect(Number.isNaN(daysUntil("not-a-date", now))).toBe(true);
  });
});

describe("getGameWeather", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 26));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const futureDate = "2026-06-28";

  it("returns null without fetching for missing location/date or past games", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await getGameWeather("", futureDate)).toBeNull();
    expect(await getGameWeather("Field", "")).toBeNull();
    expect(await getGameWeather("Field", "2026-06-01")).toBeNull(); // past
    expect(await getGameWeather("Field", "2030-01-01")).toBeNull(); // beyond horizon
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("geocodes then fetches the daily forecast and shapes the result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ latitude: 40, longitude: -83 }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          daily: {
            weather_code: [61],
            temperature_2m_max: [72.4],
            temperature_2m_min: [55.6],
            precipitation_probability_max: [80],
          },
        }),
      } as Response);

    const w = await getGameWeather("City Park", futureDate);
    expect(w).toEqual({
      code: 61,
      label: "Rain",
      icon: "rain",
      highF: 72,
      lowF: 56,
      precipPct: 80,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("caches the result so a repeat call does not refetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ latitude: 1, longitude: 2 }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          daily: {
            weather_code: [0],
            temperature_2m_max: [70],
            temperature_2m_min: [50],
            precipitation_probability_max: [0],
          },
        }),
      } as Response);

    await getGameWeather("City Park", futureDate);
    const second = await getGameWeather("City Park", futureDate);
    expect(second?.label).toBe("Clear");
    expect(fetchSpy).toHaveBeenCalledTimes(2); // not 4 — second call hit cache
  });

  it("caches a null when the location can't be geocoded", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);
    expect(await getGameWeather("Nowhere Field", futureDate)).toBeNull();
    expect(await getGameWeather("Nowhere Field", futureDate)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // negative result cached
  });
});
