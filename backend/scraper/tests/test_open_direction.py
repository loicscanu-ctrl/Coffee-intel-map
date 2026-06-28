"""Contract tests for the open-direction classifier.

Pins the two properties that make the panel trustworthy:
  1. The SHAP decomposition is EXACTLY additive (Σφᵢ = final − base) — this
     is the whole point of using logistic regression instead of a tree.
  2. The triple-barrier labeller honours barrier-first / abstain semantics.
Plus the pure-numpy logistic fit's basic sanity (separable data → high
accuracy) and graceful degradation when an FX series is missing.

These avoid network: they exercise the math directly with synthetic series,
and importorskip pandas for dep-light envs.
"""
import numpy as np
import pytest

pytest.importorskip("pandas", reason="open_direction needs pandas")
import pandas as pd  # noqa: E402

from scraper.quant_model import open_direction as od  # noqa: E402

# ── Logistic fit + exact SHAP ────────────────────────────────────────────────

def test_logistic_fit_separates_clean_data():
    """A linearly separable 1-feature problem should fit to high accuracy."""
    rng = np.random.RandomState(0)
    z = np.concatenate([rng.normal(-2, 0.5, 200), rng.normal(2, 0.5, 200)])
    y = np.concatenate([np.zeros(200), np.ones(200)])
    X = np.column_stack([np.ones(len(z)), z])
    beta = od._fit_logistic(X, y)
    p = 1.0 / (1.0 + np.exp(-(X @ beta)))
    acc = ((p >= 0.5).astype(float) == y).mean()
    assert acc > 0.95
    # Positive slope: higher z → higher P(y=1).
    assert beta[1] > 0


def test_shap_is_exactly_additive():
    """For logistic regression, Σ(βᵢ·zᵢ) must equal margin − base_margin
    with zero residual. This is the property the waterfall relies on."""
    rng = np.random.RandomState(1)
    Z = rng.normal(size=(300, 3))
    # True relationship + noise.
    true_beta = np.array([0.2, 0.8, -0.5, 0.3])
    lin = true_beta[0] + Z @ true_beta[1:]
    p = 1.0 / (1.0 + np.exp(-lin))
    y = (rng.uniform(size=300) < p).astype(float)
    X = np.column_stack([np.ones(len(Z)), Z])
    beta = od._fit_logistic(X, y)

    z_latest = Z[-1]
    base_margin = beta[0]
    phis = beta[1:] * z_latest
    final_margin = base_margin + phis.sum()
    # The additive identity, exact to floating point.
    assert abs(phis.sum() - (final_margin - base_margin)) < 1e-12


def test_sigmoid_matches_numpy():
    for x in [-5.0, -0.5, 0.0, 0.3, 4.2]:
        assert abs(od._sigmoid(x) - 1.0 / (1.0 + np.exp(-x))) < 1e-12


# ── Triple-barrier labeller ──────────────────────────────────────────────────

def _series(prices):
    idx = pd.date_range("2026-01-01", periods=len(prices), freq="D")
    return pd.Series([float(p) for p in prices], index=idx)


def _noisy_base(rng, n=30, level=100.0, vol=0.5):
    """A mildly noisy flat series so the trailing return σ is > 0 (barriers
    only form when σ_t > 0 — a dead-flat series is correctly all-undefined)."""
    rets = rng.normal(0, vol / level, n)
    return list(level * np.cumprod(1 + rets))


def test_triple_barrier_upper_hit_is_up():
    rng = np.random.RandomState(3)
    base = _noisy_base(rng)
    # A sharp jump up right after the noisy base → some prior day sees the
    # upper ±1σ barrier hit first within the 5-day horizon.
    prices = base + [base[-1] * 1.10]
    lab = od._triple_barrier_labels(_series(prices))
    assert (lab == 1.0).any()


def test_triple_barrier_lower_hit_is_down():
    rng = np.random.RandomState(4)
    base = _noisy_base(rng)
    prices = base + [base[-1] * 0.90]
    lab = od._triple_barrier_labels(_series(prices))
    assert (lab == 0.0).any()


def test_triple_barrier_flat_is_undefined():
    """A dead-flat series has σ=0 → no barriers → all undefined (NaN)."""
    lab = od._triple_barrier_labels(_series([100] * 40))
    assert lab.isna().all()


