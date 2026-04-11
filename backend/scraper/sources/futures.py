"""
futures.py — Fetches ICE Arabica (KC) and ICE Robusta (RM) futures chain data
from Barchart, plus CFTC Disaggregated COT for Coffee C.
"""
import json
import urllib.request
import zipfile
import io
import csv
from datetime import date
from scraper.db import upsert_cot_weekly, get_session
from scraper.db_macro import upsert_commodity_price

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
    """Publication date: T-1 business day (when ICE/Barchart published the data)."""
    return _prev_biz_day(1)

_TODAY = _pub_date

# ─────────────────────────────────────────────────────────────────────────────
# Barchart – futures chain (price + OI per contract)
# ─────────────────────────────────────────────────────────────────────────────

_BARCHART_CHAIN_URL = (
    "https://www.barchart.com/proxies/core-api/v1/quotes/get"
    "?symbol={sym}"
    "&fields=symbol,contractName,contractExpirationDate,lastPrice,priceChange,openInterest,volume,symbolCode"
    "&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1"
)

_BARCHART_INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"


async def _get_xsrf_and_fetch_chains(page) -> dict:
    """
    Loads Barchart to obtain a session cookie, then fetches KC and RM
    futures chains from within the browser context (uses session cookies).
    Returns dict with 'KC' and 'RM' contract lists.
    """
    browser = page.context.browser
    ctx = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    )
    pg = await ctx.new_page()
    result = {}
    try:
        await pg.goto(_BARCHART_INIT_URL, wait_until="domcontentloaded", timeout=30000)
        await pg.wait_for_timeout(3000)

        # Fetch both chains from within the browser context (XSRF cookie available)
        data = await pg.evaluate(
            """async () => {
                function getCookie(n) {
                    const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                    return v ? decodeURIComponent(v[2]) : null;
                }
                const xsrf = getCookie('XSRF-TOKEN');
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
        result = data or {}
    except Exception as e:
        print(f"[futures] Barchart fetch error: {e}")
    finally:
        await ctx.close()
    return result


def _parse_chain(raw_data: dict, label: str) -> list[dict]:
    """Turn raw Barchart API response into a clean list of contract dicts."""
    items = (raw_data or {}).get("data", [])
    from datetime import date, timedelta
    cutoff = date.today() + timedelta(days=14)
    contracts = []
    for it in items:
        r = it.get("raw", it)
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
        contracts.append(
            {
                "contract": r.get("contractName", ""),
                "expiry": r.get("contractExpirationDate", ""),
                "last": r.get("lastPrice"),
                "chg": r.get("priceChange"),
                "oi": int(oi) if oi is not None else None,
                "volume": r.get("volume"),
                "symbol": r.get("symbol", ""),
            }
        )
    return contracts


def _make_chain_item(contracts: list[dict], product: str, source_sym: str) -> dict | None:
    if not contracts:
        return None
    front = contracts[0]
    second = contracts[1] if len(contracts) > 1 else None
    chg_sign = "+" if (front.get("chg") or 0) >= 0 else ""
    body_parts = [f"Front ({front['contract']}): {front['last']} ({chg_sign}{front['chg']}) OI:{front['oi']:,}"]
    if second:
        chg2 = second.get("chg") or 0
        sign2 = "+" if chg2 >= 0 else ""
        body_parts.append(f"2nd ({second['contract']}): {second['last']} ({sign2}{chg2}) OI:{second['oi']:,}")
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
        "meta": json.dumps({"contracts": contracts}),
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

    # 1. Barchart futures chains
    try:
        chains = await _get_xsrf_and_fetch_chains(page)
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

            # Store front-month RM price in commodity_prices (for Money Flow) and
            # cot_weekly.price_ldn (for COT dashboard), both keyed by the COT report date.
            # This means the price is always tied to the Tuesday COT date, not today.
            front_rm_price = rm_contracts[0].get("last") if rm_contracts else None
            if front_rm_price is not None:
                try:
                    _db = get_session()
                    try:
                        upsert_commodity_price(_db, "robusta", report_date_ldn, float(front_rm_price))
                        print(f"[futures] Robusta price→commodity_prices: {report_date_ldn} = {front_rm_price} USD/MT")
                    finally:
                        _db.close()
                except Exception as e:
                    print(f"[futures] Failed to store robusta price in commodity_prices: {e}")
                try:
                    upsert_cot_weekly("ldn", report_date_ldn, {"price_ldn": float(front_rm_price)})
                except Exception as e:
                    print(f"[futures] Failed to store robusta price_ldn in cot_weekly: {e}")
    except Exception as e:
        print(f"[futures] ICE Robusta COT failed: {e}")

    return results
