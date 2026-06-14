"""
fetch_currency_index.py
Computes the daily Coffee Currency Index (CCI) — a DXY-replication framework
tracking the net FX impact on coffee trade from producing and consuming nations.

Formula:
    ΔI = Σ w_Ex,i × ΔC_Ex,i  +  Σ w_Im,j × ΔC_Im,j

Where:
    - Exporters: currency vs USD, positive = exporter currency stronger = bullish coffee
    - Importers: currency vs USD, positive = importer currency stronger = bearish coffee (cheaper for them)

Timing: daily close-to-close % change for all FX pairs.

Weights source: USDA PSD 2023/24 crop year export/import volumes.
Exporter weights normalized over tracked liquid FX pairs only (excl. HNL, ETB, UGX).
Importer weights normalized excl. USD (base currency) and untracked currencies.

Usage:
    cd backend
    python -m scraper.quant_model.fetch_currency_index
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Make backend/ importable so we can pull the shared safe_write_json helper.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np
import pandas as pd
import requests

from scraper.validate_export import safe_write_json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT       = Path(__file__).resolve().parents[3]
OUT_PATH   = ROOT / "frontend" / "public" / "data" / "quant_report.json"
FX_OUT     = ROOT / "frontend" / "public" / "data" / "fx_history.json"

# FX source: @fawazahmed0/currency-api via jsDelivr CDN.
#
# Why we're not on yfinance anymore: Yahoo Finance + cloud IPs has been a
# series of escalating cat-and-mouse fixes — first a UA override (PR #46),
# then curl_cffi TLS impersonation (PR #48), and as of May 2026 the
# workflow still produces empty data on every scheduled run. The freshness
# alert in 1.5 catches it ~3 days late.
#
# jsDelivr serves a static JSON file per date that contains USD-base rates
# for 150+ currencies, updated daily from open FX feeds. No auth, no
# Cloudflare, no rate limit, no fingerprint games — it's a CDN-cached
# static file. We fetch ~365 daily snapshots concurrently (~36s total) and
# pivot into per-ticker Series matching yfinance's old shape so the rest
# of this module is unchanged.

_FX_API_BASE = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api"
FX_HISTORY_DAYS = 365  # ~1 year of daily closes per pair

# ── Weights (USDA PSD 2023/24, normalized over tracked pairs) ─────────────────
#
# Raw USDA export shares (liquid FX only):
#   Brazil 36.2%, Vietnam 18.5%, Colombia 9.0%, Indonesia 3.6%, Peru 3.3%
#   Total tracked: 70.6%  → normalized to 1.0
#
# Raw USDA import shares (excl. USA as base currency):
#   EU 39.2%, Japan 5.5%, Switzerland 3.0%, China 3.0%,
#   Canada 2.7%, South Korea 2.6%, UK 2.2%
#   Total tracked: 58.2% → normalized to 1.0

EXPORTERS = [
    # (yfinance ticker, display name, normalized weight)
    # Ticker format: XXXUSD=X means "how many USD per 1 unit of XXX"
    # Positive daily return → exporter currency stronger → bullish for coffee
    ("BRL=X",  "Brazilian Real",    0.513),
    ("VND=X",  "Vietnamese Dong",   0.262),
    ("COP=X",  "Colombian Peso",    0.128),
    ("IDR=X",  "Indonesian Rupiah", 0.051),
    ("PEN=X",  "Peruvian Sol",      0.047),
]

IMPORTERS = [
    # Ticker format: XXXUSD=X means "how many USD per 1 unit of XXX"
    # Positive daily return → importer currency stronger → bearish for coffee (cheaper for them)
    ("EURUSD=X", "Euro",          0.673),
    ("JPY=X",    "Japanese Yen",  0.095),
    ("CHF=X",    "Swiss Franc",   0.052),
    ("CNY=X",    "Chinese Yuan",  0.052),
    ("CAD=X",    "Canadian Dollar", 0.046),
    ("KRW=X",    "South Korean Won", 0.045),
    ("GBP=X",    "British Pound",  0.038),
]

# Z-score lookback window (trading days)
Z_WINDOW = 252


def _safe_float(val) -> float | None:
    try:
        v = float(val)
        return None if (pd.isna(v) or np.isinf(v)) else round(v, 6)
    except Exception:
        return None


def _ticker_to_currency(ticker: str) -> tuple[str, bool]:
    """Map yfinance-style FX ticker to (currency_code, invert_flag) for the FX API.

    yfinance ticker conventions (preserved here so the index math stays identical):
      "BRL=X"     → USDBRL ticker: 5.04 BRL per USD → ('brl', invert=False)
                    jsDelivr's usd.brl gives the same number; use directly.
      "EURUSD=X"  → EURUSD ticker: 1.08 USD per EUR → ('eur', invert=True)
                    jsDelivr's usd.eur gives 0.927 (EUR per USD), so we
                    return 1/0.927 = 1.079 to match yfinance's convention.

    All our tracked tickers follow one of these two forms — single 3-letter
    code → USDXXX (no invert), six-letter XXXUSD → invert.
    """
    t = ticker.replace("=X", "").upper()
    if len(t) == 6 and t.endswith("USD"):
        return t[:3].lower(), True
    return t.lower(), False


def _fetch_one_date(date_str: str, wanted: set[str]) -> dict[str, float] | None:
    """Fetch USD-base rates for a single date. Returns {currency: rate} or None.

    date_str = "YYYY-MM-DD" for historical, "latest" for today.
    wanted = set of currency codes we care about (lowercase ISO 4217).
    """
    url = f"{_FX_API_BASE}@{date_str}/v1/currencies/usd.json"
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return None
        data = r.json()
        usd = data.get("usd", {})
        return {c: usd[c] for c in wanted if c in usd and usd[c] is not None}
    except Exception:
        return None


def _fetch_all_closes(tickers: list[str], days: int = FX_HISTORY_DAYS) -> dict[str, pd.Series]:
    """Fetch ~days of historical USD-base FX closes for all tickers in parallel.

    Returns {ticker: pd.Series indexed by date}. Each Series has the same
    units as yfinance's `Close` would (preserving invert convention for EURUSD).
    """
    ticker_meta = {t: _ticker_to_currency(t) for t in tickers}
    wanted_currencies = {c for c, _ in ticker_meta.values()}

    today = date.today()
    # Today's snapshot may not have a tagged version yet; use 'latest'.
    # Historical dates use 'YYYY-MM-DD'.
    date_keys = ["latest"] + [(today - timedelta(days=d)).isoformat() for d in range(1, days)]

    rates_by_date: dict[str, dict[str, float]] = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = ex.map(
            lambda d: (d, _fetch_one_date(d, wanted_currencies)),
            date_keys,
        )
        for date_key, rates in results:
            if rates:
                # Resolve 'latest' to today's date for indexing.
                resolved = today.isoformat() if date_key == "latest" else date_key
                rates_by_date[resolved] = rates

    print(f"  [fx-api] {len(rates_by_date)}/{len(date_keys)} dates fetched from jsDelivr",
          file=sys.stderr)

    out: dict[str, pd.Series] = {}
    for ticker, (currency, invert) in ticker_meta.items():
        series_data: dict[pd.Timestamp, float] = {}
        for date_str, rates in rates_by_date.items():
            v = rates.get(currency)
            if v is None or v == 0:
                continue
            series_data[pd.Timestamp(date_str)] = (1.0 / v) if invert else v
        if not series_data:
            print(f"  WARNING: no data for {ticker} (currency='{currency}')", file=sys.stderr)
            out[ticker] = pd.Series(dtype=float)
        else:
            out[ticker] = pd.Series(series_data).sort_index().dropna()
    return out


def _fetch_closes(ticker: str) -> pd.Series:
    """Legacy single-ticker wrapper. Prefer _fetch_all_closes for bulk use."""
    return _fetch_all_closes([ticker]).get(ticker, pd.Series(dtype=float))


def _fetch_returns(ticker: str) -> pd.Series:
    """Return close-to-close % changes for a ticker (legacy entrypoint)."""
    closes = _fetch_closes(ticker)
    if closes.empty:
        return pd.Series(dtype=float)
    return closes.pct_change().dropna()


def _compute_index_series(
    exporter_returns: dict[str, pd.Series],
    importer_returns: dict[str, pd.Series],
) -> pd.Series:
    """
    Compute the daily CCI values over the common date range.
    Starts at a base of 100 and accumulates daily ΔI.
    """
    # Align all series to common dates
    all_series = {}
    for ticker, _, w in EXPORTERS:
        if ticker in exporter_returns and not exporter_returns[ticker].empty:
            all_series[ticker] = exporter_returns[ticker]
    for ticker, _, w in IMPORTERS:
        if ticker in importer_returns and not importer_returns[ticker].empty:
            all_series[ticker] = importer_returns[ticker]

    if not all_series:
        return pd.Series(dtype=float)

    df = pd.DataFrame(all_series).dropna(how="all")

    # Weighted daily ΔI
    delta_i = pd.Series(0.0, index=df.index)
    for ticker, _, w in EXPORTERS:
        if ticker in df.columns:
            delta_i += df[ticker].fillna(0) * w
    for ticker, _, w in IMPORTERS:
        if ticker in df.columns:
            delta_i += df[ticker].fillna(0) * w

    # Cumulative index starting at 100
    index_series = (1 + delta_i).cumprod() * 100
    return index_series


def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    scraped_at = datetime.now(timezone.utc).isoformat()

    print("Fetching FX data for Coffee Currency Index...")

    # ── Bulk fetch all closes in one parallel pass ─────────────────────────────
    all_tickers = [t for t, _, _ in EXPORTERS] + [t for t, _, _ in IMPORTERS]
    all_closes = _fetch_all_closes(all_tickers)

    exporter_closes = {t: all_closes.get(t, pd.Series(dtype=float)) for t, _, _ in EXPORTERS}
    importer_closes = {t: all_closes.get(t, pd.Series(dtype=float)) for t, _, _ in IMPORTERS}

    for ticker, name, _ in EXPORTERS + IMPORTERS:
        n = len(all_closes.get(ticker, pd.Series(dtype=float)))
        print(f"  {ticker} ({name}): {n} closes")

    exporter_returns = {t: s.pct_change().dropna() for t, s in exporter_closes.items()}
    importer_returns = {t: s.pct_change().dropna() for t, s in importer_closes.items()}

    # ── Build index series ─────────────────────────────────────────────────────
    index_series = _compute_index_series(exporter_returns, importer_returns)

    if index_series.empty:
        print("ERROR: no data to compute index", file=sys.stderr)
        sys.exit(1)

    # ── Today's values ─────────────────────────────────────────────────────────
    today_value = _safe_float(index_series.iloc[-1])
    prev_value  = _safe_float(index_series.iloc[-2]) if len(index_series) > 1 else None
    daily_delta = _safe_float((today_value - prev_value) / prev_value * 100) \
        if today_value and prev_value else None

    # ── Z-score over trailing window ───────────────────────────────────────────
    window = index_series.tail(Z_WINDOW)
    mu    = _safe_float(window.mean())
    sigma = _safe_float(window.std())
    zscore = _safe_float((today_value - mu) / sigma) \
        if today_value and mu and sigma and sigma != 0 else None

    # ── Per-currency contributions (today only) ────────────────────────────────
    currency_details = []

    def _today_return(ticker: str, returns: dict[str, pd.Series]) -> float | None:
        s = returns.get(ticker)
        if s is None or s.empty:
            return None
        return _safe_float(s.iloc[-1] * 100)  # in %

    for ticker, name, w in EXPORTERS:
        ret = _today_return(ticker, exporter_returns)
        currency_details.append({
            "ticker":       ticker,
            "name":         name,
            "type":         "export",
            "weight":       w,
            "daily_chg":    ret,
            "contribution": _safe_float(ret * w / 100) if ret is not None else None,
        })

    for ticker, name, w in IMPORTERS:
        ret = _today_return(ticker, importer_returns)
        currency_details.append({
            "ticker":       ticker,
            "name":         name,
            "type":         "import",
            "weight":       w,
            "daily_chg":    ret,
            "contribution": _safe_float(ret * w / 100) if ret is not None else None,
        })

    total_delta_i = sum(
        c["contribution"] for c in currency_details
        if c["contribution"] is not None
    )

    # ── 30-day history for sparkline ───────────────────────────────────────────
    history = []
    for dt, val in index_series.tail(30).items():
        history.append({
            "date":  dt.date().isoformat(),
            "value": _safe_float(val),
        })

    # ── Assemble output ────────────────────────────────────────────────────────
    cci_output = {
        "scraped_at":       scraped_at,
        "index_value":      today_value,
        "daily_delta_i":    _safe_float(total_delta_i),
        "daily_delta_pct":  daily_delta,
        "zscore":           zscore,
        "zscore_mean":      mu,
        "zscore_std":       sigma,
        "currencies":       currency_details,
        "history":          history,
    }

    # ── Merge into quant_report.json (preserving other sections) ──────────────
    existing = {}
    if OUT_PATH.exists():
        try:
            with open(OUT_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            pass

    existing["currency_index"] = cci_output
    existing["scraped_at"]     = scraped_at

    safe_write_json(
        OUT_PATH, existing,
        lambda d: (d.get("currency_index") is not None, "missing currency_index"),
    )

    print(f"\nCCI = {today_value:.2f}  ΔI = {total_delta_i:+.4f}  Z = {zscore:+.2f}")
    print(f"Saved → {OUT_PATH}")

    # ── fx_history.json: per-pair daily closes for the FX time-series widget ──
    # The Macro tab's CurrencyIndexSection shows the aggregate index. This file
    # backs the FX time-series widget that drills into the individual pairs.
    # We already downloaded 2y of closes above so this is essentially free.
    fx_pairs: dict[str, dict] = {}
    for ticker, name, w in EXPORTERS:
        closes = exporter_closes.get(ticker)
        if closes is None or closes.empty:
            continue
        tail = closes.tail(FX_HISTORY_DAYS)
        fx_pairs[ticker] = {
            "name":    name,
            "type":    "export",
            "weight":  w,
            "history": [
                {"date": dt.date().isoformat(), "close": _safe_float(val)}
                for dt, val in tail.items()
                if _safe_float(val) is not None
            ],
        }
    for ticker, name, w in IMPORTERS:
        closes = importer_closes.get(ticker)
        if closes is None or closes.empty:
            continue
        tail = closes.tail(FX_HISTORY_DAYS)
        fx_pairs[ticker] = {
            "name":    name,
            "type":    "import",
            "weight":  w,
            "history": [
                {"date": dt.date().isoformat(), "close": _safe_float(val)}
                for dt, val in tail.items()
                if _safe_float(val) is not None
            ],
        }

    fx_output = {
        "scraped_at":   scraped_at,
        "history_days": FX_HISTORY_DAYS,
        "pairs":        fx_pairs,
    }
    safe_write_json(
        FX_OUT, fx_output,
        lambda d: (bool(d.get("pairs")), "no fx pairs"),
    )
    print(f"Saved → {FX_OUT}  ({len(fx_pairs)} pairs)")


if __name__ == "__main__":
    main()
