"""
_probe_fx_history.py  (throwaway diagnostic, round 2)
fawazahmed0 only serves >=2024-03-02, so we need a deep-history source that also
carries the exotic exporter pairs (VND, COP, PEN — ECB/Frankfurter lacks them).
Tests Yahoo chart v8 and Stooq CSV for the hardest pairs back to 2020. Runs on a
GH runner (these hosts are policy-blocked from the dev sandbox). Prints coverage.
"""
import sys
import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
P1, P2 = 1577836800, 1893456000  # 2020-01-01 .. 2030-01-01


def yahoo(tkr):
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = f"https://{host}/v8/finance/chart/{tkr}?period1={P1}&period2={P2}&interval=1d"
        try:
            r = requests.get(url, headers=UA, timeout=25)
            if r.status_code != 200:
                last = f"{r.status_code}"; continue
            res = r.json()["chart"]["result"][0]
            ts = res["timestamp"]
            cl = res["indicators"]["quote"][0]["close"]
            import datetime as dt
            d0 = dt.datetime.utcfromtimestamp(ts[0]).date()
            d1 = dt.datetime.utcfromtimestamp(ts[-1]).date()
            nz = sum(1 for c in cl if c is not None)
            return f"OK {nz}pts {d0}..{d1}"
        except Exception as e:  # noqa: BLE001
            last = f"ERR {type(e).__name__}"
    return last


def stooq(sym):
    url = f"https://stooq.com/q/d/l/?s={sym}&d1=20200101&d2=20260628&i=d"
    try:
        r = requests.get(url, headers=UA, timeout=25)
        if r.status_code != 200:
            return f"{r.status_code}"
        lines = r.text.strip().splitlines()
        if len(lines) < 3 or not lines[0].lower().startswith("date"):
            return f"no-data ({r.text[:30]!r})"
        first = lines[1].split(",")[0]; last = lines[-1].split(",")[0]
        return f"OK {len(lines)-1}pts {first}..{last}"
    except Exception as e:  # noqa: BLE001
        return f"ERR {type(e).__name__}"


YH = ["BRL=X", "VND=X", "COP=X", "IDR=X", "PEN=X", "EURUSD=X", "JPY=X",
      "CHF=X", "CNY=X", "CAD=X", "KRW=X", "GBP=X", "GTQ=X"]
ST = ["usdbrl", "usdvnd", "usdcop", "usdidr", "usdpen", "eurusd", "usdjpy",
      "usdchf", "usdcny", "usdcad", "usdkrw", "usdgbp", "usdgtq"]


def main():
    print("== Yahoo chart v8 (period1=2020-01-01) ==")
    for t in YH:
        print(f"  {t:10s} {yahoo(t)}")
    print("== Stooq CSV (2020-01-01..2026-06-28) ==")
    for s in ST:
        print(f"  {s:10s} {stooq(s)}")


if __name__ == "__main__":
    main()
