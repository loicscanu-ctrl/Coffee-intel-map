# Open Price Direction — Methodology

**Model:** Daily next-session direction classifier for ICE Robusta (RC) coffee
futures, with an exact additive (SHAP-style) attribution of each prediction.

**Implementation:** `backend/scraper/quant_model/open_direction.py`
**Output:** `frontend/public/data/quant_report.json` → `open_direction`
**Surfaced in:** Signals tab → "Open Price Direction" (`PriceDirectionSection.tsx`)
**Status:** Live (daily, via workflow 1.9 → `run_quant.py`)

---

## 1. Motivation and scope

The Signals tab previously carried a hand-coded mock of this panel: a SHAP
waterfall with frozen numbers and a "MOCK DATA" banner. The original concept
targeted the **first 30 minutes after the ICE Robusta open** and used a
López-de-Prado triple-barrier labelling scheme on intraday ticks. That design
requires an intraday RC price feed the platform does not ingest.

This methodology keeps the *idea* — a triple-barrier-labelled directional
classifier with an exact attribution of the latest call — but reformulates it
on the data the platform already ships **daily**, so the panel can be live and
self-updating:

- **RC and KC front-month daily settles** — `data/contract_prices_archive.json`
  (~5 years, 2021-06 → present).
- **EUR/USD, USD/BRL, and the US Dollar Index (DXY)** — Stooq free daily CSV
  (the same source `robusta_factors.py` already uses for DXY), with a fallback
  to the shipped `fx_history.json` for EUR/USD and USD/BRL when Stooq is
  unreachable.

The reformulation changes the prediction horizon from "first 30 minutes" to
"next session(s)" but preserves the feature family (the contract's own move,
overnight FX/DXY moves, and the NY arbitrage gap) and the barrier-based
labelling philosophy.

---

## 2. Labels — the triple-barrier method on daily bars

Following López de Prado (*Advances in Financial Machine Learning*, 2018, ch. 3),
each observation day *t* is assigned three barriers:

- an **upper** price barrier at `price_t · (1 + K·σ_t)`,
- a **lower** price barrier at `price_t · (1 − K·σ_t)`,
- a **vertical (time)** barrier `H` trading days ahead.

where `σ_t` is the trailing standard deviation of daily RC returns over a
`VOL_WINDOW`-day window. The path of RC settles is walked forward from `t+1`:

- if the **upper** barrier is touched first → label **Up** (`1`),
- if the **lower** barrier is touched first → label **Down** (`0`),
- if the **time** barrier is reached before either price barrier → **undefined**.

Undefined cases are dropped from training and counted in the *undefined ratio*.
This abstention is deliberate: when neither price barrier is touched within `H`
days the move was not decisive, and forcing a directional label there
manufactures false signal. The headline accuracy is therefore **conditional on
a defined outcome**, and the undefined ratio is reported alongside it so the
reader can weigh how often the method declines to call.

**Current hyper-parameters** (in `open_direction.py`):

| Parameter      | Symbol       | Value | Meaning                                   |
|----------------|--------------|-------|-------------------------------------------|
| Horizon        | `_BARRIER_H` | 5     | Time barrier, trading days (~1 week)      |
| Barrier width  | `_BARRIER_K` | 1.0   | ± multiples of trailing daily σ           |
| Vol window     | `_VOL_WINDOW`| 20    | Trailing window for σ_t                    |

So a "decisive" move is roughly **±1σ over a trading week**.

---

## 3. Features

All features are computed on the daily bar and standardised (z-scored) on the
training distribution before fitting. The canonical display order:

| `var_name`       | Label                  | Definition                                                    |
|------------------|------------------------|---------------------------------------------------------------|
| `rc_ret_1d`      | RC 1-Day Return        | RC front-month daily return                                   |
| `eurusd_ret_1d`  | EUR/USD Daily Return   | EUR/USD daily return (RC is EUR-quoted-adjacent demand proxy) |
| `dxy_ret_1d`     | DXY Daily Return       | US Dollar Index daily return                                  |
| `kc_rc_gap_z`    | New York Price Gap (z) | (KC·22.0462 − RC) in USD/MT, z-scored over a long window      |
| `usdbrl_ret_1d`  | USD/BRL Daily Return   | USD/BRL daily return (Brazil is the marginal arabica/conilon supplier) |

`22.0462` converts KC (¢/lb) to USD/MT so the KC−RC gap is a like-for-like
arbitrage spread.

### Graceful feature degradation

`rc_ret_1d` and `kc_rc_gap_z` are derived purely from the price archive and are
**always present**. The three FX-dependent features are included only when their
underlying series loads. If, for example, the DXY pull fails and has no
fallback, the model proceeds on the remaining four features rather than failing
entirely. The active feature set is reported in
`open_direction.model.active_features`, and the SHAP decomposition adapts to
whatever set was used. In production (Stooq reachable) all five are active.

---

## 4. Model — logistic regression, and why the SHAP is *exact*

The classifier is an L2-regularised **logistic regression** fit by
Newton-Raphson / IRLS in pure NumPy (no `sklearn`/`scipy`/`shap` dependency, so
the GitHub-Actions quant step stays lightweight). The intercept is not
penalised.

The key property is that for a logistic model the SHAP attribution is
**closed-form exact** in the log-odds (margin) space. With standardised features
`zᵢ` (so `E[zᵢ] = 0` by construction):

```
margin(x)   = β₀ + Σ βᵢ·zᵢ
base_margin = β₀                       (= the margin at the average observation)
φᵢ          = βᵢ·zᵢ                     (feature i's SHAP value)
Σ φᵢ        = margin(x) − base_margin   (exactly, zero residual)
```

