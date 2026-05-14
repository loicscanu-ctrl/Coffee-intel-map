"""
futures.py — Fetches ICE Arabica (KC) and ICE Robusta (RM) futures chain data
from Barchart, plus CFTC Disaggregated COT for Coffee C.
"""
import csv
import io
import json
import urllib.request
import zipfile
from datetime import date

from scraper.db import upsert_cot_weekly


def _prev_biz_day(n: int) -> str:
    """Return today minus n business days as YYYY-MM-DD."""
    from datetime import timedelta
    d = date.today()
    skipped = 0
    while skipped < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            skipped += 1
    return d.isoformat()

def _pub_date() -> str:
    """Trade date for OI history: T-2 business days (ICE OI has a 1-day publication lag)."""
    return _prev_biz_day(2)

def _quote_date() -> str:
    """Display date for Daily Quotes: T-1 business day (most recent completed session)."""
    return _prev_biz_day(1)

_TODAY = _pub_date   # T-2 — embedded in DB title, consumed by OI history API

# ─────────────────────────────────────────────────────────────────────────────
# Barchart – futures chain (price + OI per contract)
# ─────────────────────────────────────────────────────────────────────────────

_BARCHART_API = (
    "https://www.barchart.com/proxies/core-api/v1/quotes/get"
    "?symbol={sym}"
    "&fields=symbol,contractName,contractExpirationDate,lastPrice,priceChange,openInterest,volume,symbolCode"
    "&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1"
)
_BARCHART_HOME = "https://www.barchart.com/"
_BC_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Contract months per product (letters → month numbers)
_KC_MONTHS = [("H", 3), ("K", 5), ("N", 7), ("U", 9), ("Z", 12)]
_RM_MONTHS = [("F", 1), ("H", 3), ("K", 5), ("N", 7), ("X", 11)]


def _active_front_symbol(prefix: str, months: list) -> str:
    """Return the nearest KC/RM contract letter+year that hasn't hit FND yet."""
    from datetime import timedelta
    today = date.today()
    buffer = timedelta(days=12)  # ~8 biz days before 1st of month + small buffer
    for yr in [today.year, today.year + 1]:
        for letter, mnum in months:
            first_of_month = date(yr, mnum, 1)
            rough_fnd = first_of_month - buffer
            if rough_fnd > today:
                return f"{prefix}{letter}{str(yr)[-2:]}"
    return f"{prefix}N{str(today.year)[-2:]}"  # safe fallback


def _barchart_requests() -> dict:
    """
    Pure-HTTP Barchart fetch — no browser needed.

    Hardening notes vs the original v1:
      - Warm the session with a contract-specific quote page before hitting
        the proxy API. The proxy endpoint refuses sessions that haven't
        navigated to a quote page first.
      - Send Referer / Origin / Sec-Fetch-* headers so the request looks
        like a real browser XHR, not a bare scrape.
      - Log status codes + body excerpts on failure so we can actually
        diagnose what's blocking (was previously silent on 403/429).
    """
    import requests
    sess = requests.Session()
    common_headers = {
        "User-Agent": _BC_UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
    }
    try:
        # Step 1: hit the homepage to set initial session cookies.
        r0 = sess.get(_BARCHART_HOME, headers=common_headers, timeout=15)
        if not r0.ok:
            print(f"[futures] barchart_requests: homepage HTTP {r0.status_code} — bailing")
            return {}

        # Step 2: navigate to a real KC quote page. This is what an actual
        # user browser would do before any XHR fires, and Barchart's proxy
        # rejects sessions that lack this context.
        kc_warm_url = "https://www.barchart.com/futures/quotes/KCY00/overview"
        r_warm = sess.get(kc_warm_url, headers=common_headers, timeout=15)
        if not r_warm.ok:
            print(f"[futures] barchart_requests: warm-page HTTP {r_warm.status_code} — continuing anyway")

        xsrf = sess.cookies.get("XSRF-TOKEN", "")
        if not xsrf:
            cookie_names = list(sess.cookies.keys())
            print(f"[futures] barchart_requests: no XSRF cookie after warm-up (cookies: {cookie_names}) — skipping")
            return {}

        # Step 3: API calls with explicit XHR headers so Barchart's WAF
        # recognises them as legitimate page interactions.
        api_headers = {
            **common_headers,
            "Accept": "application/json",
            "x-xsrf-token": xsrf,
            "Referer": kc_warm_url,
            "Origin": "https://www.barchart.com",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "X-Requested-With": "XMLHttpRequest",
        }
        fields = "symbol,contractName,contractExpirationDate,lastPrice,priceChange,openInterest,volume,symbolCode"
        opts   = "&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1"
        base   = "https://www.barchart.com/proxies/core-api/v1/quotes/get"

        def _fetch_market(symbol_param: str, label: str) -> dict | None:
            url = f"{base}?symbol={symbol_param}&fields={fields}{opts}"
            r = sess.get(url, headers=api_headers, timeout=10)
            if not r.ok:
                preview = (r.text or "")[:200].replace("\n", " ")
                print(f"[futures] barchart_requests {label}: HTTP {r.status_code} — body: {preview!r}")
                return None
            try:
                payload = r.json()
            except Exception as e:
                print(f"[futures] barchart_requests {label}: non-JSON response ({e})")
                return None
            count = len(payload.get("data") or []) if isinstance(payload, dict) else 0
            print(f"[futures] barchart_requests {label}: HTTP 200, {count} rows")
            if count == 0:
                return None
            return payload

        kc = _fetch_market("KC%5EF", "kc")
        rm = _fetch_market("RM%5EF", "rm")

        result: dict = {}
        if kc:
            result["kc"] = kc
        if rm:
            result["rm"] = rm
        if result:
            print(f"[futures] barchart_requests: returned {list(result.keys())}")
        return result
    except Exception as e:
        print(f"[futures] barchart_requests failed: {e}")
        return {}


