"use client";
/**
 * Report wrappers for the weather-analog visuals. WeatherAnalogs self-fetches
 * its dataUrl, so Brazil/Vietnam are two clean entries. (The full multi-metric
 * weather charts remain a separate, larger task.)
 */
import WeatherAnalogs from "@/components/supply/WeatherAnalogs";

export function BrazilWeatherAnalogs() {
  return <WeatherAnalogs dataUrl="/data/weather_analogs_brazil.json" label="Brazil arabica" />;
}

export function VietnamWeatherAnalogs() {
  return <WeatherAnalogs dataUrl="/data/weather_analogs_vietnam.json" label="Vietnam robusta" />;
}
