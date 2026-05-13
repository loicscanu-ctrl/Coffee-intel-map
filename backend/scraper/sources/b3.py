# backend/scraper/sources/b3.py
#
# Fetches B3 Arabica Coffee (ICA) front-month settlement price via B3's
# public DerivativeQuotation JSON API — the same channel the b3_icf source
# uses for the USD-denominated ICF contract.
#
# Previous implementation tried to scrape the JS-rendered HTML quote page
# at b3.com.br/en_us/.../futures/ica/, which routinely returned 0 items
# because (a) the page hits a 45 s `networkidle` timeout under busy
# telemetry, and (b) when it did load, the price element wasn't in the
# initial HTML — it was injected by an XHR after the DOM was captured.
# The JSON API bypasses both issues.
#
# Endpoint: https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/ICA
# Field used: prvsDayAdjstmntPric (ajuste diário — official settlement)
# Unit: BRL per 60-kg sack
# Available: 24/7 (previous-day settlement always present)
#
# Note: ICF (USD-denominated) is handled by sources/b3_icf.py. This file
# keeps the legacy name and the `b3` registry key but now fetches ICA.

from datetime import date

import requests


def _today() -> str:
    return date.today().isoformat()
_LAT, _LNG = -14.235, -51.925  # Brazil centre

_URL = "https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/ICA"

_MONTH_CODES = {
    "F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May",
    "M": "Jun", "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct",
    "X": "Nov", "Z": "Dec",
}


def _front_month(contracts: list[dict]) -> dict | None:
    """Return the most liquid near-term futures contract (not expiring today)."""
    today_iso = date.today().isoformat()
    futures = [
        c for c in contracts
        if c.get("mkt", {}).get("cd") == "FUT"
        and c.get("SctyQtn", {}).get("prvsDayAdjstmntPric") is not None
        and (c.get("asset", {}).get("AsstSummry", {}).get("opnCtrcts") or 0) > 0
        and c["asset"]["AsstSummry"].get("mtrtyCode", "") > today_iso
    ]
    if not futures:
        return None
    return min(futures, key=lambda c: c["asset"]["AsstSummry"].get("mtrtyCode", "9999-99-99"))


def _contract_label(symb: str) -> str:
    """Convert 'ICAK26' → 'May '26'."""
    if len(symb) >= 6:
        month_code = symb[3]
        year = symb[4:6]
        month_name = _MONTH_CODES.get(month_code, "?")
        return f"{month_name} '{year}"
    return symb


async def run(page) -> list[dict]:  # noqa: ARG001
    """Fetch ICA settlement price via B3 JSON API. `page` is unused."""
    try:
        resp = requests.get(
            _URL,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("BizSts", {}).get("cd") != "OK":
            print(f"[b3] API status not OK: {data.get('BizSts')}")
            return []

        contract = _front_month(data.get("Scty", []))
        if not contract:
            print("[b3] no front-month ICA contract with settlement price")
            return []

        price = contract["SctyQtn"]["prvsDayAdjstmntPric"]
        symb  = contract.get("symb", "")
        label = _contract_label(symb)
        mty   = contract["asset"]["AsstSummry"].get("mtrtyCode", "")
        oi    = contract["asset"]["AsstSummry"].get("opnCtrcts", "—")

        print(f"[b3] {symb} | ajuste={price} BRL/sac | OI={oi} | mty={mty}")

        return [{
            "title":    f"B3 ICA Arabica ({label}) – {_today()}",
            "body":     f"B3 Arabica settlement: R$ {price:.2f}/sac | OI: {oi} contracts | Expiry: {mty}",
            "source":   "B3",
            "category": "supply",
            "lat":      _LAT,
            "lng":      _LNG,
            "tags":     ["price", "futures", "brazil", "arabica", "b3"],
        }]
    except Exception as e:
        print(f"[b3] failed: {e}")
        return []
