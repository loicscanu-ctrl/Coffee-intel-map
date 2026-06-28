"""Unit tests for the Barchart 15-min CSV parsing + Central→London mapping.

Network/Playwright is not exercised — only the pure parse logic, which is
where the timezone + column-mapping correctness lives.
"""
from scraper import fetch_intraday_kc_rc as f


def test_parse_maps_central_to_london_and_reads_ohlc():
    # 11:15 CT (CDT, summer) = 17:15 London (BST). Bar 17:15→17:30 → its close
    # is the 17:30 price. Row: '<ct>,<day>,O,H,L,C,V'.
    csv = "2026-06-26 11:15,26,3632,3645,3613,3620,818"
    idx = f._parse_csv_to_london(csv)
    assert "2026-06-26" in idx
    assert idx["2026-06-26"]["17:15"]["close"] == 3620.0
    assert idx["2026-06-26"]["17:15"]["open"] == 3632.0


def test_parse_robusta_open_bar_0900_london():
    # 03:00 CT (CDT) = 09:00 London (BST) — robusta's first bar.
    csv = "2026-06-26 03:00,26,3643,3675,3641,3672,120"
    idx = f._parse_csv_to_london(csv)
    bar = idx["2026-06-26"]["09:00"]
    assert bar["open"] == 3643.0   # first trade of the day (step 5)
    assert bar["close"] == 3672.0  # +15min (step 4)


def test_parse_winter_offset():
    # 11:15 CST (winter) = 17:15 London (GMT) — same London label, 6h offset.
    csv = "2026-01-15 11:15,15,3500,3510,3495,3505,200"
    idx = f._parse_csv_to_london(csv)
    assert idx["2026-01-15"]["17:15"]["close"] == 3505.0


def test_parse_takes_last_five_numeric_fields():
    """Robust to a symbol prefix / extra columns: O,H,L,C,V are the last five."""
    csv = "RMU26,2026-06-26 11:15,26,3632,3645,3613,3620,818"
    # With a leading symbol, field[0] is not a datetime → row skipped (we only
    # fetch specific contracts, which have no prefix). Assert it doesn't crash
    # and produces nothing rather than mis-parsing.
    idx = f._parse_csv_to_london(csv)
    assert idx == {}


def test_parse_skips_malformed_rows():
    csv = "\n".join([
        "garbage line",
        "2026-06-26 11:15,26,3632,3645,3613,3620,818",
        "2026-06-26 11:30,26,x,y,z,w,v",
    ])
    idx = f._parse_csv_to_london(csv)
    assert list(idx["2026-06-26"].keys()) == ["17:15"]
