"""Contract tests for the deterministic news-sentiment classifier.

Pins each rule so an upstream change in body/meta shape doesn't silently
demote items back to Gemini-only classification (the symptom would be
that ~50% of the news feed quietly loses its pill).
"""
import json

from scraper.classify_sentiment import classify_news_item


def _item(**kw) -> dict:
    """Build a news-row dict; meta is JSON-stringified to match exporter shape."""
    if "meta" in kw and isinstance(kw["meta"], (dict, list)):
        kw["meta"] = json.dumps(kw["meta"])
    return kw


# ── ICE OI Snapshot ──────────────────────────────────────────────────────────

def test_ice_oi_snapshot_price_up_new_longs_is_bullish():
    out = classify_news_item(_item(
        source="ICE",
        title="ICE-EU RC Daily OI Snapshot – 2026-06-22",
        body="OI changed by +1200 over the last session. Technical view: PRICE UP, NEW LONGS.",
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"
    assert "new longs" in out["reason"].lower()


def test_ice_oi_snapshot_price_down_long_liquidation_is_bearish():
    out = classify_news_item(_item(
        source="ICE",
        title="IFUS KC Daily OI Snapshot – 2026-06-22",
        body="Technical view: PRICE DOWN, LONG LIQUIDATION.",
    ))
    assert out is not None
    assert out["sentiment"] == "Bearish"


def test_ice_oi_snapshot_no_view_falls_to_neutral_not_none():
    out = classify_news_item(_item(
        source="ICE",
        title="ICE-EU RC Daily OI Snapshot – 2026-06-22",
        body="OI changed by +5.",
    ))
    # We claim the snapshot territory — emit Neutral rather than passing
    # to Gemini, since Gemini will also fail to extract direction here.
    assert out is not None
    assert out["sentiment"] == "Neutral"


def test_ice_cot_not_matched_by_oi_rule():
    """ICE COT (not Daily OI Snapshot) must fall through to the COT rule."""
    out = classify_news_item(_item(
        source="ICE",
        title="ICE COT Robusta Coffee (London) – 2026-06-16",
        body="Some COT release text.",
        meta={"mm": {"d_long": 5000, "d_short": 1000}},
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"   # 4000 net add → bullish


# ── Agronomic (Open-Meteo + NOAA STAR) ───────────────────────────────────────

def test_agronomic_two_regions_at_risk_is_strong_bullish():
    out = classify_news_item(_item(
        source="Open-Meteo + NOAA STAR",
        title="Ethiopia Agronomic Status – 2026-06-24",
        body="At drought risk.",
        meta={"origin": "ethiopia", "evaluation": {"at_risk_count": 2, "checked_count": 5}},
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"
    assert out["confidence"] >= 85.0
    assert "Ethiopia" in out["reason"]


def test_agronomic_one_region_at_risk_is_medium_bullish():
    out = classify_news_item(_item(
        source="Open-Meteo + NOAA STAR",
        title="Brazil Agronomic Status – 2026-06-24",
        meta={"origin": "brazil", "evaluation": {"at_risk_count": 1}},
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"
    assert out["confidence"] < 85.0


def test_agronomic_zero_at_risk_is_neutral():
    out = classify_news_item(_item(
        source="Open-Meteo + NOAA STAR",
        title="Colombia Agronomic Status – 2026-06-24",
        meta={"origin": "colombia", "evaluation": {"at_risk_count": 0}},
    ))
    assert out is not None
    assert out["sentiment"] == "Neutral"


# ── Barchart front-month price move ──────────────────────────────────────────

def test_barchart_front_up_is_bullish():
    out = classify_news_item(_item(
        source="Barchart",
        title="ICE NY Arabica (KC) Futures – 2026-06-22",
        meta={"contracts": [{"symbol": "KCN26", "chg": 5.5, "last": 277.0}]},
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"


def test_barchart_front_down_is_bearish():
    out = classify_news_item(_item(
        source="Barchart",
        title="ICE London Robusta (RM) Futures – 2026-06-22",
        meta={"contracts": [{"symbol": "RMN26", "chg": -51.0, "last": 3589.0}]},
    ))
    assert out is not None
    assert out["sentiment"] == "Bearish"


def test_barchart_large_move_is_strong_confidence():
    out = classify_news_item(_item(
        source="Barchart",
        meta={"contracts": [{"symbol": "KCN26", "chg": 10.0, "last": 250.0}]},  # +4%
    ))
    assert out is not None
    assert out["confidence"] >= 85.0


def test_barchart_missing_contracts_returns_none():
    out = classify_news_item(_item(source="Barchart", meta={}))
    assert out is None


# ── CFTC / ICE COT ───────────────────────────────────────────────────────────

def test_cftc_cot_large_mm_net_add_is_strong_bullish():
    out = classify_news_item(_item(
        source="CFTC",
        title="CFTC COT Coffee C (NY Arabica) – 2026-06-16",
        meta={"mm": {"d_long": 8000, "d_short": -2000}},  # net +10,000
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"
    assert out["confidence"] >= 85.0
    assert "KC arabica" in out["reason"]


def test_cftc_cot_large_mm_net_cut_is_strong_bearish():
    out = classify_news_item(_item(
        source="CFTC",
        title="CFTC COT Coffee C (NY Arabica) – 2026-06-16",
        meta={"mm": {"d_long": -5000, "d_short": 2000}},  # net -7,000
    ))
    assert out is not None
    assert out["sentiment"] == "Bearish"


def test_cftc_cot_tiny_change_is_neutral():
    out = classify_news_item(_item(
        source="CFTC",
        title="CFTC COT Coffee C (NY Arabica) – 2026-06-16",
        meta={"mm": {"d_long": 200, "d_short": -100}},  # net +300, sub-threshold
    ))
    assert out is not None
    assert out["sentiment"] == "Neutral"


# ── Cecafe Brazil daily exports ──────────────────────────────────────────────

def test_cecafe_strong_yoy_increase_is_strong_bearish():
    """Higher Brazil exports = more supply = bearish (user-confirmed direction)."""
    out = classify_news_item(_item(
        source="Cecafe",
        title="Brazil Coffee Exports (Cecafe) – 2026-06-24",
        body="Brazil coffee export data: Issuance | 2,489,859 | 15.0",
    ))
    assert out is not None
    assert out["sentiment"] == "Bearish"
    assert out["confidence"] >= 85.0


def test_cecafe_strong_yoy_drop_is_strong_bullish():
    out = classify_news_item(_item(
        source="Cecafe",
        body="Brazil coffee export data: Issuance | 1,800,000 | -12.5",
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"


def test_cecafe_within_noise_is_neutral():
    out = classify_news_item(_item(
        source="Cecafe",
        body="Brazil coffee export data: Issuance | 2,000,000 | 1.5",
    ))
    assert out is not None
    assert out["sentiment"] == "Neutral"


# ── ENSO ONI ─────────────────────────────────────────────────────────────────

def test_enso_strong_la_nina_is_bullish():
    out = classify_news_item(_item(
        source="NOAA CPC",
        title="ENSO ONI – 2026-06",
        meta={"oni_history": [{"month": "Jun-26", "value": -1.2}]},
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"
    assert "La Niña" in out["reason"]


def test_enso_strong_el_nino_is_bullish():
    out = classify_news_item(_item(
        source="NOAA CPC",
        meta={"oni_history": [{"month": "Jun-26", "value": 1.5}]},
    ))
    assert out is not None
    assert out["sentiment"] == "Bullish"
    assert "El Niño" in out["reason"]


def test_enso_mild_phase_is_neutral():
    out = classify_news_item(_item(
        source="NOAA CPC",
        meta={"oni_history": [{"month": "Jun-26", "value": 0.3}]},
    ))
    assert out is not None
    assert out["sentiment"] == "Neutral"


# ── Fallthrough ──────────────────────────────────────────────────────────────

def test_unknown_source_returns_none():
    """Sprudge build-outs, single-day price labels, etc. — defer to Gemini."""
    out = classify_news_item(_item(
        source="Sprudge",
        title="Build-Outs Of Coffee: Bird Dog Coffee In Laguna Hills, CA",
        body="Bird Dog Coffee in Laguna Hills, California.",
    ))
    assert out is None


def test_malformed_meta_does_not_crash():
    """A bad JSON string in meta must not break the export."""
    out = classify_news_item({
        "source": "CFTC",
        "title": "CFTC COT Coffee C – 2026-06-16",
        "meta": "not valid json {",
    })
    # No d_long / d_short available → rule can't classify → returns None.
    assert out is None
