# backend/scraper/sources/cepea.py
#
# Fetches the CEPEA/ESALQ Arabica and Conilon (Robusta) coffee price indicators.
#
# CEPEA's own site (cepea.org.br) is hard-walled by Cloudflare from CI — plain
# HTTP is 403 and headless Playwright only ever gets the "verificação de
# segurança" challenge page (confirmed by the probe-cepea diagnostic). So we read
# the SAME CEPEA/ESALQ indicators from noticiasagricolas.com.br, which republishes
# them ("Fonte: Cepea/Esalq") on dedicated pages served over plain HTTP with a
# clean `Data | Valor R$ | Variação` table. The old Playwright path against CEPEA
# is kept only as a last-ditch fallback.

import asyncio
import re
import urllib.request
from datetime import date

from bs4 import BeautifulSoup


def _today() -> str:
    return date.today().isoformat()
_LAT, _LNG = -14.235, -51.925  # Brazil centre

# noticiasagricolas dedicated CEPEA/ESALQ indicator pages (plain HTTP, CI-reachable).
_NA_ARABICA = "https://www.noticiasagricolas.com.br/cotacoes/cafe/indicador-cepea-esalq-cafe-arabica"
_NA_CONILON = "https://www.noticiasagricolas.com.br/cotacoes/cafe/indicador-cepea-esalq-cafe-conillon"

# CEPEA's own page — Cloudflare-walled; used only as a last-ditch fallback.
_URL = "https://www.cepea.org.br/en/indicator/coffee.aspx"

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# Brazilian number format: 1.728,97  or  1180,25
_BRL_RE = re.compile(r"(\d{1,3}(?:\.\d{3})*,\d{2})")
_DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{4})")


def _extract_brl(text: str) -> str | None:
    m = _BRL_RE.search(text)
    return m.group(1) if m else None


def _http_get(url: str, timeout: int = 30) -> str | None:
    """Plain HTTP GET with a browser UA. Returns decoded body or None."""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": _UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"[cepea] GET {url} failed: {type(e).__name__}: {e}")
        return None


def _parse_indicator(html: str) -> tuple[str | None, str | None]:
    """Parse the noticiasagricolas indicator page → (price_brl, date_str).

    The indicator table's header is `Data | Valor R$ | Variação(%)`; the first
    data row is the latest close, e.g. `13/07/2026 | 1.728,97 | +0,38`. We target
    the table whose header mentions "Valor" so a sidebar cotação table can't be
    picked up by mistake, then read the first row that has both a date and a
    BRL price.
    """
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        headers = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        if "valor" not in headers:
            continue
        for row in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in row.find_all("td")]
            if len(cells) < 2:
                continue
            dm = _DATE_RE.search(cells[0])
            pm = _BRL_RE.search(" ".join(cells[1:]))
            if dm and pm:
                return pm.group(1), dm.group(1)
    return None, None


def _parse_price_table(html: str) -> tuple[str | None, str | None]:
    """
    Fallback parser (used on the CEPEA render). Return (price_brl, date_str)
    from the first table row that carries both a date and a BRL price, tolerant
    of column ordering. Returns (None, None) if not found.
    """
    soup = BeautifulSoup(html, "html.parser")

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            date_str: str | None = None
            price_str: str | None = None
            for cell in cells:
                text = cell.get_text(strip=True)
                if date_str is None:
                    dm = _DATE_RE.search(text)
                    if dm:
                        date_str = dm.group(1)
                if price_str is None:
                    p = _extract_brl(text)
                    if p:
                        price_str = p
                if date_str and price_str:
                    break
            if date_str and price_str:
                return price_str, date_str

    body_text = soup.get_text(" ", strip=True)
    date_hits = [(m.start(), m.group(1)) for m in _DATE_RE.finditer(body_text)]
    price_hits = [(m.start(), m.group(1)) for m in _BRL_RE.finditer(body_text)]
    if date_hits and price_hits:
        for dpos, dstr in sorted(date_hits, reverse=True):
            close_prices = [(abs(ppos - dpos), pstr) for ppos, pstr in price_hits
                            if abs(ppos - dpos) < 200]
            if close_prices:
                close_prices.sort()
                return close_prices[0][1], dstr

    return None, None


