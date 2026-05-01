import { fetchFreight } from "@/lib/api";
import FreightClient from "./FreightClient";

export default async function FreightPage() {
  const data = await fetchFreight().catch((e) => {
    console.error("[freight] fetch failed", e);
    return null;
  });
  return <FreightClient data={data} />;
}
