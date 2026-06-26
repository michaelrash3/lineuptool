import React, { memo, useEffect, useState } from "react";
import { Icons } from "../icons";
import {
  getGameWeather,
  type GameWeather,
  type WeatherIconKey,
} from "../utils/weather";

// Compact game-day forecast pill for the next-game card. Fetches lazily from
// Open-Meteo (see utils/weather) and renders nothing until/unless a forecast is
// available — so a missing location, a game beyond the forecast horizon, or any
// fetch failure simply shows no pill rather than an error.

const iconFor = (key: WeatherIconKey): React.ComponentType<any> => {
  switch (key) {
    case "sun":
      return Icons.Sun;
    case "rain":
      return Icons.CloudRain;
    case "snow":
      return Icons.CloudSnow;
    case "fog":
      return Icons.CloudFog;
    case "storm":
      return Icons.CloudLightning;
    default:
      return Icons.Cloud;
  }
};

interface WeatherWidgetProps {
  location?: string | null;
  date?: string | null;
  className?: string;
}

export const WeatherWidget = memo(
  ({ location, date, className = "" }: WeatherWidgetProps) => {
    const [weather, setWeather] = useState<GameWeather | null>(null);

    useEffect(() => {
      let cancelled = false;
      setWeather(null);
      getGameWeather(location, date).then((w) => {
        if (!cancelled) setWeather(w);
      });
      return () => {
        cancelled = true;
      };
    }, [location, date]);

    if (!weather) return null;
    const Icon = iconFor(weather.icon);
    // Surface rain risk prominently — that's the bit that decides field calls.
    const rainy = (weather.precipPct ?? 0) >= 40;

    return (
      <div
        className={`inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 ${className}`}
        title={`Forecast: ${weather.label}`}
      >
        <Icon className="w-4 h-4 text-ink-2" aria-hidden="true" />
        <span className="text-[11px] font-bold text-ink tabular-nums">
          {weather.highF != null ? `${weather.highF}°` : ""}
          {weather.highF != null && weather.lowF != null ? (
            <span className="text-ink-3">{` / ${weather.lowF}°`}</span>
          ) : null}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
          {weather.label}
        </span>
        {weather.precipPct != null && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-bold tabular-nums ${
              rainy ? "text-warnfg" : "text-ink-3"
            }`}
          >
            <Icons.Droplets className="w-3 h-3" aria-hidden="true" />
            {weather.precipPct}%
          </span>
        )}
      </div>
    );
  },
);

WeatherWidget.displayName = "WeatherWidget";
