import { fetchFreight } from "@/lib/api";
import FreightClient, { type FreightData } from "./FreightClient";
// Committed static file is the source of truth for this static-deployed site.
// Imported at build time so the page renders without a live backend; the daily
// data commit triggers a redeploy that picks up the latest file.
import freightStatic from "@/public/data/freight.json";

export default async function FreightPage() {
  // Prefer the live backend if one is configured; otherwise use the static file.
  const data = (await fetchFreight().catch(() => freightStatic)) as FreightData;
  return <FreightClient data={data} />;
}
