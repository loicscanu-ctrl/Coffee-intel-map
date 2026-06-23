# Cloudflare Worker proxies

Small reverse-proxy workers that let our GitHub Actions scrapers reach data
sources whose WAF/anti-bot blacklists Microsoft Azure / GitHub egress IPs.
Cloudflare edge IPs aren't on those blacklists — outbound `fetch()` from
inside a Worker presents as standard CF traffic and waves through.

| Worker | Routes to | Used by |
|---|---|---|
| `bps-proxy.js` | `lampung.bps.go.id` (Indonesia BPS exim) | `scraper-bps-indonesia-exim.yml` |
| `erddap-proxy.js` | NOAA ERDDAP (PFEG / OSMC, env-configurable) | `scraper-enso-thermocline.yml` |

Both follow the same shape: shared-secret header auth (so the worker URL
can't become a free public scraper), an explicit upstream target, and a
straight pipe-through of the response body. ~50 LOC each.

## Deploying `erddap-proxy.js`

One-time setup. ~10 minutes if you've never used Workers; ~3 minutes if you have.

### 1. Create the worker

```sh
# From the repo root (no separate dir needed)
npx wrangler@latest deploy cf-worker/erddap-proxy.js \
    --name erddap-proxy \
    --compatibility-date 2024-01-01
```

Wrangler will prompt for Cloudflare login the first run. The worker lands at
`https://erddap-proxy.<your-cf-account>.workers.dev`.

### 2. Set the secret + upstream

In the Cloudflare dashboard → Workers & Pages → `erddap-proxy` → Settings → Variables:

| Name | Type | Value |
|---|---|---|
| `PROXY_SECRET` | **Secret** (encrypted) | A long random string. Mirror this into the repo secret below. |
| `UPSTREAM_BASE` | Plaintext | `https://coastwatch.pfeg.noaa.gov/erddap/tabledap` (default), or `https://osmc.noaa.gov/erddap/tabledap` if PFEG doesn't have the dataset you need. Editable any time, no redeploy. |

Generate the secret with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

### 3. Wire into the repo

GitHub → repo Settings → Secrets and variables → Actions:

| Name | Where | Value |
|---|---|---|
| `ERDDAP_PROXY_BASE` | **Variables** | `https://erddap-proxy.<your-cf-account>.workers.dev` |
| `ERDDAP_PROXY_SECRET` | **Secrets** | Same long random string from step 2 |

The `scraper-enso-thermocline.yml` workflow reads both and passes them to the
Python fetcher as env vars. Without them set, the fetcher exits cleanly with a
"proxy not configured" message — no crash, no Telegram spam.

### 4. Verify

Trigger the workflow manually with `dry_run=true, diag=true` and read the
log. You should see `[therm] fetched OK via proxy: …` and per-buoy obs counts.
If you see `proxy returned HTTP 401`, the secrets are mismatched. If you see
404s, the dataset ID isn't on the upstream — flip `UPSTREAM_BASE` in CF to
OSMC or run `<proxy>/info/index.csv?searchFor=tao` (with the secret header)
to discover what dataset IDs the upstream actually carries.

## Why a secret on a read-only proxy?

Without it, anyone who finds the worker URL can use it as an unauthenticated
NOAA scraper. Cloudflare Workers free tier is 100,000 requests/day; one bot
discovers it and we burn through that overnight, then either Phase 3 stops
working or we get a paid-tier bill. The secret keeps it boring.