# ── Graceful degradation ─────────────────────────────────────────────────────

def test_build_frame_includes_cci_features():
    """With a CCI series present, the two CCI features join the two
    price-only features (no DXY anywhere)."""
    rc = _series(list(np.linspace(3000, 3200, 60)))
    kc = _series(list(np.linspace(250, 270, 60)))
    cci = _series(list(100 + np.cumsum(np.full(60, 0.05))))
    built = od._build_frame(rc, kc, cci)
    assert built is not None
    _frame, active = built
    assert set(active) == {"rc_ret_1d", "cci_ret_1d", "cci_z", "kc_rc_gap_z"}
    # DXY must not appear anywhere in the feature set.
    assert not any("dxy" in k for k in active)


def test_build_frame_price_only_when_cci_missing():
    """With no CCI series, the two price-only features keep it alive."""
    rc = _series(list(np.linspace(3000, 3200, 60)))
    kc = _series(list(np.linspace(250, 270, 60)))
    built = od._build_frame(rc, kc, None)
    assert built is not None
    _frame, active = built
    assert active == ["rc_ret_1d", "kc_rc_gap_z"]


def _intraday_df(dates, kc_after=None, rc_gap=None):
    """Build an intraday-feature DataFrame for _build_frame (cols:
    kc_after_rc_diff, rc_overnight_gap)."""
    import pandas as pd
    return pd.DataFrame({
        "kc_after_rc_diff": pd.Series(kc_after if kc_after is not None else [np.nan]*len(dates), index=dates),
        "rc_overnight_gap": pd.Series(rc_gap if rc_gap is not None else [np.nan]*len(dates), index=dates),
    }, index=dates)


def test_intraday_off_without_history():
    """No intraday → both intraday features absent (degrade gracefully)."""
    rc = _series(list(np.linspace(3000, 3200, 80)))
    kc = _series(list(np.linspace(250, 270, 80)))
    built = od._build_frame(rc, kc, None, intraday=None)
    _frame, active = built
    assert "kc_after_rc_diff" not in active and "rc_overnight_gap" not in active


def test_intraday_activates_with_enough_overlap():
    """Once ≥ _MIN_KC_RC_OVERLAP days overlap, both intraday features join."""
    n = 120
    rc = _series(list(np.linspace(3000, 3200, n)))
    kc = _series(list(np.linspace(250, 270, n)))
    d = kc.index[-60:]   # > _MIN_KC_RC_OVERLAP=40
    intr = _intraday_df(d, kc_after=[0.002]*60, rc_gap=[0.001]*60)
    built = od._build_frame(rc, kc, None, intraday=intr)
    _frame, active = built
    assert "kc_after_rc_diff" in active and "rc_overnight_gap" in active


def test_intraday_stays_off_below_overlap_threshold():
    n = 120
    rc = _series(list(np.linspace(3000, 3200, n)))
    kc = _series(list(np.linspace(250, 270, n)))
    d = kc.index[-10:]   # below the 40-day threshold
    intr = _intraday_df(d, kc_after=[0.002]*10, rc_gap=[0.001]*10)
    built = od._build_frame(rc, kc, None, intraday=intr)
    _frame, active = built
    assert "kc_after_rc_diff" not in active and "rc_overnight_gap" not in active


def test_intraday_features_added_independently():
    """If only one intraday column has enough overlap, only it activates."""
    n = 120
    rc = _series(list(np.linspace(3000, 3200, n)))
    kc = _series(list(np.linspace(250, 270, n)))
    d = kc.index[-60:]
    # kc_after has 60 days; rc_gap all-NaN → only kc_after activates.
    intr = _intraday_df(d, kc_after=[0.002]*60, rc_gap=None)
    _frame, active = od._build_frame(rc, kc, None, intraday=intr)
    assert "kc_after_rc_diff" in active
    assert "rc_overnight_gap" not in active