async def _barchart_playwright(page) -> dict:
    """
    Playwright-based Barchart fetch — heavier but handles JS-rendered cookies.
    Used as fallback when pure-HTTP approach fails.
    """
    browser = page.context.browser
    ctx = await browser.new_context(user_agent=_BC_UA)
    pg = await ctx.new_page()
    result = {}
    try:
        # Use the active front-month URL so we never hit an expired contract page
        front_sym = _active_front_symbol("KC", _KC_MONTHS)
        init_url = f"https://www.barchart.com/futures/quotes/{front_sym}/overview"
        await pg.goto(init_url, wait_until="domcontentloaded", timeout=30000)
        await pg.wait_for_timeout(3000)

        # Verify XSRF cookie is present before attempting API calls
        for _ in range(3):
            cookies = await ctx.cookies()
            xsrf = next((c["value"] for c in cookies if c["name"] == "XSRF-TOKEN"), None)
            if xsrf:
                break
            await pg.wait_for_timeout(2000)
        else:
            print("[futures] playwright: XSRF cookie not found after 3 waits")
            return {}

        data = await pg.evaluate(
            """async () => {
                function getCookie(n) {
                    const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                    return v ? decodeURIComponent(v[2]) : null;
                }
                const xsrf = getCookie('XSRF-TOKEN');
                if (!xsrf) return null;
                const h = { credentials: 'include', headers: { 'x-xsrf-token': xsrf, 'accept': 'application/json' } };
                const base = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';
                const fields = 'symbol,contractName,contractExpirationDate,lastPrice,priceChange,openInterest,volume,symbolCode';
                const opts = '&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1';
                const [kcResp, rmResp] = await Promise.all([
                    fetch(base + '?symbol=KC%5EF&fields=' + fields + opts, h),
                    fetch(base + '?symbol=RM%5EF&fields=' + fields + opts, h),
                ]);
                return {
                    kc: kcResp.ok ? await kcResp.json() : null,
                    rm: rmResp.ok ? await rmResp.json() : null,
                };
            }"""
        )
        if data:
            result = data
            print("[futures] playwright: OK")
    except Exception as e:
        print(f"[futures] playwright failed: {e}")
    finally:
        await ctx.close()
    return result


