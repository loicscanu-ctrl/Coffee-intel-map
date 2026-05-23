"use client";
import WeatherCharts from "./WeatherCharts";

// Vietnam uses the shared WeatherCharts component (the original reference format).
export default function VnWeatherCharts() {
  return (
    <WeatherCharts
      dataUrl="/data/vn_weather.json"
      title="Weather · Vietnam Central Highlands"
    />
  );
}