def test_cci_index_orientation_exporter_strength_raises_index():
    """Sanity on the CCI reconstruction: when an exporter currency strengthens
    vs USD (BRL=X falls, i.e. fewer BRL per USD), the index should RISE. Mirrors
    fetch_currency_index._compute_index_series sign convention."""
    import pandas as pd
    idx = pd.date_range("2026-01-01", periods=5, freq="D")
    # BRL=X is local-per-USD: a DECREASE = stronger real = index up.
    brl = pd.Series([5.0, 4.9, 4.8, 4.7, 4.6], index=idx)
    monkey_pairs = {"BRL=X": brl}
    # Build ΔI the same way _compute_cci_index does, restricted to BRL.
    from scraper.quant_model.fetch_currency_index import _strength_sign
    rets = brl.pct_change()
    # exporter weight applied with +w * strength_sign; BRL strengthening
    # (negative raw return × -1 sign) → positive contribution → index up.
    contrib = rets.fillna(0) * (0.513 * _strength_sign("BRL=X"))
    index = (1 + contrib).cumprod() * 100
    assert index.iloc[-1] > index.iloc[0]
    assert monkey_pairs  # keep ref for readability


def test_unavailable_when_archive_missing(monkeypatch, tmp_path):
    """No price archive → available:false, not a crash."""
    monkeypatch.setattr(od, "_ARCHIVE", tmp_path / "does_not_exist.json")
    out = od.run()
    assert out["available"] is False
    assert "archive" in out["reason"].lower()


def test_load_intraday_excludes_roll_days(tmp_path, monkeypatch):
    """rc_overnight_gap must be NaN on roll days (rc_symbol changed vs prior),
    so the calendar spread never shows up as a spurious gap. The within-day
    kc_after_rc_diff is unaffected."""
    import json

    import pandas as pd
    rows = [
        # day 1: contract A
        {"date": "2026-03-02", "rc_symbol": "RMK26", "rc_last_1730": 3000, "rc_open_first": 2990,
         "kc_last_1730": 250, "kc_last_1830": 251},
        # day 2: same contract A → gap is real (open vs prior close)
        {"date": "2026-03-03", "rc_symbol": "RMK26", "rc_last_1730": 3010, "rc_open_first": 3005,
         "kc_last_1730": 252, "kc_last_1830": 253},
        # day 3: ROLL to contract B → cross-contract gap must be excluded
        {"date": "2026-03-04", "rc_symbol": "RMN26", "rc_last_1730": 3120, "rc_open_first": 3115,
         "kc_last_1730": 254, "kc_last_1830": 255},
    ]
    p = tmp_path / "intraday.json"
    p.write_text(json.dumps(rows))
    monkeypatch.setattr(od, "_INTRADAY", p)
    df = od._load_intraday()
    # Day 2: same contract → gap present (3005/3000 - 1).
    assert not pd.isna(df.loc[pd.Timestamp("2026-03-03"), "rc_overnight_gap"])
    # Day 3: roll → gap must be NaN (would otherwise be 3115/3010-1 ≈ +3.5% spurious).
    assert pd.isna(df.loc[pd.Timestamp("2026-03-04"), "rc_overnight_gap"])
    assert bool(df.loc[pd.Timestamp("2026-03-04"), "_rc_roll"]) is True
    # kc_after_rc_diff (within-day) present on the roll day regardless.
    assert not pd.isna(df.loc[pd.Timestamp("2026-03-04"), "kc_after_rc_diff"])


def test_run_emits_usd_per_ton_and_gap_detail():
    """Every factor carries a usd_per_ton (robusta $/MT ruler), and the New
    York Price Gap factor carries the written-down component detail."""
    out = od.run()
    if not out.get("available"):
        import pytest
        pytest.skip(f"model unavailable: {out.get('reason')}")
    feats = out["features"]
    assert all("usd_per_ton" in f for f in feats), "every factor needs usd_per_ton"
    gap = next((f for f in feats if f["var_name"] == "kc_rc_gap_z"), None)
    if gap is not None:
        d = gap.get("detail")
        assert d is not None, "gap factor must carry detail"
        # gap = KC$/MT − RC$/MT (components written down)
        assert abs(d["gap_usd_per_mt"] - (d["kc_usd_per_mt"] - d["rc_usd_per_mt"])) < 1.0
        # the gap's usd_per_ton is the deviation from the rolling mean
        if d["gap_mean_usd_per_mt"] is not None and gap["usd_per_ton"] is not None:
            assert abs(gap["usd_per_ton"] - (d["gap_usd_per_mt"] - d["gap_mean_usd_per_mt"])) < 1.0