This is a special case of the general SHAP additivity axiom, but here it holds
**analytically** — no Shapley-value sampling, no tree-SHAP approximation. The
waterfall in the UI is therefore mathematically exact: the per-feature bars sum
to the gap between the base log-odds and the prediction's log-odds with zero
residual (verified in the unit tests to < 1e-9).

The endpoints are reported in **both** units:

- **margin (log-odds):** `base_margin`, `final_margin` — where the bars are
  additive,
- **probability:** `base_prob = σ(base_margin)`, `final_prob = σ(final_margin)` —
  where the human-readable "Bullish 43%" lives.

The UI draws the waterfall in margin units (honest additivity) and labels the
endpoints with their probabilities. This is the same convention SHAP's own force
plots use for classifiers (`link="logit"`).

`direction = Bullish if final_prob ≥ 0.5 else Bearish`.

---

## 5. Validation

Accuracy is reported on a **chronological holdout**, never in-sample:

1. The defined-label rows are split 70/30 by time (first 70% train, last 30%
   test) — no shuffling, so there is no look-ahead leakage across the split.
2. The model is fit on the training portion and scored on the held-out tail.
3. `test_accuracy` is the fraction of correctly-classified **defined** test
   cases; `n_test` is the test size.

The **live** coefficients are then refit on the *full* history (so today's
prediction uses every available observation), but the reported accuracy always
reflects the out-of-sample holdout.

Two honest caveats are surfaced in the output and the UI:

- **Undefined ratio** — fraction of resolvable days where the time barrier was
  hit first. A high ratio means the method abstains often; the accuracy is
  conditional on the rest.
- **Training-window size** — `n_train`. When Stooq is unreachable and the model
  falls back to the rolling ~1-year `fx_history.json`, the FX-dependent features
  (and hence the joined training window) shrink, which both reduces `n_train`
  and can drop DXY. The output's `fx_source` block records which path was taken.

A model that cannot assemble at least `_MIN_DEFINED` (80) defined training rows
reports `available: false` rather than publishing a thin fit.

---

## 6. Output schema (`quant_report.json` → `open_direction`)

```jsonc
{
  "available": true,
  "as_of": "2026-06-25",            // date of the scored observation
  "scraped_at": "2026-06-27T13:32:25Z",
  "direction": "Bearish",
  "base_margin": -0.0091,           // E[f(x)] in log-odds
  "final_margin": -0.1891,          // f(x) in log-odds
  "base_prob": 0.4977,              // σ(base_margin)
  "final_prob": 0.4529,             // σ(final_margin)
  "prob_up": 0.4529,
  "prob_down": 0.5471,
  "features": [                     // sorted by |φ| descending
    { "var_name": "rc_ret_1d", "label": "RC 1-Day Return",
      "raw_value": 0.0132, "raw_fmt": "+1.32%", "phi": -0.1466 }
    // …
  ],
  "barrier": { "horizon_days": 5, "k_sigma": 1.0, "vol_window": 20 },
  "model": {
    "kind": "logistic_regression_l2",
    "active_features": ["rc_ret_1d", "eurusd_ret_1d", "kc_rc_gap_z", "usdbrl_ret_1d"],
    "n_features": 4,
    "n_train": 213,
    "test_accuracy": 0.5625,        // on defined cases, time-holdout
    "n_test": 64,
    "undefined_ratio": 0.157,
    "n_resolvable": 249,
    "n_undefined": 39,
    "fx_source": { "eurusd": "stooq", "usdbrl": "stooq", "dxy": "stooq" }
  }
}
```

`Σ features[].phi == final_margin − base_margin` holds exactly.

---

## 7. Interpretation guidance

- The model is a **probabilistic tilt**, not a deterministic signal. A 0.45
  `prob_up` is a mild bearish lean, not a short recommendation.
- Read the **waterfall**, not just the headline: which feature is driving the
  call this session (largest |φ|) is usually more informative than the
  probability itself.
- Respect the **undefined ratio**. On a sample where the method abstains ~50% of
  the time, the accuracy figure only describes the half it chose to call.
- The current sandbox/limited-FX fit trains on a thin window; the production fit
  (multi-year Stooq FX + DXY active) is materially larger. Treat early live
  numbers as the method coming online, not a seasoned track record.

---

## 8. Limitations and future work

- **Daily, not intraday.** The original 30-minutes-after-open framing is not
  recoverable without an intraday RC feed. If one is added, the same labelling +
  attribution code applies to a finer bar with only the barrier units changing.
- **Linear classifier.** Logistic regression buys exact attribution and a tiny
  dependency footprint at the cost of not modelling feature interactions. A
  gradient-boosted tree with tree-SHAP would capture interactions but needs the
  `shap` library and gives only an *approximate* additive decomposition.
- **Fixed barriers.** `K` and `H` are static; a volatility-regime-adaptive
  barrier (e.g. wider in high-VIX-of-coffee periods) would make the label more
  stationary across regimes.
- **No transaction-cost / session-timing overlay.** This is a directional
  classifier, not a backtested strategy.

---

## References

- M. López de Prado, *Advances in Financial Machine Learning*, Wiley, 2018 —
  triple-barrier labelling (ch. 3).
- S. Lundberg & S.-I. Lee, "A Unified Approach to Interpreting Model
  Predictions," NeurIPS 2017 — SHAP; the logistic closed form used here is the
  exact-additivity special case.
