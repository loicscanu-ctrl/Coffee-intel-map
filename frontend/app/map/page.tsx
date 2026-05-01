import MapPageClient from "./MapPageClient";

export default function MapPage() {
  // Data is fetched client-side so the page renders instantly even when the
  // backend is slow, cold-starting, or briefly unreachable. SSR with
  // force-dynamic previously left the page blank whenever the upstream API
  // hiccuped during a Vercel serverless request.
  return <MapPageClient />;
}
