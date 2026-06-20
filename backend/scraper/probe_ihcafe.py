"""
Diagnostic probe (discovery via Wayback CDX): validate the discovery path the
real scraper will use.

Hard constraints proven across runs #1-7:
  * Every IHCAFE HTML listing page is Cloudflare-Turnstile-blocked in headless CI
    (HTTP 403 "Verificación de seguridad en curso"); only the homepage clears.
  * The WP REST API is locked (401).
  * Static /wp-content/uploads/*.pdf assets GET fine (200) and parse — they carry
    "El precio promedio de exportación por saco de 46kg ... es de $NNN.NN".

So: discover the bulletin filename from the Wayback Machine CDX index (not
Cloudflare-gated), then fetch the LIVE pdf (newest-first date-probe forward from
the newest archived date), falling back to the Wayback snapshot if the live file
isn't reachable. This probe runs that whole chain and prints the parsed price.
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

CDX = "https://web.archive.org/cdx/search/cdx"
PRICE_RE = re.compile(r"saco de 46\s*kg.*?es de\s*\$?\s*([\d][\d.,]*)", re.I | re.S)


def cdx_query() -> list[tuple[str, str]]:
    """Return [(timestamp, original_url)] for archived IHCAFE comercializacion PDFs."""
    out: list[tuple[str, str]] = []
    for host in ("ihcafe.hn/wp-content/uploads*", "www.ihcafe.hn/wp-content/uploads*"):
        url = (f"{CDX}?url={host}&matchType=prefix&output=json&collapse=urlkey"
               f"&limit=500&filter=original:.*[Cc]omercializ.*")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                rows = json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            print(f"[cdx] {host} failed: {type(e).__name__}: {e}")
            continue
        for row in rows[1:]:  # row[0] is the header
            ts, original = row[1], row[2]
            if original.lower().endswith(".pdf"):
                out.append((ts, original))
        print(f"[cdx] {host}: {len(rows)-1 if rows else 0} rows")
    # de-dup by original, keep newest timestamp
    best: dict[str, str] = {}
    for ts, original in out:
        if original not in best or ts > best[original]:
            best[original] = ts
    return sorted(((ts, u) for u, ts in best.items()), reverse=True)


def filedate(url: str):
    m = re.search(r"(\d{2})-(\d{2})-(\d{4})", url)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


async def parse_price(page, label: str, url: str) -> bool:
    import pdfplumber
    try:
        resp = await page.request.get(url, timeout=40_000)
        body = await resp.body()
        if resp.status != 200 or body[:4] != b"%PDF":
            print(f"   [{label}] HTTP {resp.status} not-pdf {url}")
            return False
        with pdfplumber.open(io.BytesIO(body)) as pdf:
            text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        flat = re.sub(r"\s+", " ", text)
        m = PRICE_RE.search(flat)
        print(f"   [{label}] HTTP 200 PDF {len(body)}B  →  price match: {m.group(1) if m else None}   {url}")
        if not m:
            for ln in text.splitlines():
                if "46" in ln and re.search(r"\$|precio|promedio", ln, re.I):
                    print(f"        · {ln.strip()[:140]}")
        return bool(m)
    except Exception as e:  # noqa: BLE001
        print(f"   [{label}] error {type(e).__name__}: {e}  {url}")
        return False


async def main() -> None:
    from playwright.async_api import async_playwright

    archived = cdx_query()
    print(f"\n[cdx] {len(archived)} unique archived bulletin PDFs")
    for ts, u in archived[:12]:
        print(f"   {ts}  {u}")
    if not archived:
        print("[probe] no archived bulletins found — Wayback discovery unavailable")
        return

    # newest archived bulletin → infer live URL + naming convention
    newest_ts, newest_url = archived[0]
    live_url = newest_url
    if live_url.startswith("http://"):
        live_url = "https://" + live_url[len("http://"):]
    if "://ihcafe.hn" in live_url:
        live_url = live_url.replace("://ihcafe.hn", "://www.ihcafe.hn")
    print(f"\n[probe] newest archived: {newest_ts}  {newest_url}")
    print(f"[probe] derived live url: {live_url}")
    nd = filedate(newest_url)
    print(f"[probe] newest filename date: {nd}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        try:
            await page.goto("https://www.ihcafe.hn/", wait_until="domcontentloaded", timeout=40_000)
            await page.wait_for_timeout(4_000)
        except Exception as e:  # noqa: BLE001
            print(f"[warmup] {type(e).__name__}")

        # 1) try the newest archived bulletin from the LIVE site
        await parse_price(page, "live-newest", live_url)

        # 2) date-probe the LIVE site forward from newest archived date → today,
        #    reusing the newest filename's stem pattern (swap the date).
        if nd:
            stem_tmpl = re.sub(r"\d{2}-\d{2}-\d{4}", "{D}", live_url)
            print(f"\n[probe] live date-probe forward, template: {stem_tmpl}")
            hit = None
            for delta in range((date.today() - nd).days + 1):
                d = date.today() - timedelta(days=delta)
                if d < nd:
                    break
                cand = stem_tmpl.replace("{D}", f"{d.day:02d}-{d.month:02d}-{d.year}")
                try:
                    resp = await page.request.get(cand, timeout=15_000)
                    if resp.status == 200 and (await resp.body())[:4] == b"%PDF":
                        print(f"   LIVE HIT {cand}")
                        hit = cand
                        break
                except Exception:  # noqa: BLE001
                    pass
            if hit and hit != live_url:
                await parse_price(page, "live-latest", hit)

        # 3) fallback: parse straight from the Wayback snapshot (id_ = raw file)
        snap = f"https://web.archive.org/web/{newest_ts}id_/{newest_url}"
        await parse_price(page, "wayback-snap", snap)

        await ctx.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
