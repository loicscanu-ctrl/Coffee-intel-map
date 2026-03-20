import { fetchFreight } from "@/lib/api";
import FreightClient from "./FreightClient";

export default async function FreightPage() {
  const data = await fetchFreight().catch(() => null);
  return <FreightClient data={data} />;
}
