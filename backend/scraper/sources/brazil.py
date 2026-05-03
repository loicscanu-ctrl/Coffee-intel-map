import re
from datetime import date

from bs4 import BeautifulSoup

from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925

def parse_cooabriel(html: str) -> dict | None:
    """Extract Conilon 7 price from Cooabriel cotacao page via __NEXT_DATA__ JSON."""
    import json as _json

    # Strategy 1: parse __NEXT_DATA__ JSON (most reliable)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if m:
        try:
            data = _json.loads(m.group(1))
            ssp = data.get("props", {}).get("pageProps", {}).get("ssp", {})

            # Today's cotacoes (live prices)
            cotacoes_hoje = ssp.get("cotacoesCafe", {}).get("cotacoes", [])
            for entry in cotacoes_hoje:
                if re.search(r"conilon\s*7\b", entry.get("nomeCafe", ""), re.I):
                    price = entry.get("preco")
                    if price:
                        return _make_conilon_item(f"{price:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))

            # Fallback: latest entry from weekly history for Conilon 7
            for series in ssp.get("semanal", []):
                if re.search(r"conilon\s*7\b", series.get("nomeCafe", ""), re.I):
                    cotacoes = series.get("cotacoes", [])
                    if cotacoes:
                        price = cotacoes[-1].get("preco")
                        data_price = cotacoes[-1].get("data", "")
                        if price:
                            formatted = f"{price:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
                            return _make_conilon_item(formatted, date_label=data_price)
        except Exception:
            pass

    # Strategy 2: HTML table fallback
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.find_all(string=re.compile(r"tipo\s*7|conilon\s*7", re.I)):
        row = el.find_parent("tr")
        if not row:
            continue
        price = _extract_brl(row)
        if price:
            return _make_conilon_item(price)

    return None


def _extract_brl(row) -> str | None:
    """Find the first BRL-looking number in a table row."""
    for td in row.find_all("td"):
        result = _extract_brl_from_text(td.get_text(strip=True))
        if result:
            return result
    return None


def _extract_brl_from_text(text: str) -> str | None:
    """Extract a Brazilian R$ price string (e.g. '1.280,50' or 'R$ 1.280,50')."""
    # Brazilian format: 1.280,50 or 1280,50 or R$ 1.280,50
    m = re.search(r"R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d{3,},\d{2})", text)
    if m:
        return m.group(1)
    return None


def _make_conilon_item(price_brl: str, date_label: str = "") -> dict:
    label = f" ({date_label})" if date_label else ""
    return {
        "title": f"Conilon Tipo 7 (Cooabriel) – {_TODAY()}",
        "body": f"Conilon Tipo 7 price: R$ {price_brl}/saca{label}",
        "source": "Cooabriel",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "brazil", "conilon"],
    }

def parse_noticiasagricolas(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"cotacao|valor|price", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Brazil Arabica Price (Noticiasagricolas) – {_TODAY()}",
        "body": translate_to_english(f"Arabica coffee price: {text}", "pt"),
        "source": "Noticiasagricolas",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "brazil", "arabica"],
    }

def parse_cecafe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        return None
    rows = tables[0].find_all("tr")
    if len(rows) < 2:
        return None
    cells = rows[1].find_all("td")
    if not cells:
        return None
    text = " | ".join(c.get_text(strip=True) for c in cells[:4])
    return {
        "title": f"Brazil Coffee Exports (Cecafe) – {_TODAY()}",
        "body": translate_to_english(f"Brazil coffee export data: {text}", "pt"),
        "source": "Cecafe",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["exports", "brazil"],
    }

async def _fetch_with_proxy(browser, url: str, proxy_ip: str) -> str:
    """Fetch a URL using a specific HTTP proxy."""
    from playwright_stealth import Stealth
    context = await browser.new_context(
        proxy={"server": f"http://{proxy_ip}"},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale="pt-BR",
    )
    pg = await context.new_page()
    try:
        await Stealth().apply_stealth_async(pg)
        await pg.goto(url, wait_until="domcontentloaded", timeout=20000)
        await pg.wait_for_timeout(3000)
        return await pg.content()
    finally:
        await context.close()


def _get_br_proxies() -> list[str]:
    import urllib.request
    try:
        api = "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=BR&ssl=all&anonymity=all"
        with urllib.request.urlopen(api, timeout=10) as r:
            return [p.strip() for p in r.read().decode().strip().split() if p.strip()][:10]
    except Exception as e:
        print(f"[brazil] proxy list fetch failed: {e}")
        return []


async def _fetch_cooabriel(browser, url: str) -> str | None:
    """Try direct fetch first, fall back to Brazilian proxies if geo-blocked."""
    from playwright_stealth import Stealth
    # Try direct
    try:
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            locale="pt-BR",
        )
        pg = await context.new_page()
        await Stealth().apply_stealth_async(pg)
        await pg.goto(url, wait_until="domcontentloaded", timeout=20000)
        await pg.wait_for_timeout(3000)
        html = await pg.content()
        await context.close()
        if len(html) > 10000 and "blocked" not in html.lower():
            return html
    except Exception:
        pass

    # Geo-blocked — try Brazilian proxies
    print("[brazil] direct fetch blocked, trying BR proxies...")
    for proxy in _get_br_proxies():
        try:
            html = await _fetch_with_proxy(browser, url, proxy)
            if len(html) > 10000 and "blocked" not in html.lower():
                print(f"[brazil] proxy {proxy} worked")
                return html
        except Exception:
            continue
    return None


async def run(page) -> list[dict]:
    results = []
    browser = page.context.browser

    # Cooabriel — needs proxy from geo-restricted regions
    try:
        html = await _fetch_cooabriel(browser, "https://cooabriel.coop.br/cotacao-do-dia")
        if html:
            item = parse_cooabriel(html)
            if item:
                results.append(item)
        else:
            print("[brazil] cooabriel: could not fetch (all proxies failed)")
    except Exception as e:
        print(f"[brazil] cooabriel failed: {e}")

    # Other sources via shared page
    for url, parser in [
        ("https://www.noticiasagricolas.com.br/cotacoes/cafe", parse_noticiasagricolas),
        ("https://www.cecafe.com.br/", parse_cecafe),
    ]:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[brazil] {url} failed: {e}")
    return results
