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
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
import pandas as pd
import numpy as np
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT       = Path(__file__).resolve().parents[3]
OUT_PATH   = ROOT / "frontend" / "public" / "data" / "quant_report.json"
FX_OUT     = ROOT / "frontend" / "public" / "data" / "fx_history.json"

# yfinance hits query1.finance.yahoo.com directly. Default User-Agent is
# "Python-urllib/..." which Yahoo aggressively rate-limits / 403s from
# cloud-provider IP ranges (Azure, GCP — and GitHub Actions runners run
# on Azure). Empirically reproduced 2026-05-11 onwards: workflow stopped
# committing quant_report.json silently, all 12 tickers returning empty
# DataFrames, "Run Currency Index scraper" step hitting sys.exit(1).
#
# Passing a Session with a real browser UA bypasses the default block —
# this is the documented yfinance override path (`session=` kwarg accepted
# by yf.download).
def _build_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept":          "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.7",
    })
    return s

_YF_SESSION = _build_session()
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


def _fetch_closes(ticker: str, period: str = "2y") -> pd.Series:
    """Download daily close prices for a ticker."""
    try:
        hist = yf.download(
            ticker, period=period, interval="1d",
            auto_adjust=True, progress=False,
            session=_YF_SESSION,
        )
        if isinstance(hist.columns, pd.MultiIndex):
            hist.columns = hist.columns.get_level_values(0)
        if hist.empty or "Close" not in hist.columns:
            print(f"  WARNING: {ticker} returned empty DataFrame "
                  f"(columns={list(hist.columns) if not hist.empty else 'EMPTY'})",
                  file=sys.stderr)
            return pd.Series(dtype=float)
        return hist["Close"].dropna()
    except Exception as e:
        print(f"  WARNING: could not fetch {ticker}: {type(e).__name__}: {e}", file=sys.stderr)
        return pd.Series(dtype=float)


def _fetch_returns(ticker: str, period: str = "2y") -> pd.Series:
    """Return close-to-close % changes for a ticker (legacy entrypoint)."""
    closes = _fetch_closes(ticker, period=period)
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

    # ── Fetch all closes (single download per pair; returns derived below) ────
    exporter_closes: dict[str, pd.Series] = {}
    for ticker, name, _ in EXPORTERS:
        print(f"  {ticker} ({name})...")
        exporter_closes[ticker] = _fetch_closes(ticker)

    importer_closes: dict[str, pd.Series] = {}
    for ticker, name, _ in IMPORTERS:
        print(f"  {ticker} ({name})...")
        importer_closes[ticker] = _fetch_closes(ticker)

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

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2)

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
    with open(FX_OUT, "w", encoding="utf-8") as f:
        json.dump(fx_output, f, indent=2)
    print(f"Saved → {FX_OUT}  ({len(fx_pairs)} pairs)")


if __name__ == "__main__":
    main()
