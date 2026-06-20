"""
Diagnostic probe: where does IHCAFE publish the Honduras average export price?

Newspapers (El Heraldo, La Prensa, La Tribuna) all quote IHCAFE's "precio
promedio de exportación por saco de 46 kilogramos" — a genuine Honduras export
price (NY 'C' + country differential), updated through the harvest. We need to
find the live source on ihcafe.hn so we can scrape it weekly.

This probe renders the IHCAFE homepage and /exportaciones/ page in Chromium,
captures every XHR/admin-ajax response body, and dumps the full visible text +
every price-like number with context — so we can see exactly where and how the
per-46kg-sack price is published.

Pure diagnostic — no DB, no commits. Run via the "Probe: IHCAFE" workflow.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

DEBUG = Path("debug/ihcafe_probe")
DEBUG.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

URLS = [
    "https://ihcafe.hn/",
    "https://ihcafe.hn/exportaciones/",
    "https://ihcafe.hn/precios/",
    "https://ihcafe.hn/comercializacion-de-cafe/",
]

# Keywords that mark a line as worth a closer look.
PRICE_HINT = re.compile(
    r"(saco|46|export|precio|referencia|diferencial|quintal|qq|US\$|L\.|lempira|promedio)",
    re.I,
)


async def render(page, url: str, captured: list) -> None:
    print(f"\n{'=' * 70}\n[probe] {url}\n{'=' * 70}")
    try:
        await page.goto(url, wait_until="networkidle", timeout=45_000)
    except Exception as e:  # noqa: BLE001
        print(f"[probe] goto error: {type(e).__name__}: {e}")
    await page.wait_for_timeout(4_000)

    try:
        html = await page.content()
    except Exception as e:  # noqa: BLE001
        print(f"[probe] content error: {e}")
        return

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    fn = re.sub(r"[^0-9a-zA-Z]+", "_", url).strip("_")[:48] or "root"
    (DEBUG / f"{fn}.html").write_text(html, encoding="utf-8")

    text = soup.get_text("\n", strip=True)
    print(f"\n--- lines mentioning price/saco/export ({len(text)} chars total) ---")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for i, ln in enumerate(lines):
        if PRICE_HINT.search(ln) and (re.search(r"\d", ln) or len(ln) < 60):
            # print the hit plus a little surrounding context
            print(f"   {ln[:160]}")

    # Every price-like number with context.
    nums = list(re.finditer(r"(?:US?\$|L\.?)?\s?\d[\d,]*\.\d{2}", text))
    print(f"\n--- {len(nums)} price-like numbers (showing up to 30) ---")
    for m in nums[:30]:
        s = m.start()
        ctx = text[max(0, s - 60):s].replace("\n", " ")
        print(f"   {m.group()!r}  ⟵  {ctx!r}")

    # Links that might lead to a price page / bulletin.
    print("\n--- candidate links ---")
    for a in soup.find_all("a", href=True):
        h = a["href"]
        txt = a.get_text(" ", strip=True)[:60]
        if re.search(r"(precio|export|comercial|boletin|mdocs|\.pdf)", (h + " " + txt), re.I):
            print(f"   {h}   «{txt}»")


async def main() -> None:
    from playwright.async_api import async_playwright

    captured: list = []

    async def _grab(resp) -> None:
        u = resp.url
        if "admin-ajax" in u or "/wp-json/" in u or "api" in u.lower():
            try:
                body = await resp.text()
            except Exception:  # noqa: BLE001
                return
            if body and any(k in body.lower() for k in ("precio", "saco", "export", "46")):
                captured.append((resp.status, u, body))

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="es-HN")
        page = await ctx.new_page()
        page.on("response", lambda r: asyncio.create_task(_grab(r)))

        for url in URLS:
            await render(page, url, captured)

        await ctx.close()
        await browser.close()

    print(f"\n{'=' * 70}\n=== XHR/api responses with price keywords: {len(captured)} ===")
    for i, (status, url, body) in enumerate(captured):
        (DEBUG / f"xhr_{i}.txt").write_text(body, encoding="utf-8")
        print(f"\n[xhr {i}] HTTP {status}  {url}")
        print(body[:1500])


if __name__ == "__main__":
    asyncio.run(main())
