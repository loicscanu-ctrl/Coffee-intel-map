"""Tests for the VHI scraper — bbox grid-mean + NetCDF reader. No live NOAA fetch."""
import json
import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

import fetch_vhi as v  # noqa: E402


def _grid():
    # 0.5° grid covering Brazil's SE; VHI = 60 over a Sul-de-Minas patch, 30 elsewhere.
    lats = np.arange(-15.0, -25.0, -0.5)   # N→S
    lons = np.arange(-50.0, -40.0, 0.5)
    vhi = np.full((lats.size, lons.size), 30.0)
    # mark cells within ~0.75° of Sul de Minas (-21.55,-45.43) as 60
    for i, la in enumerate(lats):
        for j, lo in enumerate(lons):
            if abs(la - -21.55) <= 0.75 and abs(lo - -45.43) <= 0.75:
                vhi[i, j] = 60.0
    return lats, lons, vhi


def test_grid_region_mean_bbox():
    lats, lons, vhi = _grid()
    assert v.grid_region_mean(lats, lons, vhi, -21.55, -45.43) == 60.0   # the patch
    assert v.grid_region_mean(lats, lons, vhi, -16.0, -49.0) == 30.0     # background
    assert v.grid_region_mean(lats, lons, vhi, 10.0, 10.0) is None       # outside grid


def test_grid_region_mean_drops_fill_values():
    lats = np.array([-21.5, -21.6])
    lons = np.array([-45.4, -45.5])
    vhi = np.array([[60.0, np.nan], [-999.0, 70.0]])   # NaN + out-of-range fill dropped
    assert v.grid_region_mean(lats, lons, vhi, -21.55, -45.45, delta=0.5) == 65.0


def test_read_vhi_netcdf_roundtrip(tmp_path):
    # Write a synthetic NOAA-like NetCDF and confirm the reader extracts it.
    # netCDF4 is only installed in the 0.5 VHI workflow, not the 9.1 test env.
    Dataset = pytest.importorskip("netCDF4").Dataset
    p = tmp_path / "VHP.nc"
    ds = Dataset(p, "w", format="NETCDF4")
    ds.createDimension("latitude", 4)
    ds.createDimension("longitude", 5)
    la = ds.createVariable("latitude", "f4", ("latitude",)); la[:] = [-15, -18, -21, -24]
    lo = ds.createVariable("longitude", "f4", ("longitude",)); lo[:] = [-50, -48, -46, -44, -42]
    vv = ds.createVariable("VHI", "f4", ("latitude", "longitude")); vv[:] = np.full((4, 5), 55.0)
    ds.close()
    grid = v.read_vhi_netcdf(p.read_bytes())
    assert grid is not None
    lats, lons, vhi = grid
    assert vhi.shape == (4, 5)
    assert lats[0] == -15 and lons[-1] == -42
    assert v.grid_region_mean(lats, lons, vhi, -21, -46, delta=1.0) == 55.0


def test_read_vhi_netcdf_derives_grid_without_coords(tmp_path):
    # No lat/lon vars → reader derives a regular grid from NOAA bounds.
    Dataset = pytest.importorskip("netCDF4").Dataset
    p = tmp_path / "VHP_nocoord.nc"
    ds = Dataset(p, "w", format="NETCDF4")
    ds.createDimension("y", 10); ds.createDimension("x", 20)
    ds.createVariable("VHI", "f4", ("y", "x"))[:] = np.full((10, 20), 42.0)
    ds.close()
    grid = v.read_vhi_netcdf(p.read_bytes())
    assert grid is not None
    lats, lons, vhi = grid
    assert vhi.shape == (10, 20)
    assert abs(lats[0] - v.GRID_LAT_TOP) < 1e-6 and abs(lons[0] - v.GRID_LON_LEFT) < 1e-6


def test_apply_to_weather_additive(tmp_path, monkeypatch):
    doc = {"provinces": [{"name": "Sul de Minas", "monthly_avg_rain": [1]}]}
    monkeypatch.setattr(v, "DATA_DIR", tmp_path)
    (tmp_path / "brazil_weather.json").write_text(json.dumps(doc), encoding="utf-8")
    grid = _grid()
    n = v.apply_to_weather("brazil", grid, "2026-W21", write=True)
    assert n == 1
    out = json.loads((tmp_path / "brazil_weather.json").read_text())
    prov = out["provinces"][0]
    assert prov["vhi"] == 60.0
    assert prov["monthly_avg_rain"] == [1]     # existing field intact
    assert out["vhi_week"] == "2026-W21"
