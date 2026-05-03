import re
from datetime import date

from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = 14.058, 108.277
_URL = "https://giacaphe.com/gia-ca-phe-noi-dia/"

# VND price pattern: e.g. "115.200" or "115,200" (period = thousand sep in Vietnamese)
_VND = re.compile(r"\b([0-9]{2,3}[.,][0-9]{3})\b")


def _normalise(raw: str) -> int:
    """Convert Vietnamese number strings like '115.200' or '115,200' to int."""
    return int(raw.replace(".", "").replace(",", ""))


def parse_giacaphe_price(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    # Strategy 1: target the dedicated average-price element directly
    el = soup.find(class_="_trung-binh-gia")
    if el:
        # Use only the direct text node to avoid "92,700đ/kg" word-boundary issues
        direct_text = next((t for t in el.strings if t.strip()), el.get_text())
        m = re.search(r"([0-9]{2,3}[.,][0-9]{3})", direct_text.strip())
        if m:
            price = _normalise(m.group(1))
            if 50_000 <= price <= 250_000:
                return _make_item(price)

    # Strategy 2: find 'trung bình' label inside a table row
    for el in soup.find_all(string=re.compile(r"trung.?b[iì]nh", re.I)):
        row = el.find_parent("tr")
        if not row:
            continue
        for td in row.find_all("td"):
            m = _VND.search(td.get_text(strip=True))
            if m:
                price = _normalise(m.group(1))
                if 50_000 <= price <= 250_000:
                    return _make_item(price)

    # Strategy 3: collect prices from first table only (avoids historical data)
    first_table = soup.find("table")
    if first_table:
        prices = []
        for td in first_table.find_all("td"):
            m = _VND.search(td.get_text(strip=True))
            if m:
                val = _normalise(m.group(1))
                if 50_000 <= val <= 250_000:
                    prices.append(val)
        if prices:
            prices.sort()
            return _make_item(prices[len(prices) // 2])

    return None


def _make_item(price_vnd: int) -> dict:
    formatted = f"{price_vnd:,}".replace(",", ".")   # 115200 → "115.200"
    return {
        "title": f"Vietnam Robusta – {_TODAY()}",
        "body": f"Vietnam Robusta price: {formatted} VND/kg",
        "source": "Giacaphe",
        "category": "supply",
        "lat": _LAT,
        "lng": _LNG,
        "tags": ["price", "robusta", "vietnam"],
    }


async def run(page) -> list[dict]:
    # Create a dedicated context with proper UA/locale to bypass Cloudflare
    browser = page.context.browser
    context = await browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale="vi-VN",
    )
    vn_page = await context.new_page()
    try:
        from playwright_stealth import Stealth
        await Stealth().apply_stealth_async(vn_page)
    except Exception as e:
        print(f"[vietnam] stealth init warning: {e}")

    try:
        await vn_page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
        try:
            await vn_page.wait_for_selector("._trung-binh-gia", timeout=15000)
        except Exception:
            await vn_page.wait_for_timeout(8000)
        html = await vn_page.content()
        item = parse_giacaphe_price(html)
        return [item] if item else []
    except Exception as e:
        print(f"[vietnam] {_URL} failed: {e}")
        return []
    finally:
        await context.close()
