import re
from datetime import date

from bs4 import BeautifulSoup


def _today() -> str:
    return date.today().isoformat()
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
        "title": f"Vietnam Robusta – {_today()}",
        "body": f"Vietnam Robusta price: {formatted} VND/kg",
        "source": "Giacaphe",
        "category": "supply",
        "lat": _LAT,
        "lng": _LNG,
        "tags": ["price", "robusta", "vietnam"],
        # Structured price for the exporter — avoids re-parsing `body`.
        "price_data": {"symbol": "VN_FAQ", "price": float(price_vnd),
                       "currency": "VND", "unit": "per_kg"},
    }


async def run(page) -> list[dict]:
    # giacaphe.com sits behind a Cloudflare JS challenge as of 2026-04-16.
    # playwright + playwright-stealth was confirmed rejected (cf_passed=False
    # even after a 30s patient-wait — see PR #35). Patchright is a Playwright
    # fork that patches the runtime fingerprint leaks CF uses to detect
    # headless browsers (cdc_ properties, runtime.enable leaks, navigator.webdriver
    # bypass holes, etc.) — strictly more evasion than playwright-stealth.
    #
    # We launch patchright as a separate process inside this scraper rather than
    # switching the global Playwright runtime, to keep blast radius minimal.
    # If patchright is unavailable in the environment, we fall back to the
    # original Playwright path (which will surface the CF failure via the
    # loud-logging dump below — better than crashing the whole daily run).
    try:
        from patchright.async_api import async_playwright as patchright_pw
        use_patchright = True
    except ImportError as e:
        print(f"[vietnam] patchright unavailable, falling back to playwright-stealth: {e}")
        use_patchright = False

    if use_patchright:
        async with patchright_pw() as pw:
            browser = await pw.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                locale="vi-VN",
            )
            vn_page = await context.new_page()
            try:
                return await _scrape(vn_page, runtime="patchright")
            finally:
                await browser.close()

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
        return await _scrape(vn_page, runtime="playwright-stealth")
    finally:
        await context.close()


async def _scrape(vn_page, *, runtime: str) -> list[dict]:
    try:
        await vn_page.goto(_URL, wait_until="domcontentloaded", timeout=30000)

        # CF challenge title localized per the Accept-Language we send (vi-VN).
        cf_titles = ("Chờ một chút", "Just a moment", "Un momento", "Un instant")
        cf_waited_ms = 0
        max_cf_wait_ms = 30000
        poll_ms = 1000
        cf_initial_title = await vn_page.title()
        cf_detected = any(t in (cf_initial_title or "") for t in cf_titles)
        while cf_waited_ms < max_cf_wait_ms:
            current = await vn_page.title()
            if not any(t in (current or "") for t in cf_titles):
                break
            await vn_page.wait_for_timeout(poll_ms)
            cf_waited_ms += poll_ms
        cf_final_title = await vn_page.title()
        cf_passed = not any(t in (cf_final_title or "") for t in cf_titles)
        if cf_detected:
            print(
                f"[vietnam] CF challenge detected via {runtime} "
                f"(title={cf_initial_title!r}); "
                f"waited {cf_waited_ms/1000:.1f}s, passed={cf_passed} "
                f"(final title={cf_final_title!r})"
            )

        selector_found = True
        try:
            await vn_page.wait_for_selector("._trung-binh-gia", timeout=15000)
        except Exception:
            selector_found = False
            await vn_page.wait_for_timeout(8000)
        html = await vn_page.content()
        item = parse_giacaphe_price(html)
        if item:
            return [item]

        page_len = len(html or "")
        title    = await vn_page.title()
        has_avg  = '_trung-binh-gia' in html
        has_tbl  = '<table' in html
        snippet  = (html[:400] if html else "").replace("\n", " ")
        print(
            f"[vietnam] PARSE FAILED via {runtime} — selector_found={selector_found} "
            f"page_title={title!r} html_len={page_len} "
            f"has_avg_class={has_avg} has_table={has_tbl} "
            f"cf_detected={cf_detected} cf_passed={cf_passed}"
        )
        print(f"[vietnam] HTML head: {snippet!r}")
        return []
    except Exception as e:
        print(f"[vietnam] {_URL} failed via {runtime}: {e}")
        return []
