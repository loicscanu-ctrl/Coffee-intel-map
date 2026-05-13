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


def _today() -> str:
    return date.today().isoformat()
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
    but column order and cell tag (td/th) varies — we try several strategies
    so a layout tweak on cepea.org.br doesn't silently empty the result.
    Returns (None, None) if not found.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Strategy 1: table rows — accept any column ordering. Scan every cell
    # for a date AND a BRL price; pair them if both appear in the same row.
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

    # Strategy 3: scrape entire body text. Find the most recent date in the
    # page and the BRL price nearest to it by character offset. Cheap last
    # resort when the table markup has changed but the values are still
    # printed somewhere in the rendered DOM.
    body_text = soup.get_text(" ", strip=True)
    date_hits = [(m.start(), m.group(1)) for m in _DATE_RE.finditer(body_text)]
    price_hits = [(m.start(), m.group(1)) for m in _BRL_RE.finditer(body_text)]
    if date_hits and price_hits:
        # Use the latest-occurring date that has at least one price within
        # 200 chars of it — typical "indicator" rows have price next to date.
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

        # Wait for the price table to actually populate (JS renders after load)
        try:
            await pg.wait_for_function(
                "() => /\\d{1,3}(?:\\.\\d{3})*,\\d{2}/.test(document.body.innerText)",
                timeout=20000,
            )
        except Exception:
            await pg.wait_for_timeout(5000)

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
                            # Wait for price to re-render after product switch
                            try:
                                await pg.wait_for_function(
                                    "() => /\\d{1,3}(?:\\.\\d{3})*,\\d{2}/.test(document.body.innerText)",
                                    timeout=10000,
                                )
                            except Exception:
                                await pg.wait_for_timeout(3000)
                            switched = True
                            break
                if switched:
                    break

            if not switched:
                # Fallback: try numbered variant URL
                await pg.goto(_URL.replace(".aspx", "/2.aspx"), wait_until="networkidle", timeout=30000)
                try:
                    await pg.wait_for_function(
                        "() => /\\d{1,3}(?:\\.\\d{3})*,\\d{2}/.test(document.body.innerText)",
                        timeout=10000,
                    )
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
