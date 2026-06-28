"""
_probe_fx_history.py  (throwaway diagnostic)
Determines how far back the fawazahmed0 currency-api serves data, and via which
URL form, so the multi-year CCI backfill can target the right endpoint. Runs on
a GitHub Actions runner (jsDelivr is reachable there; it's policy-blocked from
the dev sandbox). Prints a coverage table to stdout — nothing is written.
"""
import sys
import requests

CUR = "brl"  # any tracked currency; we only care about HTTP 200 + a usd map

FORMS = [
    ("npm v1 min", "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{d}/v1/currencies/usd.min.json"),
    ("npm v1",     "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{d}/v1/currencies/usd.json"),
    ("gh v1 min",  "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@{d}/v1/currencies/usd.min.json"),
    ("gh latest",  "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@{d}/latest/currencies/usd.json"),
    ("pages.dev",  "https://{d}.currency-api.pages.dev/v1/currencies/usd.json"),
]

DATES = ["2019-06-03", "2020-01-02", "2020-06-01", "2020-11-23",
         "2021-06-01", "2022-06-01", "2023-06-01", "2024-03-02", "latest"]


def probe(form_url, d):
    url = form_url.format(d=d)
    try:
        r = requests.get(url, timeout=20)
        if r.status_code != 200:
            return f"{r.status_code}"
        usd = r.json().get("usd", {})
        return f"200 ({len(usd)} cur, brl={usd.get('brl')})" if usd else "200 empty"
    except Exception as e:  # noqa: BLE001
        return f"ERR {type(e).__name__}"


def main():
    print(f"{'date':12s} | " + " | ".join(f"{n:22s}" for n, _ in FORMS))
    print("-" * 130)
    for d in DATES:
        cells = [probe(u, d) for _, u in FORMS]
        print(f"{d:12s} | " + " | ".join(f"{c:22s}" for c in cells))


if __name__ == "__main__":
    main()
