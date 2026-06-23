// ERDDAP proxy — Cloudflare Worker.
//
// Why: NOAA's CoastWatch PFEG + OSMC ERDDAP servers blacklist
// GitHub Actions egress IP ranges (Azure / Microsoft ASNs). They
// don't blacklist Cloudflare edge IPs — so from inside a Worker
// the outbound fetch presents as standard CF traffic and waves
// through. Same architectural trick we used for `bps-proxy.js`,
// just pointed at NOAA instead of BPS.
//
// Auth: shared-secret header keeps randoms from burning our
// 100k/day Workers quota AND from turning this URL into a free
// public NOAA scraper. Set PROXY_SECRET in Workers → Settings →
// Variables (as SECRET, NOT plaintext) to a long random string,
// and mirror the same string into the repo's ERDDAP_PROXY_SECRET
// GitHub secret.
//
// Upstream is env-var driven so we can flip between PFEG / OSMC /
// any future NOAA ERDDAP mirror without a redeploy. Set
// UPSTREAM_BASE in Workers → Settings → Variables (plaintext OK)
// to whichever ERDDAP host actually serves TAO right now. Sane
// default below points at PFEG which historically mirrored PMEL.

const DEFAULT_UPSTREAM = "https://coastwatch.pfeg.noaa.gov/erddap/tabledap";

export default {
  async fetch(request, env) {
    // GETs only — ERDDAP is read-only and we don't want to act as
    // a write proxy by accident.
    if (request.method !== "GET") {
      return new Response("GET only", {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Shared-secret auth. Without it the worker URL would be a
    // public NOAA scraper anyone could exhaust.
    const providedSecret = request.headers.get("x-proxy-secret");
    if (!env.PROXY_SECRET || providedSecret !== env.PROXY_SECRET) {
      return new Response("unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Forward whatever path + query string the GHA scraper sent.
    // E.g. incoming  GET /pmelTaoMonT.json?time,latitude...
    //      → outbound  GET <UPSTREAM>/pmelTaoMonT.json?time,latitude...
    const url = new URL(request.url);
    const upstreamBase = env.UPSTREAM_BASE || DEFAULT_UPSTREAM;
    const targetUrl = `${upstreamBase.replace(/\/$/, "")}${url.pathname}${url.search}`;

    // Spoof a real browser User-Agent. Some ERDDAP installs filter
    // out empty / generic fetch agents on top of the IP blacklist.
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept":     request.headers.get("accept") ?? "application/json, text/csv, */*",
        },
      });
    } catch (err) {
      return new Response(`upstream fetch error: ${err.message}`, {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Pipe ERDDAP's response back unchanged — preserves the
    // content-type (JSON / CSV / .ocean) so the Python parser
    // sees exactly what NOAA sent. CORS header lets a frontend
    // re-use the same proxy if we ever want to fetch live from
    // the browser instead of pre-baking JSON into static assets.
    const body = await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(body, { status: upstream.status, headers });
  },
};
