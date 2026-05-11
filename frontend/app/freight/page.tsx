import { fetchFreight } from "@/lib/api";
import FreightClient, { type FreightData } from "./FreightClient";

export default async function FreightPage() {
  const data = await fetchFreight().catch((e) => {
    console.error("[freight] fetch failed", e);
    return null;
  }) as FreightData | null;
  return <FreightClient data={data} />;
}
