from __future__ import annotations

from scraper.sources._imports_util import merge_monthly, merge_origin_monthly


def test_merge_monthly_extends_history_and_revises():
    old = {"2024-01": 100.0, "2024-02": 110.0}
    new = {"2024-02": 115.0, "2024-03": 120.0}          # revises Feb, adds Mar
    out = merge_monthly(old, new)
    assert out == {"2024-01": 100.0, "2024-02": 115.0, "2024-03": 120.0}
    assert list(out) == ["2024-01", "2024-02", "2024-03"]   # sorted


def test_merge_monthly_handles_none_and_drops_null_values():
    assert merge_monthly(None, None) == {}
    assert merge_monthly({"2024-01": 5.0}, None) == {"2024-01": 5.0}
    # a None in `new` must not wipe an existing month
    assert merge_monthly({"2024-01": 5.0}, {"2024-01": None}) == {"2024-01": 5.0}  # type: ignore[dict-item]


def test_merge_origin_monthly_keys_by_name():
    old = [{"name": "Brazil", "monthly": {"2024-01": 10.0}}]
    new = [{"name": "Brazil", "monthly": {"2024-02": 12.0}},
           {"name": "Colombia", "monthly": {"2024-02": 3.0}}]
    out = merge_origin_monthly(old, new)
    bra = next(o for o in out if o["name"] == "Brazil")
    assert bra["monthly"] == {"2024-01": 10.0, "2024-02": 12.0}   # history preserved
    col = next(o for o in out if o["name"] == "Colombia")
    assert col["monthly"] == {"2024-02": 3.0}                     # new origin untouched