def _make_item(name: str, price: str, date_str: str, tags: list[str]) -> dict:
    label = f" ({date_str})" if date_str else ""
    return {
        "title": f"CEPEA {name} – {_today()}",
        "body": f"CEPEA {name} price: R$ {price}/sack{label}",
        "source": "CEPEA/ESALQ",
        "category": "supply",
        "lat": _LAT,
        "lng": _LNG,
        "tags": tags,
    }


async def _fetch_cepea_render(browser, select_conilon: bool = False) -> str | None:
    """Last-ditch fallback: render CEPEA's own (Cloudflare-walled) page."""
    try:
        from playwright_stealth import Stealth
    except ImportError:
        Stealth = None

    context = await browser.new_context(user_agent=_UA, locale="pt-BR")
    pg = await context.new_page()
    try:
        if Stealth:
            await Stealth().apply_stealth_async(pg)
        await pg.goto(_URL, wait_until="networkidle", timeout=40000)
        try:
            await pg.wait_for_function(
                "() => /\\d{1,3}(?:\\.\\d{3})*,\\d{2}/.test(document.body.innerText)",
                timeout=15000,
            )
        except Exception:
            await pg.wait_for_timeout(4000)
        if select_conilon:
            for sel in await pg.query_selector_all("select"):
                for opt in await sel.query_selector_all("option"):
                    label = (await opt.inner_text()).lower()
                    if "conilon" in label or "robusta" in label:
                        value = await opt.get_attribute("value")
                        if value:
                            await sel.select_option(value=value)
                            await pg.wait_for_timeout(3000)
                        break
        return await pg.content()
    except Exception as e:  # noqa: BLE001
        print(f"[cepea] CEPEA render fallback failed (conilon={select_conilon}): {e}")
        return None
    finally:
        await context.close()


async def run(page) -> list[dict]:
    results: list[dict] = []

    # ── Primary: noticiasagricolas republisher (plain HTTP) ───────────────────
    targets = [
        ("Arabica",            _NA_ARABICA, ["price", "brazil", "arabica", "cepea"]),
        ("Conilon (Robusta)",  _NA_CONILON, ["price", "brazil", "robusta", "cepea"]),
    ]
    for name, url, tags in targets:
        try:
            html = await asyncio.to_thread(_http_get, url)
            price, date_str = _parse_indicator(html) if html else (None, None)
            if price:
                results.append(_make_item(name, price, date_str or "", tags))
                print(f"[cepea] {name}: R$ {price}/sack ({date_str}) via noticiasagricolas")
            else:
                print(f"[cepea] {name}: noticiasagricolas price not found")
        except Exception as e:  # noqa: BLE001
            print(f"[cepea] {name} via noticiasagricolas failed: {e}")

    # ── Fallback: CEPEA's own render, only if the republisher gave us nothing ─
    if not results:
        try:
            browser = page.context.browser
            for name, conilon, tags in [
                ("Arabica",           False, ["price", "brazil", "arabica", "cepea"]),
                ("Conilon (Robusta)", True,  ["price", "brazil", "robusta", "cepea"]),
            ]:
                html = await _fetch_cepea_render(browser, select_conilon=conilon)
                price, date_str = _parse_price_table(html) if html else (None, None)
                if price:
                    results.append(_make_item(name, price, date_str or "", tags))
                    print(f"[cepea] {name}: R$ {price}/sack ({date_str}) via CEPEA render")
        except Exception as e:  # noqa: BLE001
            print(f"[cepea] CEPEA render fallback error: {e}")

    return results
