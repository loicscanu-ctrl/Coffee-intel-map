"""Regression tests for the synthesis-xlsx importer.

Today the only coverage is the aggregate-port filter (workbook pivot rows
labelled "TOTAL" must not be treated as a real port — that bug double-counted
the arabica grand total by ~2x in v3 of the certified-stocks panel).
"""
from __future__ import annotations

from importlib import import_module
from pathlib import Path
import sys

# The importer lives in backend/scripts/ which isn't on the package path.
_THIS = Path(__file__).resolve()
sys.path.insert(0, str(_THIS.parents[1] / "scripts"))

mod = import_module("import_synthesis_xlsx")


def test_is_aggregate_port_recognises_total_variants():
    for code in ("TOTAL", "Total", "total", " TOTAL ", "GRAND TOTAL",
                 "GrandTotal", "All", "SUM", "TOT"):
        assert mod._is_aggregate_port(code), f"expected aggregate: {code!r}"


def test_is_aggregate_port_keeps_real_ports():
    for code in ("ANT", "HAM", "NO", "NY", "HOU", "MIA", "NYK", "HA/BR",
                 "LON", "ROT", "AMS", "BAR"):
        assert not mod._is_aggregate_port(code), f"expected real port: {code!r}"


def test_is_aggregate_port_handles_empty():
    assert not mod._is_aggregate_port("")
    assert not mod._is_aggregate_port(None or "")
