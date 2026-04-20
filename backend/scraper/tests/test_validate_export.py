"""Tests for validate_export.py — each validator has a passing and a failing case."""
import pytest
from datetime import date, timedelta


def today_str():
    return date.today().isoformat()


def old_date_str():
    return (date.today() - timedelta(days=30)).isoformat()


# ── futures_chain ─────────────────────────────────────────────────────────────

def test_validate_futures_chain_passes():
    from scraper.validate_export import validate_futures_chain
    good = {
        "arabica": {"pub_date": today_str(), "contracts": [{}] * 6},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, reason = validate_futures_chain(good)
    assert ok, reason


def test_validate_futures_chain_missing_robusta():
    from scraper.validate_export import validate_futures_chain
    bad = {"arabica": {"pub_date": today_str(), "contracts": [{}] * 6}}
    ok, _ = validate_futures_chain(bad)
    assert not ok


def test_validate_futures_chain_stale():
    from scraper.validate_export import validate_futures_chain
    bad = {
        "arabica": {"pub_date": old_date_str(), "contracts": [{}] * 6},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, _ = validate_futures_chain(bad)
    assert not ok


def test_validate_futures_chain_too_few_contracts():
    from scraper.validate_export import validate_futures_chain
    bad = {
        "arabica": {"pub_date": today_str(), "contracts": [{}] * 3},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, _ = validate_futures_chain(bad)
    assert not ok


# ── farmer_economics ──────────────────────────────────────────────────────────

def test_validate_farmer_economics_passes():
    from scraper.validate_export import validate_farmer_economics
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    good = {
        "weather": {"regions": []},
        "fertilizer": {"items": [{"name": "Urea"}]},
        "scraped_at": now,
    }
    ok, reason = validate_farmer_economics(good)
    assert ok, reason


def test_validate_farmer_economics_null_weather():
    from scraper.validate_export import validate_farmer_economics
    bad = {"weather": None, "fertilizer": {"items": [{}]}, "scraped_at": "2099-01-01T00:00:00Z"}
    ok, _ = validate_farmer_economics(bad)
    assert not ok


def test_validate_farmer_economics_empty_fertilizer():
    from scraper.validate_export import validate_farmer_economics
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    bad = {"weather": {"regions": []}, "fertilizer": {"items": []}, "scraped_at": now}
    ok, _ = validate_farmer_economics(bad)
    assert not ok


# ── cot ───────────────────────────────────────────────────────────────────────

def test_validate_cot_passes():
    from scraper.validate_export import validate_cot
    good = [{"date": today_str(), "ny": {}, "ldn": {}}]
    ok, reason = validate_cot(good)
    assert ok, reason


def test_validate_cot_empty():
    from scraper.validate_export import validate_cot
    ok, _ = validate_cot([])
    assert not ok


def test_validate_cot_stale():
    from scraper.validate_export import validate_cot
    bad = [{"date": old_date_str()}]
    ok, _ = validate_cot(bad)
    assert not ok


# ── macro_cot ─────────────────────────────────────────────────────────────────

def test_validate_macro_cot_passes():
    from scraper.validate_export import validate_macro_cot
    ok, reason = validate_macro_cot([{"date": today_str()}])
    assert ok, reason


def test_validate_macro_cot_empty():
    from scraper.validate_export import validate_macro_cot
    ok, _ = validate_macro_cot([])
    assert not ok


# ── freight ───────────────────────────────────────────────────────────────────

def test_validate_freight_passes():
    from scraper.validate_export import validate_freight
    ok, reason = validate_freight({"routes": [{"name": "Santos-Hamburg"}], "history": []})
    assert ok, reason


def test_validate_freight_empty_routes():
    from scraper.validate_export import validate_freight
    ok, _ = validate_freight({"routes": [], "history": []})
    assert not ok


# ── oi_fnd_chart ──────────────────────────────────────────────────────────────

def test_validate_oi_fnd_chart_passes():
    from scraper.validate_export import validate_oi_fnd_chart
    ok, reason = validate_oi_fnd_chart({"arabica": [], "robusta": []})
    assert ok, reason


def test_validate_oi_fnd_chart_missing_key():
    from scraper.validate_export import validate_oi_fnd_chart
    ok, _ = validate_oi_fnd_chart({"arabica": []})
    assert not ok


# ── oi_history ────────────────────────────────────────────────────────────────

def test_validate_oi_history_passes():
    from scraper.validate_export import validate_oi_history
    ok, reason = validate_oi_history({"arabica": [{"date": today_str()}], "robusta": [{"date": today_str()}]})
    assert ok, reason


def test_validate_oi_history_empty():
    from scraper.validate_export import validate_oi_history
    ok, _ = validate_oi_history({"arabica": [], "robusta": [{"date": today_str()}]})
    assert not ok


# ── quant_report ──────────────────────────────────────────────────────────────

def test_validate_quant_report_passes():
    from scraper.validate_export import validate_quant_report
    ok, reason = validate_quant_report({"currency_index": [{"brl": 5.1}], "scraped_at": "2026-04-20"})
    assert ok, reason


def test_validate_quant_report_empty():
    from scraper.validate_export import validate_quant_report
    ok, _ = validate_quant_report({"currency_index": []})
    assert not ok


# ── cecafe_daily ──────────────────────────────────────────────────────────────

def test_validate_cecafe_daily_passes():
    from scraper.validate_export import validate_cecafe_daily
    ok, reason = validate_cecafe_daily({"updated": today_str(), "arabica": {"2026-04": 1000}, "conillon": {}})
    assert ok, reason


def test_validate_cecafe_daily_empty():
    from scraper.validate_export import validate_cecafe_daily
    ok, _ = validate_cecafe_daily({"updated": today_str(), "arabica": {}, "conillon": {}})
    assert not ok


# ── earnings ──────────────────────────────────────────────────────────────────

def test_validate_earnings_passes():
    from scraper.validate_export import validate_earnings
    ok, reason = validate_earnings({"scraped_at": today_str(), "companies": [{"ticker": "CAFE"}]})
    assert ok, reason


def test_validate_earnings_empty():
    from scraper.validate_export import validate_earnings
    ok, _ = validate_earnings({"scraped_at": today_str(), "companies": []})
    assert not ok


# ── kaffeesteuer ──────────────────────────────────────────────────────────────

def test_validate_kaffeesteuer_passes():
    from scraper.validate_export import validate_kaffeesteuer
    ok, reason = validate_kaffeesteuer({"2025-01": 12345, "2025-02": 11000})
    assert ok, reason


def test_validate_kaffeesteuer_empty():
    from scraper.validate_export import validate_kaffeesteuer
    ok, _ = validate_kaffeesteuer({})
    assert not ok


# ── safe_write_json ───────────────────────────────────────────────────────────

def test_safe_write_json_writes_on_pass(tmp_path):
    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    result = safe_write_json(dest, [{"date": "2026-04-01"}], validate_macro_cot)
    assert result is True
    assert dest.exists()


def test_safe_write_json_keeps_old_on_fail(tmp_path):
    import json
    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    dest.write_text(json.dumps([{"date": "2026-01-01"}]))
    result = safe_write_json(dest, [], validate_macro_cot)  # empty list fails
    assert result is False
    data = json.loads(dest.read_text())
    assert data == [{"date": "2026-01-01"}]   # old data preserved
