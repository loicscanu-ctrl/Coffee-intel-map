"""Tests for scraper.enso_analogs — pure ONI parsing + analog matching."""
from scraper.enso_analogs import (
    aligned_series,
    current_trajectory,
    find_analogs,
    parse_oni_series,
)

SAMPLE_ONI = """\
SEAS YR TOTAL ANOM
DJF 1979 0.1 0.0
DJF 1980 0.2 0.6
JFM 1980 0.3 0.5
FMA 1980 0.4 0.4
MAM 1997 0.5 0.4
AMJ 1997 0.6 0.8
JJA 1997 1.0 1.6
NDJ 1997 2.5 2.4
"""


def test_parse_skips_pre_1980_and_header():
    series = parse_oni_series(SAMPLE_ONI, since_year=1980)
    years = {r["year"] for r in series}
    assert 1979 not in years            # dropped: before since_year
    assert series[0]["label"] == "Jan-80"   # DJF → centre month Jan
    assert series[-1]["value"] == 2.4
    # sorted chronologically
    assert series == sorted(series, key=lambda r: (r["year"], r["month"]))


def test_parse_handles_garbage_rows():
    text = SAMPLE_ONI + "not a row\nXYZ 1980 a b\n"
    series = parse_oni_series(text)
    assert all(isinstance(r["value"], float) for r in series)


def _series_from(year_vals: dict[int, list[float]]) -> list[dict]:
    """Build a 12-month/year synthetic ONI series from {year: [12 vals]}."""
    out = []
    for year in sorted(year_vals):
        for m, v in enumerate(year_vals[year], start=1):
            out.append({"year": year, "month": m, "label": f"m{m}-{year}", "value": v})
    return out


def test_find_analogs_ranks_exact_match_first():
    # 2000 is a flat line; 2010 exactly equals the current (2020) tail; 2005 is noisy.
    series = _series_from({
        2000: [0.0] * 12,
        2005: [1.0, -1.0] * 6,
        2010: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
        2020: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
    })
    analogs = find_analogs(series, n=6, top=3)
    assert analogs[0]["year"] == 2010          # identical trajectory → MSE ~0
    assert analogs[0]["mse"] == 0.0
    assert [a["year"] for a in analogs] == sorted(
        [a["year"] for a in analogs], key=lambda y: next(x["mse"] for x in analogs if x["year"] == y)
    )


def test_find_analogs_excludes_current_year():
    series = _series_from({2010: [0.5] * 12, 2020: [0.5] * 12})
    analogs = find_analogs(series, n=6, top=3)
    assert all(a["year"] != 2020 for a in analogs)


def test_aligned_series_offsets_and_forward():
    series = _series_from({2015: [round(0.1 * i, 1) for i in range(1, 13)]})
    aligned = aligned_series(series, end_year=2015, end_month=6, back=2, fwd=3)
    offsets = [p["offset"] for p in aligned]
    assert offsets == [-2, -1, 0, 1, 2, 3]
    zero = next(p for p in aligned if p["offset"] == 0)
    assert zero["value"] == 0.6              # month 6 == 0.6


def test_current_trajectory_returns_last_n():
    series = _series_from({2020: list(range(12))})
    traj = current_trajectory(series, n=6)
    assert [p["value"] for p in traj] == [6, 7, 8, 9, 10, 11]