def _yfinance_fallback() -> dict:
    """
    Yahoo Finance fallback — batches contract symbols into ONE HTTP request
    via yf.download() to avoid per-ticker rate limiting.

    Default shape (controlled by env FUTURES_YF_FULL_CHAIN=1) is *minimal*:
    only the two continuous symbols KC=F + RM=F. Previously we shipped 16
    expiry-specific tickers (KCH27.NYB, RCN27.NYL, …), which routinely
    tripped Yahoo's per-IP rate limit on GH runners that already burn yf
    calls elsewhere in the workflow. Two symbols rarely hit the limit;
    even when one path is fully rate-limited we usually still recover.

    OI is not exposed by Yahoo. Front-month price only.
    """
    try:
        import math
        import os
        from datetime import timedelta

        import pandas as pd
        import yfinance as yf

        def _candidate_symbols(prefix: str, months: list, yf_suffix: str) -> list:
            today = date.today()
            buffer = timedelta(days=12)
            syms = []
            for yr in [today.year, today.year + 1]:
                for letter, mnum in months:
                    if date(yr, mnum, 1) - buffer > today:
                        syms.append(f"{prefix}{letter}{str(yr)[-2:]}{yf_suffix}")
            return syms[:7]

        full_chain = os.environ.get("FUTURES_YF_FULL_CHAIN", "0") == "1"
        if full_chain:
            kc_syms = _candidate_symbols("KC", _KC_MONTHS, ".NYB")
            rm_syms = _candidate_symbols("RC", _RM_MONTHS, ".NYL")
        else:
            kc_syms, rm_syms = [], []
        cont_syms = ["KC=F", "RM=F"]
        all_syms = kc_syms + rm_syms + cont_syms

        # Single batched download — one HTTP request, avoids per-ticker rate limiting
        raw = yf.download(
            tickers=all_syms,
            period="5d",
            auto_adjust=False,
            progress=False,
        )
        is_multi = isinstance(raw.columns, pd.MultiIndex) if not raw.empty else False

        def _get_sym_close(sym: str):
            """Return (close, prev_close, vol) for latest session or None."""
            if raw.empty:
                return None
            try:
                if is_multi:
                    if sym not in raw.columns.get_level_values(1):
                        return None
                    col = raw["Close"][sym].dropna()
                else:
                    col = raw["Close"].dropna() if "Close" in raw.columns else pd.Series(dtype=float)
                if col.empty:
                    return None
                close = float(col.iloc[-1])
                prev  = float(col.iloc[-2]) if len(col) > 1 else close
                vol_col = (raw["Volume"][sym] if is_multi else raw.get("Volume", pd.Series()))
                vol_raw = vol_col.iloc[-1] if not vol_col.empty else None
                try:
                    vol = 0 if vol_raw is None or math.isnan(float(vol_raw)) else int(vol_raw)
                except (TypeError, ValueError):
                    vol = 0
                return close, prev, vol
            except Exception:
                return None

        result = {}
        for label, syms, product, decimals, cont_sym, months in [
            ("kc", kc_syms, "KC", 2, "KC=F", _KC_MONTHS),
            ("rm", rm_syms, "RC", 0, "RM=F", _RM_MONTHS),
        ]:
            contracts = []
            for sym in syms:
                q = _get_sym_close(sym)
                if not q:
                    continue
                close, prev, vol = q
                letter = sym[2]
                yr2    = sym[3:5]
                mnum   = next((m for l, m in months if l == letter), 1)
                contracts.append({
                    "contract": f"{product} {letter}{yr2}",
                    "expiry":   f"20{yr2}-{mnum:02d}-15",
                    "last":     round(close, decimals),
                    "chg":      round(close - prev, decimals),
                    "oi":       None,
                    "volume":   vol,
                    "symbol":   sym.split(".")[0],
                })

            if not contracts:
                q = _get_sym_close(cont_sym)
                if q:
                    close, prev, vol = q
                    fs     = _active_front_symbol(product, months)
                    letter = fs[2]
                    yr2    = fs[3:5]
                    mnum   = next((m for l, m in months if l == letter), 1)
                    contracts.append({
                        "contract": f"{product} {letter}{yr2} (continuous)",
                        "expiry":   f"20{yr2}-{mnum:02d}-15",
                        "last":     round(close, decimals),
                        "chg":      round(close - prev, decimals),
                        "oi":       None,
                        "volume":   vol,
                        "symbol":   fs,
                    })
                    print(f"[futures] yfinance {label}: using continuous {cont_sym}")

            if contracts:
                result[label] = {"data": [{"raw": c} for c in contracts], "_yf": True}

        if result:
            print(
                f"[futures] yfinance fallback: "
                f"kc={len(result.get('kc', {}).get('data', []))} "
                f"rm={len(result.get('rm', {}).get('data', []))}"
            )
        else:
            print("[futures] yfinance fallback: no data from any symbol")
        return result
    except Exception as e:
        print(f"[futures] yfinance fallback failed: {e}")
        return {}


def _stooq_fallback() -> dict:
    """Stooq CSV fallback — last resort when Barchart + yfinance both fail.

    Fetches the continuous front-month coffee quote (KC.F = Arabica, RC.F =
    Robusta) from stooq.com's no-auth daily-history CSV endpoint. This is
    already the same pattern macro_cot.py uses for stooq-backed prices, so
    no new dependency or API key.

    Limitation: stooq only exposes the continuous front, not the back-month
    chain — so we populate a single-contract entry per market instead of
    the usual 5-7. The dashboard's front-month price stays fresh; back-
    months render as blank rows. Better than the whole table going stale.
    """
    try:
        import io

        import pandas as pd
        import requests

        result: dict = {}
        for label, ticker, product, decimals, months in [
            ("kc", "KC.F", "KC", 2, _KC_MONTHS),
            ("rm", "RC.F", "RC", 0, _RM_MONTHS),
        ]:
            try:
                # Daily history endpoint — gives last 5+ years, we use last 2 rows
                # to compute the close + previous-close needed for `chg`.
                url = f"https://stooq.com/q/d/l/?s={ticker}&i=d"
                r = requests.get(url, timeout=20)
                r.raise_for_status()
                df = pd.read_csv(io.StringIO(r.text))
                if df.empty or "Close" not in df.columns:
                    print(f"[futures] stooq {ticker}: no data in CSV")
                    continue

                close = float(df["Close"].iloc[-1])
                prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else close
                if close <= 0:
                    print(f"[futures] stooq {ticker}: invalid close {close}")
                    continue

                vol = 0
                if "Volume" in df.columns:
                    try:
                        vol_raw = df["Volume"].iloc[-1]
                        if vol_raw and not pd.isna(vol_raw):
                            vol = int(vol_raw)
                    except (TypeError, ValueError):
                        vol = 0

                fs = _active_front_symbol(product, months)
                letter = fs[2]
                yr2 = fs[3:5]
                mnum = next((m for letr, m in months if letr == letter), 1)
                contract = {
                    "contract": f"{product} {letter}{yr2} (continuous)",
                    "expiry":   f"20{yr2}-{mnum:02d}-15",
                    "last":     round(close, decimals),
                    "chg":      round(close - prev, decimals),
                    "oi":       None,
                    "volume":   vol,
                    "symbol":   fs,
                }
                result[label] = {"data": [{"raw": contract}], "_stooq": True}
                print(f"[futures] stooq {ticker}: {close} (chg {round(close - prev, decimals)})")
            except Exception as e:
                print(f"[futures] stooq error for {ticker}: {e}")

        if result:
            kc_n = len(result.get("kc", {}).get("data", []))
            rm_n = len(result.get("rm", {}).get("data", []))
            print(f"[futures] stooq fallback: kc={kc_n} rm={rm_n}")
        else:
            print("[futures] stooq fallback: no data from either symbol")
        return result
    except Exception as e:
        print(f"[futures] stooq fallback crashed: {e}")
        return {}


