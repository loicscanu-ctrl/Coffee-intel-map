// BPS Indonesia exim — Cloudflare Worker proxy.
//
// Why: Cloudflare on lampung.bps.go.id rejects every datacenter-IP
// request that doesn't pass Turnstile. From a Cloudflare Worker, the
// outbound fetch originates inside Cloudflare's own edge network —
// since BPS is also behind CF, the request is treated as intra-CF
// traffic and (usually) waves through without challenge. Result:
// a free, automated path to BPS that works from CI.
//
// Caveat: some CF customers can enable "Bot Fight Mode" or origin
// rules that distrust Workers traffic. We don't know if BPS does until
// we try. ~60% odds this works for them; the smoke test tells us.
//
// Auth: a shared-secret header keeps randoms from burning our 100k/day
// quota. Set PROXY_SECRET in Workers → Settings → Variables → Add
// (as a SECRET, not plaintext) to a long random string, and mirror the
// same string into the repo's BPS_WORKER_SECRET GitHub secret.

const BPS_TARGET = "https://lampung.bps.go.id/en/exim";

export default {
  async fetch(request, env) {
    // Only POSTs (the scraper sends BPS's Server Action body).
    if (request.method !== "POST") {
      return new Response("POST only", {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Shared-secret auth. Without it the worker URL would be a public
    // BPS scraper anyone could exhaust.
    const providedSecret = request.headers.get("x-proxy-secret");
    if (!env.PROXY_SECRET || providedSecret !== env.PROXY_SECRET) {
      return new Response("unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Forward to BPS with the headers BPS's Next.js Server Action needs.
    // Fall through to safe defaults so the worker is resilient if the
    // scraper ever drops one of them.
    let upstream;
    try {
      upstream = await fetch(BPS_TARGET, {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") ?? "text/plain;charset=UTF-8",
          "Accept":       request.headers.get("accept")       ?? "text/x-component",
          "Next-Action":  request.headers.get("next-action")  ?? "",
        },
        body: await request.text(),
      });
    } catch (err) {
      return new Response(`upstream fetch error: ${err.message}`, {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Pipe BPS's response back unchanged. Status + body, but force the
    // Content-Type so the scraper's RSC parser doesn't trip on whatever
    // CF normalises it to.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "text/x-component" },
    });
  },
};
