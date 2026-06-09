"use client";
/**
 * Report wrappers for the per-origin "weather pack" — the four core climatology
 * charts (daily accumulated rainfall, mean temperature, monthly rainfall,
 * cumulative YTD rainfall) in a 2×2 grid. All origins share WeatherCharts in its
 * isReportMode, which renders just those charts over the default all-regions,
 * latest-month selection. Adding an origin = one entry below + one registry row.
 */
import WeatherCharts from "@/components/supply/WeatherCharts";

/** dataUrl + display title (+ southern-hemisphere month offset for Brazil). */
const ORIGINS = {
  brazil:    { url: "/data/brazil_weather.json",    title: "Weather · Brazil",                     startMonthIdx: 5 },
  vietnam:   { url: "/data/vn_weather.json",        title: "Weather · Vietnam Central Highlands",  startMonthIdx: 0 },
  colombia:  { url: "/data/colombia_weather.json",  title: "Weather · Colombia",                   startMonthIdx: 0 },
  honduras:  { url: "/data/honduras_weather.json",  title: "Weather · Honduras",                   startMonthIdx: 0 },
  ethiopia:  { url: "/data/ethiopia_weather.json",  title: "Weather · Ethiopia",                   startMonthIdx: 0 },
  uganda:    { url: "/data/uganda_weather.json",    title: "Weather · Uganda",                     startMonthIdx: 0 },
  indonesia: { url: "/data/indonesia_weather.json", title: "Weather · Indonesia",                  startMonthIdx: 0 },
} as const;

const pack = (key: keyof typeof ORIGINS) => {
  const o = ORIGINS[key];
  return function WeatherPack() {
    return <WeatherCharts dataUrl={o.url} title={o.title} startMonthIdx={o.startMonthIdx} isReportMode />;
  };
};

export const BrazilWeather    = pack("brazil");
export const VietnamWeather   = pack("vietnam");
export const ColombiaWeather  = pack("colombia");
export const HondurasWeather  = pack("honduras");
export const EthiopiaWeather  = pack("ethiopia");
export const UgandaWeather    = pack("uganda");
export const IndonesiaWeather = pack("indonesia");
