import pytest

def test_weather_snapshot_has_expected_columns():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import WeatherSnapshot
    cols = {c.name for c in WeatherSnapshot.__table__.columns}
    assert {"id", "region", "scraped_at", "daily_data"}.issubset(cols)

def test_fertilizer_import_has_expected_columns():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import FertilizerImport
    cols = {c.name for c in FertilizerImport.__table__.columns}
    assert {"id", "month", "ncm_code", "ncm_label", "net_weight_kg", "fob_usd", "scraped_at"}.issubset(cols)

def test_fertilizer_import_unique_constraint():
    from models import FertilizerImport
    constraints = {c.name for c in FertilizerImport.__table__.constraints}
    assert "uq_fert_import_month_ncm" in constraints
