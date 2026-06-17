"""Tests for scraper.build_balance_sheets — the semi-annual USDA refresh
that keeps the per-origin balance-sheet seed files in sync with the live
demand_stocks.json USDA pipeline."""
from __future__ import annotations

import json

from scraper import build_balance_sheets as bbs


def test_usda_by_start_year_converts_mt_to_mbags():
    demand = {"producers": {"brazil": {"annual": [
        {"year": "2024", "production_mt": 3_900_000},
        {"year": "2025", "production_mt": 3_780_000},
    ]}}}
    out = bbs._usda_by_start_year(demand, "brazil")
    assert out == {2024: 65.0, 2025: 63.0}


def test_usda_by_start_year_skips_missing_production():
    demand = {"producers": {"uganda": {"annual": [
        {"year": "2023", "production_mt": None},
        {"year": "2024", "production_mt": 402_000},
        {"year": "bad",  "production_mt": 1_000},
    ]}}}
    out = bbs._usda_by_start_year(demand, "uganda")
    assert out == {2024: 6.7}


def test_season_start_year():
    assert bbs._season_start_year("2025/26") == 2025
    assert bbs._season_start_year("2022/23") == 2022
    assert bbs._season_start_year("garbage") is None


def test_refresh_origin_syncs_usda_and_preserves_other_sources(tmp_path, monkeypatch):
    seed = {
        "unit": "million 60-kg bags",
        "note": "x",
        "updated": "2025-12",
        "sources": [{"key": "usda"}, {"key": "ico"}],
        "seasons": [
            {"season": "2024/25", "forecast": False,
             "production": {"usda": 6.0, "ico": 7.1}},
            {"season": "2025/26", "forecast": True,
             "production": {"usda": 6.9}},
        ],
    }
    f = tmp_path / "ug_balance_sheet.json"
    f.write_text(json.dumps(seed))
    monkeypatch.setattr(bbs, "DATA", tmp_path)

    demand = {"producers": {"uganda": {"annual": [
        {"year": "2024", "production_mt": 402_000},   # → 6.7
        {"year": "2025", "production_mt": 414_000},   # → 6.9 (unchanged)
    ]}}}
    changes = bbs.refresh_origin("uganda", "ug_balance_sheet.json", demand)

    written = json.loads(f.read_text())
    # USDA refreshed on the stale row…
    assert written["seasons"][0]["production"]["usda"] == 6.7
    # …ICO (a manual source) untouched…
    assert written["seasons"][0]["production"]["ico"] == 7.1
    # …in-sync row left alone.
    assert written["seasons"][1]["production"]["usda"] == 6.9
    assert any("2024/25" in c for c in changes)


def test_refresh_origin_flags_newer_usda_crop(tmp_path, monkeypatch):
    seed = {
        "sources": [{"key": "usda"}],
        "seasons": [{"season": "2025/26", "forecast": True,
                     "production": {"usda": 6.9}}],
    }
    f = tmp_path / "ug_balance_sheet.json"
    f.write_text(json.dumps(seed))
    monkeypatch.setattr(bbs, "DATA", tmp_path)

    demand = {"producers": {"uganda": {"annual": [
        {"year": "2025", "production_mt": 414_000},
        {"year": "2026", "production_mt": 420_000},   # newer than seed
    ]}}}
    changes = bbs.refresh_origin("uganda", "ug_balance_sheet.json", demand)
    assert any("2026/27" in c and "add a season row" in c for c in changes)


def test_refresh_origin_idempotent(tmp_path, monkeypatch):
    seed = {
        "sources": [{"key": "usda"}],
        "seasons": [{"season": "2024/25", "forecast": False,
                     "production": {"usda": 6.7}}],
    }
    f = tmp_path / "ug_balance_sheet.json"
    f.write_text(json.dumps(seed))
    monkeypatch.setattr(bbs, "DATA", tmp_path)

    demand = {"producers": {"uganda": {"annual": [
        {"year": "2024", "production_mt": 402_000},   # → 6.7, already set
    ]}}}
    changes = bbs.refresh_origin("uganda", "ug_balance_sheet.json", demand)
    assert changes == []
