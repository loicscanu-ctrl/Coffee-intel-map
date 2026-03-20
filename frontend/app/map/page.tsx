import { fetchNews, fetchMapCountries, fetchMapFactories } from "@/lib/api";
import MapPageClient from "./MapPageClient";

export default async function MapPage() {
  const [news, countries, factories] = await Promise.all([
    fetchNews().catch(() => []),
    fetchMapCountries().catch(() => []),
    fetchMapFactories().catch(() => []),
  ]);
  return <MapPageClient news={news} countries={countries} factories={factories} />;
}