async def _fetch_chains(page) -> dict:
    """Fetch futures chains: requests → Playwright → Yahoo Finance fallback.
    Playwright works in CI (fetch_oi_json.py uses same approach daily) so we no
    longer skip it — only the pure-HTTP XSRF path is unreliable on datacenter IPs."""

    # 1. Fast path: pure HTTP (no browser overhead, works when not IP-blocked)
    result = _barchart_requests()
    if result.get("kc") and result.get("rm"):
        return result

    # 2. Playwright — spin up a browser context and make authenticated API calls
    pw = await _barchart_playwright(page)
    for k in ("kc", "rm"):
        if not result.get(k) and pw.get(k):
            result[k] = pw[k]
    if result.get("kc") and result.get("rm"):
        return result

    # 3. Yahoo Finance — KC works (KC*.NYB symbols); RM not available on Yahoo
    if not result.get("kc") or not result.get("rm"):
        missing = [k for k in ("kc", "rm") if not result.get(k)]
        print(f"[futures] Barchart incomplete (missing: {missing}) — supplementing with Yahoo Finance")
        yf = _yfinance_fallback()
        for k in ("kc", "rm"):
            if not result.get(k) and yf.get(k):
                result[k] = yf[k]

    # 4. Stooq — last-resort continuous-front quote when Barchart + yfinance
    # both fail. Doesn't give us back-month chain depth, but at least a fresh
    # front-month price keeps futures_chain.json advancing instead of going
    # fully empty (which used to throw the dashboard onto stale data).
    if not result.get("kc") or not result.get("rm"):
        missing = [k for k in ("kc", "rm") if not result.get(k)]
        print(f"[futures] Yahoo still missing {missing} — trying Stooq CSV")
        st = _stooq_fallback()
        for k in ("kc", "rm"):
            if not result.get(k) and st.get(k):
                result[k] = st[k]

    return result


def _parse_chain(raw_data: dict, label: str) -> list[dict]:
    """Turn Barchart or Yahoo Finance API response into a clean list of contract dicts."""
    if not raw_data:
        return []
    items = raw_data.get("data", [])
    from datetime import date, timedelta
    cutoff = date.today() + timedelta(days=14)

    # Yahoo Finance fallback: data rows already have the final shape in "raw"
    is_yf = raw_data.get("_yf", False)

    contracts = []
    for it in items:
        r = it.get("raw", it)

        if is_yf:
            # Already clean — pass through directly
            contracts.append(r)
            continue

        oi = r.get("openInterest")
        # Skip contracts with negligible OI
        if oi is not None and int(oi) < 100:
            continue
        # Skip contracts expiring within 14 days (near expiry)
        exp_str = r.get("contractExpirationDate", "")
        try:
            if date.fromisoformat(exp_str) <= cutoff:
                continue
        except Exception:
            pass
        contracts.append({
            "contract": r.get("contractName", ""),
            "expiry":   r.get("contractExpirationDate", ""),
            "last":     r.get("lastPrice"),
            "chg":      r.get("priceChange"),
            "oi":       int(oi) if oi is not None else None,
            "volume":   r.get("volume"),
            "symbol":   r.get("symbol", ""),
        })
    return contracts


def _fmt_num(v, decimals: int = 0) -> str:
    if v is None:
        return "?"
    try:
        return f"{v:,.{decimals}f}" if decimals else f"{int(v):,}"
    except Exception:
        return str(v)


def _make_chain_item(contracts: list[dict], product: str, source_sym: str) -> dict | None:
    if not contracts:
        return None
    front = contracts[0]
    second = contracts[1] if len(contracts) > 1 else None
    chg_sign = "+" if (front.get("chg") or 0) >= 0 else ""
    body_parts = [
        f"Front ({front['contract']}): {_fmt_num(front.get('last'), 2)} "
        f"({chg_sign}{front.get('chg') if front.get('chg') is not None else '?'}) "
        f"OI:{_fmt_num(front.get('oi'))}"
    ]
    if second:
        chg2 = second.get("chg") or 0
        sign2 = "+" if chg2 >= 0 else ""
        body_parts.append(
            f"2nd ({second['contract']}): {_fmt_num(second.get('last'), 2)} "
            f"({sign2}{chg2}) OI:{_fmt_num(second.get('oi'))}"
        )
    tags = ["futures", "price"]
    if "Arabica" in product or source_sym == "KC":
        tags += ["arabica"]
    else:
        tags += ["robusta"]
    return {
        "title": f"{product} Futures – {_TODAY()}",
        "body": " | ".join(body_parts),
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": tags,
        "meta": json.dumps({"contracts": contracts, "quote_date": _quote_date()}),
    }


# ─────────────────────────────────────────────────────────────────────────────
# CFTC – Disaggregated COT for Coffee C (NY Arabica)
# ─────────────────────────────────────────────────────────────────────────────

_CFTC_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_2026.zip"


