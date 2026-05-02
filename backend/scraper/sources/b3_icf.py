# backend/scraper/sources/b3_icf.py
#
# Fetches the B3 Arabica Coffee 4/5 (ICF) front-month settlement price
# via B3's public DerivativeQuotation JSON API — no Playwright required.
#
# Endpoint: https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/ICF
# Field used: prvsDayAdjstmntPric (ajuste diário — official daily settlement)
# Unit: USD per 60-kg sack
# Available: 24/7 (previous day's settlement always present)

from datetime import date

import requests

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925  # Brazil centre
_URL = "https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/ICF"

MONTH_CODES = {
    "F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May",
    "M": "Jun", "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct",
    "X": "Nov", "Z": "Dec",
}


def _front_month(contracts: list[dict]) -> dict | None:
    """Return the most liquid near-term futures contract (not expiring today)."""
    today = date.today().isoformat()
    futures = [
        c for c in contracts
        if c.get("mkt", {}).get("cd") == "FUT"
        and c.get("SctyQtn", {}).get("prvsDayAdjstmntPric") is not None
        and (c.get("asset", {}).get("AsstSummry", {}).get("opnCtrcts") or 0) > 0
        and c["asset"]["AsstSummry"].get("mtrtyCode", "") > today
    ]
    if not futures:
        return None
    return min(futures, key=lambda c: c["asset"]["AsstSummry"].get("mtrtyCode", "9999-99-99"))


def _contract_label(symb: str) -> str:
    """Convert 'ICFK26' → 'May '26'."""
    if len(symb) >= 6:
        month_code = symb[3]
        year = symb[4:6]
        month_name = MONTH_CODES.get(month_code, "?")
        return f"{month_name} '{year}"
    return symb


async def run(page) -> list[dict]:
    """Fetch ICF settlement price — page argument unused (no Playwright needed)."""
    try:
        resp = requests.get(
            _URL,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("BizSts", {}).get("cd") != "OK":
            print(f"[b3_icf] API status not OK: {data.get('BizSts')}")
            return []

        contract = _front_month(data.get("Scty", []))
        if not contract:
            print("[b3_icf] no front-month contract with settlement price found")
            return []

        price = contract["SctyQtn"]["prvsDayAdjstmntPric"]
        symb  = contract.get("symb", "")
        label = _contract_label(symb)
        mty   = contract["asset"]["AsstSummry"].get("mtrtyCode", "")
        oi    = contract["asset"]["AsstSummry"].get("opnCtrcts", "—")

        print(f"[b3_icf] {symb} | ajuste={price} USD/sac | OI={oi} | mty={mty}")

        return [{
            "title":    f"B3 ICF Arabica ({label}) – {_TODAY()}",
            "body":     f"B3 Arabica 4/5 settlement: {price:.2f} USD/sac | OI: {oi} contracts | Expiry: {mty}",
            "source":   "B3",
            "category": "supply",
            "lat":      _LAT,
            "lng":      _LNG,
            "tags":     ["price", "futures", "brazil", "arabica", "b3"],
        }]

    except Exception as e:
        print(f"[b3_icf] failed: {e}")
        return []
