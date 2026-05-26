"""Tests for the VHI scraper's parsing + bbox aggregation (no live NOAA fetch)."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

import fetch_vhi as v  # noqa: E402

CSV = """latitude,longitude,VHI
-21.6,-45.4,55.0
-21.5,-45.5,65.0
-18.9,-47.0,40.0
0.0,0.0,-999
9.9,9.9,200
bad,row,here
"""


def test_parse_detects_columns_and_filters():
    rows = v.parse_vhi_csv(CSV)
    # -999 (out of 0–100), 200 (out of range), and the non-numeric row are dropped
    assert (-21.6, -45.4, 55.0) in rows
    assert (-21.5, -45.5, 65.0) in rows
    assert (-18.9, -47.0, 40.0) in rows
    assert len(rows) == 3


def test_parse_column_order_independent():
    rows = v.parse_vhi_csv("VHI,LON,LAT\n70,-45.4,-21.6\n")
    assert rows == [(-21.6, -45.4, 70.0)]


def test_region_vhi_bbox_mean():
    rows = v.parse_vhi_csv(CSV)
    # Sul de Minas ≈ (-21.55,-45.43): the two ~-21.5 points avg to 60.0;
    # the -18.9 point is outside ±0.75°.
    assert v.region_vhi(rows, -21.55, -45.43) == 60.0
    # a point with nothing nearby → None
    assert v.region_vhi(rows, 50.0, 50.0) is None


def test_parse_empty_or_headerless():
    assert v.parse_vhi_csv("") == []
    assert v.parse_vhi_csv("foo,bar\n1,2\n") == []   # no lat/lon header → nothing


def test_apply_to_weather_additive(tmp_path, monkeypatch):
    # minimal brazil_weather.json with two provinces matching ORIGINS names
    doc = {"provinces": [{"name": "Sul de Minas", "monthly_avg_rain": [1]},
                         {"name": "Cerrado", "monthly_avg_rain": [1]}]}
    monkeypatch.setattr(v, "DATA_DIR", tmp_path)
    (tmp_path / "brazil_weather.json").write_text(json.dumps(doc), encoding="utf-8")
    rows = v.parse_vhi_csv(CSV)
    n = v.apply_to_weather("brazil", rows, "2026-W21", write=True)
    assert n >= 1
    out = json.loads((tmp_path / "brazil_weather.json").read_text())
    sul = next(p for p in out["provinces"] if p["name"] == "Sul de Minas")
    assert sul["vhi"] == 60.0                 # additive field added
    assert sul["monthly_avg_rain"] == [1]     # existing field intact
    assert out["vhi_week"] == "2026-W21"