def _fetch_cftc_cot() -> dict | None:
    """Download CFTC 2026 disaggregated COT zip and return latest Coffee C row."""
    try:
        req = urllib.request.Request(_CFTC_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            with z.open(z.namelist()[0]) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
                rows = [
                    row for row in reader
                    if "COFFEE" in row.get("Market_and_Exchange_Names", "").upper()
                ]
        if not rows:
            return None
        rows.sort(key=lambda x: x["Report_Date_as_YYYY-MM-DD"], reverse=True)
        return rows[0]
    except Exception as e:
        print(f"[futures] CFTC fetch error: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# ICE – Disaggregated COT for London Robusta Coffee
# ─────────────────────────────────────────────────────────────────────────────

_ICE_COT_URL = "https://www.ice.com/publicdocs/futures/COTHist2026.csv"


def _fetch_ice_robusta_cot() -> tuple[dict, dict | None] | None:
    """
    Download ICE 2026 disaggregated COT CSV.
    Returns (latest_row, prev_row) for Robusta futures-only, or None on failure.
    Change fields are not pre-calculated in the ICE file — caller must diff rows.
    """
    try:
        req = urllib.request.Request(_ICE_COT_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            content = r.read().decode("utf-8-sig")  # strip BOM
        reader = csv.DictReader(io.StringIO(content))
        rows = [
            row for row in reader
            if row.get("Market_and_Exchange_Names", "").strip()
            == "ICE Robusta Coffee Futures - ICE Futures Europe"
        ]
        if not rows:
            return None
        # Sort chronologically by As_of_Date_In_Form_YYMMDD (YYMMDD integer sort works)
        rows.sort(key=lambda x: x.get("As_of_Date_In_Form_YYMMDD", ""))
        latest = rows[-1]
        prev   = rows[-2] if len(rows) >= 2 else None
        return latest, prev
    except Exception as e:
        print(f"[futures] ICE Robusta COT fetch error: {e}")
        return None


def _ice_date_to_iso(mm_dd_yyyy: str) -> str:
    """Convert MM/DD/YYYY to YYYY-MM-DD."""
    try:
        parts = mm_dd_yyyy.strip().split("/")
        return f"{parts[2]}-{parts[0]:>02}-{parts[1]:>02}"
    except Exception:
        return mm_dd_yyyy


def _make_ice_cot_item(latest: dict, prev: dict | None) -> dict:
    """Build a COT news item from ICE Robusta data, computing changes from prev row."""
    report_date = _ice_date_to_iso(latest.get("As_of_Date_Form_MM/DD/YYYY", ""))
    oi = _int(latest["Open_Interest_All"])

    def chg(key: str) -> int:
        if prev is None:
            return 0
        return _int(latest.get(key, "0")) - _int(prev.get(key, "0"))

    pmpu_l  = _int(latest["Prod_Merc_Positions_Long_All"])
    pmpu_s  = _int(latest["Prod_Merc_Positions_Short_All"])
    pmpu_dl = chg("Prod_Merc_Positions_Long_All")
    pmpu_ds = chg("Prod_Merc_Positions_Short_All")

    swap_l  = _int(latest["Swap_Positions_Long_All"])
    swap_s  = _int(latest["Swap_Positions_Short_All"])
    swap_sp = _int(latest["Swap_Positions_Spread_All"])
    swap_dl = chg("Swap_Positions_Long_All")
    swap_ds = chg("Swap_Positions_Short_All")

    mm_l    = _int(latest["M_Money_Positions_Long_All"])
    mm_s    = _int(latest["M_Money_Positions_Short_All"])
    mm_sp   = _int(latest["M_Money_Positions_Spread_All"])
    mm_dl   = chg("M_Money_Positions_Long_All")
    mm_ds   = chg("M_Money_Positions_Short_All")
    mm_dsp  = chg("M_Money_Positions_Spread_All")

    oth_l   = _int(latest["Other_Rept_Positions_Long_All"])
    oth_s   = _int(latest["Other_Rept_Positions_Short_All"])
    oth_sp  = _int(latest["Other_Rept_Positions_Spread_All"])
    oth_dl  = chg("Other_Rept_Positions_Long_All")
    oth_ds  = chg("Other_Rept_Positions_Short_All")

    nr_l    = _int(latest["NonRept_Positions_Long_All"])
    nr_s    = _int(latest["NonRept_Positions_Short_All"])
    nr_dl   = chg("NonRept_Positions_Long_All")
    nr_ds   = chg("NonRept_Positions_Short_All")

    cot_struct = {
        "report_date": report_date,
        "open_interest": oi,
        "pmpu":  {"long": pmpu_l, "short": pmpu_s, "d_long": pmpu_dl, "d_short": pmpu_ds},
        "swap":  {"long": swap_l, "short": swap_s, "spread": swap_sp, "d_long": swap_dl, "d_short": swap_ds},
        "mm":    {"long": mm_l, "short": mm_s, "spread": mm_sp, "d_long": mm_dl, "d_short": mm_ds, "d_spread": mm_dsp},
        "other": {"long": oth_l, "short": oth_s, "spread": oth_sp, "d_long": oth_dl, "d_short": oth_ds},
        "nr":    {"long": nr_l, "short": nr_s, "d_long": nr_dl, "d_short": nr_ds},
    }
    # Persist to cot_weekly for the CoT dashboard
    try:
        upsert_cot_weekly("ldn", report_date, {
            "oi_total":    oi,
            "pmpu_long":   pmpu_l,  "pmpu_short":  pmpu_s,
            "swap_long":   swap_l,  "swap_short":  swap_s,  "swap_spread": swap_sp,
            "mm_long":     mm_l,    "mm_short":    mm_s,    "mm_spread":   mm_sp,
            "other_long":  oth_l,   "other_short": oth_s,   "other_spread": oth_sp,
            "nr_long":     nr_l,    "nr_short":    nr_s,
            "t_nr_long":   None,    "t_nr_short":  None,
        })
    except Exception as e:
        print(f"[cot] Failed to upsert LDN cot_weekly for {report_date}: {e}")
    mm_net = mm_l - mm_s
    mm_net_sign = "+" if mm_net >= 0 else ""
    body = (
        f"Report: {report_date} | OI: {oi:,} | "
        f"MM net: {mm_net_sign}{mm_net:,} (L:{mm_l:,} S:{mm_s:,} Sp:{mm_sp:,} ΔL:{mm_dl:+,} ΔS:{mm_ds:+,}) | "
        f"PMPU L:{pmpu_l:,} S:{pmpu_s:,} | "
        f"Swap L:{swap_l:,} S:{swap_s:,} | "
        f"Other L:{oth_l:,} S:{oth_s:,} | "
        f"NR L:{nr_l:,} S:{nr_s:,}"
    )
    return {
        "title": f"ICE COT Robusta Coffee (London) – {report_date}",
        "body": body,
        "source": "ICE",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": ["futures", "cot", "robusta"],
        "meta": json.dumps(cot_struct),
    }


def _int(val: str) -> int:
    try:
        return int(val.strip())
    except Exception:
        return 0


def _get(row: dict, *keys: str) -> int:
    """Try multiple key variants (handles single vs double underscore)."""
    for k in keys:
        if k in row:
            return _int(row[k])
    return 0


def _make_cot_item(row: dict, title: str, source: str, tags: list[str]) -> dict:
    report_date = row["Report_Date_as_YYYY-MM-DD"]
    oi = _int(row["Open_Interest_All"])

    pmpu_l  = _int(row["Prod_Merc_Positions_Long_All"])
    pmpu_s  = _int(row["Prod_Merc_Positions_Short_All"])
    pmpu_dl = _int(row["Change_in_Prod_Merc_Long_All"])
    pmpu_ds = _int(row["Change_in_Prod_Merc_Short_All"])

    swap_l  = _int(row["Swap_Positions_Long_All"])
    swap_s  = _get(row, "Swap__Positions_Short_All", "Swap_Positions_Short_All")
    swap_sp = _get(row, "Swap__Positions_Spread_All", "Swap_Positions_Spread_All")
    swap_dl = _int(row["Change_in_Swap_Long_All"])
    swap_ds = _int(row["Change_in_Swap_Short_All"])

    mm_l    = _int(row["M_Money_Positions_Long_All"])
    mm_s    = _int(row["M_Money_Positions_Short_All"])
    mm_sp   = _int(row["M_Money_Positions_Spread_All"])
    mm_dl   = _int(row["Change_in_M_Money_Long_All"])
    mm_ds   = _int(row["Change_in_M_Money_Short_All"])
    mm_dsp  = _int(row["Change_in_M_Money_Spread_All"])

    oth_l   = _int(row["Other_Rept_Positions_Long_All"])
    oth_s   = _int(row["Other_Rept_Positions_Short_All"])
    oth_sp  = _int(row["Other_Rept_Positions_Spread_All"])
    oth_dl  = _int(row["Change_in_Other_Rept_Long_All"])
    oth_ds  = _int(row["Change_in_Other_Rept_Short_All"])

    nr_l    = _int(row["NonRept_Positions_Long_All"])
    nr_s    = _int(row["NonRept_Positions_Short_All"])
    nr_dl   = _int(row["Change_in_NonRept_Long_All"])
    nr_ds   = _int(row["Change_in_NonRept_Short_All"])

    # Old / Other crop split (CFTC Arabica only)
    pmpu_l_old    = _int(row["Prod_Merc_Positions_Long_Old"])
    pmpu_s_old    = _int(row["Prod_Merc_Positions_Short_Old"])
    swap_l_old    = _int(row["Swap_Positions_Long_Old"])
    swap_s_old    = _get(row, "Swap__Positions_Short_Old", "Swap_Positions_Short_Old")
    swap_sp_old   = _get(row, "Swap__Positions_Spread_Old", "Swap_Positions_Spread_Old")
    mm_l_old      = _int(row["M_Money_Positions_Long_Old"])
    mm_s_old      = _int(row["M_Money_Positions_Short_Old"])
    mm_sp_old     = _int(row["M_Money_Positions_Spread_Old"])
    oth_l_old     = _int(row["Other_Rept_Positions_Long_Old"])
    oth_s_old     = _int(row["Other_Rept_Positions_Short_Old"])
    oth_sp_old    = _int(row["Other_Rept_Positions_Spread_Old"])
    nr_l_old      = _int(row["NonRept_Positions_Long_Old"])
    nr_s_old      = _int(row["NonRept_Positions_Short_Old"])

    pmpu_l_other  = _int(row["Prod_Merc_Positions_Long_Other"])
    pmpu_s_other  = _int(row["Prod_Merc_Positions_Short_Other"])
    swap_l_other  = _int(row["Swap_Positions_Long_Other"])
    swap_s_other  = _get(row, "Swap__Positions_Short_Other", "Swap_Positions_Short_Other")
    swap_sp_other = _get(row, "Swap__Positions_Spread_Other", "Swap_Positions_Spread_Other")
    mm_l_other    = _int(row["M_Money_Positions_Long_Other"])
    mm_s_other    = _int(row["M_Money_Positions_Short_Other"])
    mm_sp_other   = _int(row["M_Money_Positions_Spread_Other"])
    oth_l_other   = _int(row["Other_Rept_Positions_Long_Other"])
    oth_s_other   = _int(row["Other_Rept_Positions_Short_Other"])
    oth_sp_other  = _int(row["Other_Rept_Positions_Spread_Other"])
    nr_l_other    = _int(row["NonRept_Positions_Long_Other"])
    nr_s_other    = _int(row["NonRept_Positions_Short_Other"])

    cot_struct = {
        "report_date": report_date,
        "open_interest": oi,
        "pmpu":  {"long": pmpu_l, "short": pmpu_s, "d_long": pmpu_dl, "d_short": pmpu_ds},
        "swap":  {"long": swap_l, "short": swap_s, "spread": swap_sp, "d_long": swap_dl, "d_short": swap_ds},
        "mm":    {"long": mm_l, "short": mm_s, "spread": mm_sp, "d_long": mm_dl, "d_short": mm_ds, "d_spread": mm_dsp},
        "other": {"long": oth_l, "short": oth_s, "spread": oth_sp, "d_long": oth_dl, "d_short": oth_ds},
        "nr":    {"long": nr_l, "short": nr_s, "d_long": nr_dl, "d_short": nr_ds},
    }
    # Persist to cot_weekly for the CoT dashboard
    try:
        upsert_cot_weekly("ny", report_date, {
            "oi_total":    oi,
            "pmpu_long":   pmpu_l,  "pmpu_short":  pmpu_s,
            "swap_long":   swap_l,  "swap_short":  swap_s,  "swap_spread": swap_sp,
            "mm_long":     mm_l,    "mm_short":    mm_s,    "mm_spread":   mm_sp,
            "other_long":  oth_l,   "other_short": oth_s,   "other_spread": oth_sp,
            "nr_long":     nr_l,    "nr_short":    nr_s,
            "pmpu_long_old":    pmpu_l_old,   "pmpu_short_old":    pmpu_s_old,
            "swap_long_old":    swap_l_old,   "swap_short_old":    swap_s_old,   "swap_spread_old":  swap_sp_old,
            "mm_long_old":      mm_l_old,     "mm_short_old":      mm_s_old,     "mm_spread_old":    mm_sp_old,
            "other_long_old":   oth_l_old,    "other_short_old":   oth_s_old,    "other_spread_old": oth_sp_old,
            "nr_long_old":      nr_l_old,     "nr_short_old":      nr_s_old,
            "pmpu_long_other":  pmpu_l_other, "pmpu_short_other":  pmpu_s_other,
            "swap_long_other":  swap_l_other, "swap_short_other":  swap_s_other, "swap_spread_other":  swap_sp_other,
            "mm_long_other":    mm_l_other,   "mm_short_other":    mm_s_other,   "mm_spread_other":    mm_sp_other,
            "other_long_other": oth_l_other,  "other_short_other": oth_s_other,  "other_spread_other": oth_sp_other,
            "nr_long_other":    nr_l_other,   "nr_short_other":    nr_s_other,
        })
    except Exception as e:
        print(f"[cot] Failed to upsert NY cot_weekly for {report_date}: {e}")
    mm_net = mm_l - mm_s
    mm_net_sign = "+" if mm_net >= 0 else ""
    body = (
        f"Report: {report_date} | OI: {oi:,} | "
        f"MM net: {mm_net_sign}{mm_net:,} (L:{mm_l:,} S:{mm_s:,} Sp:{mm_sp:,} ΔL:{mm_dl:+,} ΔS:{mm_ds:+,}) | "
        f"PMPU L:{pmpu_l:,} S:{pmpu_s:,} | "
        f"Swap L:{swap_l:,} S:{swap_s:,} | "
        f"Other L:{oth_l:,} S:{oth_s:,} | "
        f"NR L:{nr_l:,} S:{nr_s:,}"
    )
    return {
        "title": f"{title} – {report_date}",
        "body": body,
        "source": source,
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": tags,
        "meta": json.dumps(cot_struct),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

async def run(page) -> list[dict]:
    results = []
    kc_contracts: list = []
    rm_contracts: list = []

    # 1. Barchart / Yahoo Finance futures chains
    try:
        chains = await _fetch_chains(page)
        kc_contracts = _parse_chain(chains.get("kc"), "KC")
        rm_contracts = _parse_chain(chains.get("rm"), "RM")

        kc_item = _make_chain_item(kc_contracts, "ICE NY Arabica (KC)", "KC")
        rm_item = _make_chain_item(rm_contracts, "ICE London Robusta (RM)", "RM")

        if kc_item:
            results.append(kc_item)
            print(f"[futures] KC: {kc_item['body'][:80]}")
        if rm_item:
            results.append(rm_item)
            print(f"[futures] RM: {rm_item['body'][:80]}")
    except Exception as e:
        print(f"[futures] Barchart chains failed: {e}")

    # 2. CFTC COT (NY Arabica)
    try:
        cot_row = _fetch_cftc_cot()
        if cot_row:
            cot_item = _make_cot_item(
                cot_row,
                title="CFTC COT Coffee C (NY Arabica)",
                source="CFTC",
                tags=["futures", "cot", "arabica"],
            )
            results.append(cot_item)
            print(f"[futures] COT Arabica: {cot_item['title']}")
            # Wire Barchart KC chain data into cot_weekly for NY
            report_date_ny = cot_row["Report_Date_as_YYYY-MM-DD"]
            if kc_contracts and len(kc_contracts) >= 1:
                nearby_oi_ny = sum(c["oi"] or 0 for c in kc_contracts[:2])
                structure_ny = (
                    kc_contracts[1]["last"] - kc_contracts[0]["last"]
                    if len(kc_contracts) >= 2
                    and kc_contracts[0].get("last") is not None
                    and kc_contracts[1].get("last") is not None
                    else None
                )
                chain_fields: dict = {"exch_oi_ny": nearby_oi_ny}
                if structure_ny is not None:
                    chain_fields["structure_ny"] = structure_ny
                try:
                    upsert_cot_weekly("ny", report_date_ny, chain_fields)
                    print(f"[futures] NY chain upserted: exch_oi={nearby_oi_ny}, structure={structure_ny}")
                except Exception as e:
                    print(f"[cot] Failed to upsert NY chain fields for {report_date_ny}: {e}")
    except Exception as e:
        print(f"[futures] CFTC COT failed: {e}")

    # 3. ICE COT (London Robusta)
    try:
        ice_result = _fetch_ice_robusta_cot()
        if ice_result:
            latest, prev = ice_result
            ice_cot_item = _make_ice_cot_item(latest, prev)
            results.append(ice_cot_item)
            print(f"[futures] COT Robusta: {ice_cot_item['title']}")
            # Wire Barchart RM chain data into cot_weekly for LDN
            report_date_ldn = _ice_date_to_iso(latest.get("As_of_Date_Form_MM/DD/YYYY", ""))
            if rm_contracts and len(rm_contracts) >= 1:
                nearby_oi_ldn = sum(c["oi"] or 0 for c in rm_contracts[:2])
                structure_ldn = (
                    rm_contracts[1]["last"] - rm_contracts[0]["last"]
                    if len(rm_contracts) >= 2
                    and rm_contracts[0].get("last") is not None
                    and rm_contracts[1].get("last") is not None
                    else None
                )
                chain_fields_ldn: dict = {"exch_oi_ldn": nearby_oi_ldn}
                if structure_ldn is not None:
                    chain_fields_ldn["structure_ldn"] = structure_ldn
                try:
                    upsert_cot_weekly("ldn", report_date_ldn, chain_fields_ldn)
                    print(f"[futures] LDN chain upserted: exch_oi={nearby_oi_ldn}, structure={structure_ldn}")
                except Exception as e:
                    print(f"[cot] Failed to upsert LDN chain fields for {report_date_ldn}: {e}")
    except Exception as e:
        print(f"[futures] ICE Robusta COT failed: {e}")

    # Escalate total chain-fetch failure. CriticalSourceError propagates
    # through _run_one in main.py (which only swallows generic Exception)
    # and fails the daily scraper, firing the existing if: failure()
    # Telegram alert within an hour instead of waiting a day for the
    # freshness check workflow.
    #
    # COT data is already safe at this point — _make_cot_item and
    # _make_ice_cot_item write to cot_weekly via upsert_cot_weekly before
    # returning, so api/cot keeps getting fresh data. The COT NewsItems
    # we collected in `results` are lost on this raise, but they're
    # cosmetic news-feed entries and the next day's run repopulates them.
    # If every chain-fetch path returned empty, log loudly but DON'T raise —
    # the daily workflow has 25+ other sources that should still get to run
    # and write data. The check-scrapers-freshness workflow will Telegram-alert
    # within ~36 h on the stale futures key, which is the proper channel for
    # data-staleness notifications. Earlier behavior (raise CriticalSourceError)
    # killed the entire pipeline whenever Barchart's IP block + yfinance rate
    # limit lined up — a daily occurrence — so all the other working sources
    # also failed to land their data.
    #
    # COT data is already safe at this point — _make_cot_item and
    # _make_ice_cot_item write to cot_weekly via upsert_cot_weekly before
    # returning, so api/cot keeps getting fresh data.
    if not kc_contracts and not rm_contracts:
        print(
            "[futures] WARNING: all chain fetchers (Barchart HTTP, Playwright, "
            "yfinance) returned empty — futures_chain.json will not advance. "
            "Likely cause: Barchart IP block + yfinance rate limit. "
            "Freshness alert will fire if this persists past 36 h."
        )

    return results
