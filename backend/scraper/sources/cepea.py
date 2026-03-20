# backend/scraper/sources/cepea.py
#
# Fetches the CEPEA/ESALQ Arabica and Conilon (Robusta) coffee price indicators.
# Source: https://www.cepea.org.br/en/indicator/coffee.aspx
#
# The site blocks plain HTTP (403), so we use Playwright stealth.
# Both indicators live on the same page — the page renders a JS-driven table
# for Arabica by default; we then select Conilon via the product dropdown.

import re
from datetime import date
from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925  # Brazil centre

_URL = "https://www.cepea.org.br/en/indicator/coffee.aspx"

# Brazilian number format: 1.180,25  or  1180,25
_BRL_RE = re.compile(r"(\d{1,3}(?:\.\d{3})*,\d{2})")
_DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{4})")


def _extract_brl(text: str) -> str | None:
    m = _BRL_RE.search(text)
    return m.group(1) if m else None


def _parse_price_table(html: str) -> tuple[str | None, str | None]:
    """
    Return (price_brl, date_str) from the first data row of the price table.
    CEPEA tables typically have columns: Date | Cash R$ | Var R$ | Var %
    Returns (None, None) if not found.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Strategy 1: table with id containing "table" or "dados"
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            date_text  = cells[0].get_text(strip=True)
            price_text = cells[1].get_text(strip=True)
            price = _extract_brl(price_text)
            dm    = _DATE_RE.match(date_text)
            if price and dm:
                return price, date_text

    # Strategy 2: any element containing a BRL price near a date
    for el in soup.find_all(string=_DATE_RE):
        parent = el.find_parent()
        if not parent:
            continue
        # Look for a sibling with a price
        siblings = list(parent.find_next_siblings())
        for sib in siblings[:3]:
            price = _extract_brl(sib.get_text(strip=True))
            if price:
                dm = _DATE_RE.search(str(el))
                return price, dm.group(1) if dm else ""

    return None, None


def _make_item(name: str, price: str, date_str: str, tags: list[str]) -> dict:
    label = f" ({date_str})" if date_str else ""
    return {
        "title": f"CEPEA {name} – {_TODAY()}",
        "body": f"CEPEA {name} price: R$ {price}/sack{label}",
        "source": "CEPEA/ESALQ",
        "category": "supply",
        "lat": _LAT,
        "lng": _LNG,
        "tags": tags,
    }


async def _fetch_page(browser, select_conilon: bool = False) -> str | None:
    """
    Fetch the CEPEA coffee indicator page with Playwright stealth.
    If select_conilon=True, try to switch the product selector to Conilon
    before capturing the HTML.
    """
    try:
        from playwright_stealth import Stealth
    except ImportError:
        Stealth = None

    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        locale="pt-BR",
    )
    pg = await context.new_page()
    try:
        if Stealth:
            await Stealth().apply_stealth_async(pg)

        await pg.goto(_URL, wait_until="networkidle", timeout=40000)
        # Wait for the price table to appear
        try:
            await pg.wait_for_selector("table", timeout=15000)
        except Exception:
            await pg.wait_for_timeout(8000)

        if select_conilon:
            # Try to find a <select> containing "conilon" / "robusta" option
            # and choose it, then wait for the table to refresh.
            switched = False
            selects = await pg.query_selector_all("select")
            for sel in selects:
                options = await sel.query_selector_all("option")
                for opt in options:
                    label = (await opt.inner_text()).lower()
                    if "conilon" in label or "robusta" in label:
                        value = await opt.get_attribute("value")
                        if value:
                            await sel.select_option(value=value)
                            await pg.wait_for_timeout(3000)
                            switched = True
                            break
                if switched:
                    break

            if not switched:
                # Fallback: try numbered variant URL
                await pg.goto(_URL.replace(".aspx", "/2.aspx"), wait_until="networkidle", timeout=30000)
                try:
                    await pg.wait_for_selector("table", timeout=10000)
                except Exception:
                    await pg.wait_for_timeout(5000)

        return await pg.content()

    except Exception as e:
        print(f"[cepea] fetch failed (conilon={select_conilon}): {e}")
        return None
    finally:
        await context.close()


async def run(page) -> list[dict]:
    browser = page.context.browser
    results = []

    # ── Arabica ───────────────────────────────────────────────────────────────
    try:
        html = await _fetch_page(browser, select_conilon=False)
        if html:
            price, date_str = _parse_price_table(html)
            if price:
                results.append(_make_item(
                    "Arabica", price, date_str or "",
                    ["price", "brazil", "arabica", "cepea"],
                ))
                print(f"[cepea] arabica: R$ {price}/sack ({date_str})")
            else:
                print("[cepea] arabica: page loaded but price not found in table")
        else:
            print("[cepea] arabica: fetch returned no HTML")
    except Exception as e:
        print(f"[cepea] arabica failed: {e}")

    # ── Conilon (Robusta) ─────────────────────────────────────────────────────
    try:
        html = await _fetch_page(browser, select_conilon=True)
        if html:
            price, date_str = _parse_price_table(html)
            if price:
                results.append(_make_item(
                    "Conilon (Robusta)", price, date_str or "",
                    ["price", "brazil", "robusta", "cepea"],
                ))
                print(f"[cepea] conilon: R$ {price}/sack ({date_str})")
            else:
                print("[cepea] conilon: page loaded but price not found in table")
        else:
            print("[cepea] conilon: fetch returned no HTML")
    except Exception as e:
        print(f"[cepea] conilon failed: {e}")

    return results
