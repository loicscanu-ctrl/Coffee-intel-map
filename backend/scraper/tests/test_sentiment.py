import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from scraper.quant_model.sentiment import _aggregate, _filter_news


def _row(title, source, tags):
    return SimpleNamespace(title=title, source=source, tags=tags)


# ── corpus selection ──────────────────────────────────────────────────────────
def test_filter_keeps_editorial_news_and_drops_data_snapshots():
    rows = [
        # real editorial news (RSS) → kept
        _row("Brazil frost threatens arabica crop", "Perfect Daily Grind", ["news", "perfect_daily_grind"]),
        # auto-commentary agronomic row → excluded
        _row("Brazil Agronomic Status – 2026-06-18", "Open-Meteo + NOAA STAR",
             ["agronomic", "weather", "brazil", "auto-commentary"]),
        # data snapshot (coffee-tagged but not news) → excluded
        _row("CFTC COT Coffee C (NY Arabica) – 2026-06-09", "CFTC", ["cot", "arabica"]),
        # daily OI snapshot → excluded
        _row("IFUS KC Daily OI Snapshot – 2026-06-16", "ICE", ["arabica", "daily-oi", "auto-commentary"]),
    ]
    out = _filter_news(rows)
    assert len(out) == 1
    assert out[0]["headline"].startswith("Brazil frost")
    assert "news" not in out[0]["tags"]  # routing tag stripped


def test_filter_excludes_irrelevant_source_and_off_topic_news():
    rows = [
        _row("Vietnam robusta exports surge", "acaphe", ["news", "robusta"]),       # irrelevant source
        _row("Best 10 latte art tips for beginners", "Sprudge", ["news", "sprudge"]),  # off-topic culture
        _row("Colombia coffee harvest delayed by rain", "Sprudge", ["news", "sprudge"]),  # on-topic → kept
    ]
    out = _filter_news(rows)
    assert [o["headline"] for o in out] == ["Colombia coffee harvest delayed by rain"]


def test_filter_dedupes_by_title():
    rows = [
        _row("Coffee prices rally on supply fears", "Comunicaffe", ["news"]),
        _row("coffee prices rally on supply fears", "Daily Coffee News", ["news"]),  # dup (case/space)
    ]
    out = _filter_news(rows)
    assert len(out) == 1


# ── aggregation math ──────────────────────────────────────────────────────────
def test_overall_confidence_is_mean_within_winning_class_not_total():
    items = (
        [{"sentiment": "Bullish", "confidence": 80.0}] * 5
        + [{"sentiment": "Neutral", "confidence": 50.0}] * 20
    )
    agg = _aggregate(items)
    # Neutral wins on summed confidence (1000 > 400).
    assert agg["overall_sentiment"] == "Neutral"
    # Mean within the Neutral class is 50 — NOT 1000/25 = 40 (the old diluted math).
    assert agg["overall_confidence"] == 50.0


def test_net_index_sign_and_scale():
    bullish = _aggregate([{"sentiment": "Bullish", "confidence": 90.0}] * 3)
    bearish = _aggregate([{"sentiment": "Bearish", "confidence": 90.0}] * 3)
    mixed = _aggregate([
        {"sentiment": "Bullish", "confidence": 80.0},
        {"sentiment": "Bearish", "confidence": 40.0},
    ])
    assert bullish["net_index"] == 90.0      # all bullish → +90
    assert bearish["net_index"] == -90.0     # all bearish → −90
    assert mixed["net_index"] == 20.0        # (80 − 40) / 2


def test_empty_aggregate_is_neutral():
    agg = _aggregate([])
    assert agg["overall_sentiment"] == "Neutral"
    assert agg["net_index"] == 0.0
    assert agg["total"] == 0
