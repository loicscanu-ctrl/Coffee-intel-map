"""Fixture-based tests for the ICE Market Data SPA scraper.

The real endpoint can only be hit from CI (sandbox egress to theice.com is
blocked). These tests validate the parser against the three response shapes
we've seen ICE use across reports, plus the unit/contract mapping.
"""
from __future__ import annotations

import pytest

from scraper.sources.ice_certified_stocks import spa_api

# ── as_of parsing ─────────────────────────────────────────────────────────────

def test_parse_as_of_iso_date():
    assert spa_api._parse_as_of({"reportDate": "2026-05-29"}) == "2026-05-29"


def test_parse_as_of_iso_timestamp():
    assert spa_api._parse_as_of({"asOfDate": "2026-05-29T17:00:00Z"}) == "2026-05-29"


def test_parse_as_of_dd_mmm_yyyy():
    assert spa_api._parse_as_of({"asOf": "29-May-2026"}) == "2026-05-29"


def test_parse_as_of_missing_returns_none():
    assert spa_api._parse_as_of({}) is None
    assert spa_api._parse_as_of({"reportDate": ""}) is None


# ── warehouse parsing — three known shapes ───────────────────────────────────

def test_parse_warehouse_rows_shape_a():
    """ICE's primary shape: rows[] with warehouseName + value."""
    by, total = spa_api._parse_warehouse_rows({
        "rows": [
            {"warehouseName": "Antwerp", "value": 100_000},
            {"warehouseName": "Bremen",  "value":  50_000},
            {"warehouseName": "New York","value":  25_000},
        ],
        "total": 175_000,
    })
    assert by == {"Antwerp": 100_000, "Bremen": 50_000, "New York": 25_000}
    assert total == 175_000


def test_parse_warehouse_rows_shape_b():
    """data[] with name + total (alternate KC report shape)."""
    by, total = spa_api._parse_warehouse_rows({
        "data": [
            {"name": "Antwerp",   "total": 80_000},
            {"name": "Hamburg",   "total": 30_000},
        ],
    })
    assert by == {"Antwerp": 80_000, "Hamburg": 30_000}
    assert total == 110_000   # falls back to sum when no top-level total


def test_parse_warehouse_rows_shape_c():
    """warehouses[] with location + bags."""
    by, total = spa_api._parse_warehouse_rows({
        "warehouses": [
            {"location": "Antwerp", "bags": 100_000},
            {"location": "Bremen",  "bags":  50_000},
        ],
    })
    assert by == {"Antwerp": 100_000, "Bremen": 50_000}
    assert total == 150_000


def test_parse_warehouse_rows_empty():
    by, total = spa_api._parse_warehouse_rows({})
    assert by == {}
    assert total == 0


def test_parse_warehouse_rows_skips_malformed():
    by, total = spa_api._parse_warehouse_rows({
        "rows": [
            {"warehouseName": "Antwerp", "value": 100},
            {"warehouseName": "Bad",     "value": "not-a-number"},
            "garbage",
            {"value": 50},                # no name
        ],
    })
    assert by == {"Antwerp": 100}
    assert total == 100


# ── full parse_spa_response ──────────────────────────────────────────────────

ARABICA_FIXTURE = {
    "reportDate": "2026-05-29",
    "rows": [
        {"warehouseName": "Antwerp",  "value": 120_000},
        {"warehouseName": "Hamburg",  "value":  80_000},
        {"warehouseName": "New York", "value":  40_000},
    ],
    "total": 240_000,
}

ROBUSTA_FIXTURE = {
    "asOfDate": "2026-05-29T17:00:00Z",
    "rows": [
        {"warehouseName": "Antwerp", "value":  4_000},
        {"warehouseName": "Bremen",  "value":  2_500},
        {"warehouseName": "Genoa",   "value":  1_500},
    ],
}


def test_parse_arabica_full():
    out = spa_api.parse_spa_response("arabica", ARABICA_FIXTURE)
    assert out["market"] == "arabica"
    assert out["contract"] == "KC"
    assert out["unit"] == "bags"
    assert out["as_of"] == "2026-05-29"
    assert out["total"] == 240_000
    assert out["by_warehouse"]["Antwerp"] == 120_000
    assert out["raw"] is ARABICA_FIXTURE


def test_parse_robusta_full():
    out = spa_api.parse_spa_response("robusta", ROBUSTA_FIXTURE)
    assert out["market"] == "robusta"
    assert out["contract"] == "RC"
    assert out["unit"] == "lots"
    assert out["as_of"] == "2026-05-29"
    assert out["total"] == 8_000
    assert out["by_warehouse"]["Genoa"] == 1_500


def test_parse_unknown_market_rejected():
    with pytest.raises(ValueError):
        spa_api.parse_spa_response("colombia_milds", ARABICA_FIXTURE)


# ── live-call wrapper validates inputs without hitting the network ───────────

def test_fetch_unknown_market_rejected_before_network():
    with pytest.raises(ValueError):
        spa_api.fetch_spa("colombia_milds")
