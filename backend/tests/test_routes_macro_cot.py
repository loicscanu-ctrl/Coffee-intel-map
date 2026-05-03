
import pytest


def test_contract_value_usd_per_bbl():
    """usd_per_bbl: price × contract_unit."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _to_contract_value

    spec = {"price_unit": "usd_per_bbl", "contract_unit": 1000}
    assert _to_contract_value(80.0, spec) == pytest.approx(80_000.0)


def test_contract_value_usd_per_lb():
    """usd_per_lb: price × contract_unit."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _to_contract_value

    spec = {"price_unit": "usd_per_lb", "contract_unit": 37500}
    assert _to_contract_value(3.0, spec) == pytest.approx(112_500.0)


def test_exposure_calc_null_price():
    """gross/net exposure is None when price missing."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _compute_exposures

    spec = {"price_unit": "usd_per_lb", "contract_unit": 37500}
    result = _compute_exposures(mm_long=100, mm_short=50, mm_spread=10,
                                close_price=None, spec=spec)
    assert result["gross_exposure_usd"] is None
    assert result["net_exposure_usd"] is None


def test_exposure_calc_with_price():
    """All fields populated when price present."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from routes.macro_cot import _compute_exposures

    spec = {"price_unit": "usd_per_bbl", "contract_unit": 1000}
    result = _compute_exposures(mm_long=200, mm_short=100, mm_spread=20,
                                close_price=80.0, spec=spec)
    assert result["gross_exposure_usd"] == pytest.approx((200 + 100) * 80_000.0)
    assert result["net_exposure_usd"]   == pytest.approx((200 - 100) * 80_000.0)
