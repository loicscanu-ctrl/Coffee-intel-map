"""
Wire-format lock for the cot_weekly serializer.

Both routes/cot.py and scraper/export_static_json.py used to hand-roll the
same ~50-field dict. cot_schema.serialize_cot_row generates it instead. The
exact key set and order is part of the API/JSON contract — these tests fail
loudly if anything regresses.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cot_schema import serialize_cot_row


class _StubRow:
    """Mimics a CotWeekly ORM row by exposing every column as an attribute."""
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


# Frozen list of keys the API has historically returned (no crop split).
# Keep this hand-written — it's the contract test, not a copy of the code.
_API_KEYS_IN_ORDER = [
    "oi_total",
    # Positions
    "pmpu_long", "pmpu_short",
    "swap_long", "swap_short", "swap_spread",
    "mm_long",   "mm_short",   "mm_spread",
    "other_long","other_short","other_spread",
    "nr_long",   "nr_short",
    # Trader counts
    "t_pmpu_long", "t_pmpu_short",
    "t_swap_long", "t_swap_short", "t_swap_spread",
    "t_mm_long",   "t_mm_short",   "t_mm_spread",
    "t_other_long","t_other_short","t_other_spread",
    "t_nr_long",   "t_nr_short",
    # Per-market extras
    "price_ny", "price_ldn",
    "structure_ny", "structure_ldn",
    "exch_oi_ny", "exch_oi_ldn",
    "vol_ny", "vol_ldn",
    "efp_ny", "efp_ldn",
    "spread_vol_ny", "spread_vol_ldn",
]

_CROP_SPLIT_KEYS_IN_ORDER = [
    # Old-crop split — NY (Arabica) only at runtime, but the field set is fixed
    "pmpu_long_old", "pmpu_short_old",
    "swap_long_old", "swap_short_old", "swap_spread_old",
    "mm_long_old",   "mm_short_old",   "mm_spread_old",
    "other_long_old","other_short_old","other_spread_old",
    "nr_long_old",   "nr_short_old",
    # Other-crop split
    "pmpu_long_other", "pmpu_short_other",
    "swap_long_other", "swap_short_other", "swap_spread_other",
    "mm_long_other",   "mm_short_other",   "mm_spread_other",
    "other_long_other","other_short_other","other_spread_other",
    "nr_long_other",   "nr_short_other",
]


def test_api_shape_keys_and_order():
    row = _StubRow()
    out = serialize_cot_row(row, include_crop_split=False)
    assert list(out.keys()) == _API_KEYS_IN_ORDER


def test_export_shape_includes_crop_split_in_correct_position():
    row = _StubRow()
    out = serialize_cot_row(row, include_crop_split=True)
    # Crop split sits between trader counts and per-market extras —
    # right after t_nr_short, right before price_ny.
    pivot = out_keys = list(out.keys())
    t_nr_short_idx  = pivot.index("t_nr_short")
    price_ny_idx    = pivot.index("price_ny")
    crop_block      = pivot[t_nr_short_idx + 1 : price_ny_idx]
    assert crop_block == _CROP_SPLIT_KEYS_IN_ORDER


def test_values_passthrough_from_row_attributes():
    row = _StubRow(
        oi_total=150_000, mm_long=25_000, mm_short=12_000, mm_spread=3_000,
        pmpu_long=80_000, pmpu_short=40_000,
        swap_long=15_000, swap_short=22_000, swap_spread=1_500,
        nr_long=4_000, nr_short=3_000,
        t_mm_long=30, price_ny=304.10, structure_ldn=-12.0,
    )
    out = serialize_cot_row(row, include_crop_split=False)
    assert out["oi_total"]      == 150_000
    assert out["mm_long"]       == 25_000
    assert out["mm_spread"]     == 3_000
    assert out["pmpu_long"]     == 80_000
    assert out["swap_spread"]   == 1_500
    assert out["nr_long"]       == 4_000
    assert out["t_mm_long"]     == 30
    assert out["price_ny"]      == 304.10
    assert out["structure_ldn"] == -12.0
    # Unset attrs default to None
    assert out["t_swap_long"]   is None
    assert out["efp_ldn"]       is None


def test_pmpu_and_nr_have_no_spread_fields():
    keys = serialize_cot_row(_StubRow(), include_crop_split=True).keys()
    forbidden = {"pmpu_spread", "nr_spread", "pmpu_spread_old", "nr_spread_old",
                 "pmpu_spread_other", "nr_spread_other",
                 "t_pmpu_spread", "t_nr_spread"}
    assert forbidden.isdisjoint(keys)


def test_total_field_count_matches_api_contract():
    api_out      = serialize_cot_row(_StubRow(), include_crop_split=False)
    full_out     = serialize_cot_row(_StubRow(), include_crop_split=True)
    assert len(api_out)  == len(_API_KEYS_IN_ORDER)
    assert len(full_out) == len(_API_KEYS_IN_ORDER) + len(_CROP_SPLIT_KEYS_IN_ORDER)
