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
López-de-Prado triple-barrier labelling scheme on intraday ticks.

This methodology keeps the *idea* — a triple-barrier-labelled directional
classifier with an exact attribution of the latest call — but predicts the
**next daily session** rather than the first 30 minutes. The label is built on
daily RC settles; intraday data (added later — see below) feeds two of the
features but not the label.

Data sources:

- **RC and KC front-month daily settles** — `data/contract_prices_archive.json`
  (~5 years, 2021-06 → present). Drives the label and the two always-on
  features.
- **The Coffee Currency Index (CCI)** — reconstructed from the component FX
  pairs in `fx_history.json` (the platform's own coffee-trade-weighted basket
  of producer vs consumer currencies), using the *identical* weights and
  strength orientation as the published index in `fetch_currency_index.py`.
  `fx_history.json` is produced daily by the CCI workflow from a
  GitHub-Actions-reachable CDN FX API, so the model needs no extra network call.
- **15-minute RM + KC intraday** — `intraday_kc_rc_15min.json` (~5.7 years from
  Barchart; see §3). At the original design time no intraday RC feed was
  ingested; Barchart's `queryminutes.ashx` later turned out to carry robusta
  intraday (Yahoo does not), so the two New-York-window features now use real
  15-min data. The label remains daily.

The reformulation changes the prediction horizon from "first 30 minutes" to
"next session(s)" but preserves the spirit of the feature family (the
contract's own move, the FX backdrop, the NY arbitrage gap, and the
after-close / overnight intraday moves) and the barrier-based labelling
philosophy.

**On the currency axis — why the CCI, not the dollar index.** The original mock
used EUR/USD, USD/BRL and the US Dollar Index (DXY). DXY is a generic
trade-weighted dollar basket dominated by the euro and yen — only loosely
related to coffee. The platform already publishes the **Coffee Currency Index**,
a basket weighted by actual coffee trade: producer (export) currencies — BRL
0.513, VND 0.262, COP 0.128, IDR 0.051, PEN 0.047 — net of consumer (import)
currencies — EUR 0.673, JPY, CHF, CNY, CAD, KRW, GBP. The index *rises* when
producer currencies strengthen against the dollar (origin costs rise in USD →
bullish coffee) and *falls* when consumer currencies strengthen. Using the CCI
in place of EUR/USD + DXY + USD/BRL collapses three overlapping dollar features
into one coffee-relevant axis, removes the DXY dependency entirely, and avoids
the multicollinearity of carrying EUR and BRL both standalone and inside DXY.

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

| `var_name`         | Label                      | Definition                                                         |
|--------------------|----------------------------|---------------------------------------------------------------------|
| `rc_ret_1d`        | RC 1-Day Return            | RC front-month daily return                                         |
| `cci_ret_1d`       | Coffee Currency Index Δ    | CCI daily return — the producer-vs-consumer currency move of the day |
| `cci_z`            | Coffee Currency Index (z)  | CCI level z-scored over a 120-day rolling window — how stretched the basket is |
| `kc_rc_gap_z`      | New York Price Gap (z)     | (KC·22.0462 − RC) in USD/MT, z-scored over a 260-day rolling window  |
| `kc_after_rc_diff` | NY after RC-Close Move     | KC 18:30 ÷ KC 17:30 London − 1 — the NY-only move in the hour after London robusta closes (within-day, roll-immune) |
| `rc_overnight_gap` | RC Overnight Gap           | RC open ÷ prior-day RC 17:30 close − 1 — robusta's overnight gap; **roll days excluded** (see below) |

`22.0462` converts KC (¢/lb) to USD/MT so the KC−RC gap is a like-for-like
arbitrage spread. The CCI itself is reconstructed exactly as
`fetch_currency_index._compute_index_series`: each component pair's daily return
is normalised to a USD-strength return, exporters add (+w) and importers
subtract (−w), and the weighted ΔI is accumulated from a base of 100.

### USD/ton quantification per factor

Each factor is also reported in **robusta USD/MT** (`usd_per_ton`), so the
magnitudes are comparable on one dollar ruler regardless of whether the raw
value is a % return or a z-score:

- **Return factors** (`rc_ret_1d`, `rc_overnight_gap`, `cci_ret_1d`,
  `kc_after_rc_diff`): the % move applied to the latest robusta price —
  `raw × RC_price`.
- **Level (z-score) factors** (`kc_rc_gap_z`, `cci_z`): the **deviation from the
  rolling mean** in USD/MT, so a stretched level reads as a dollar anomaly
  rather than an absolute level. For the gap that's `gap − gap_mean`; for the
  CCI it's the index's %-deviation from its 120-day mean × `RC_price`.

### Price-gap detail (written down)

The New York Price Gap factor additionally carries a `detail` block spelling out
the components used for its z-score, so nothing is hidden behind the σ:

```jsonc
"detail": {
  "kc_usd_per_mt":       6366.9,   // KC ¢/lb × 22.0462
  "rc_usd_per_mt":       3756.0,   // RC front settle
  "gap_usd_per_mt":      2610.9,   // KC$/MT − RC$/MT (the arbitrage gap)
  "gap_mean_usd_per_mt": 3391.9,   // 260-day rolling mean of the gap
  "gap_std_usd_per_mt":  697.2,    // 260-day rolling std (the z denominator)
  "formula": "gap = KC(¢/lb × 22.0462) − RC, in USD/MT; z-scored over a 260-day rolling window"
}
```

So `kc_rc_gap_z = (gap − gap_mean) / gap_std`, and the factor's `usd_per_ton`
= `gap − gap_mean` (here −781 USD/MT: the gap is $781/t below its year-average).

### The NY-after-RC-close feature (`kc_after_rc_diff`)

This is the single most economically-motivated feature, and worth its own note.
ICE Robusta (London) closes its session at **17:30 London**; ICE Arabica /
Coffee C (New York) keeps trading for ~1 more hour and settles at 13:30 ET.
During that final hour New York prices in information London robusta has already
stopped trading on — and robusta tends to **gap toward it at its next open**. So

    kc_after_rc_diff = KC_at_18:30_London / KC_at_17:30_London − 1

(both the close of the 15-min bar at the respective London time, same KC
contract; positive = NY rallied after London closed → bullish for robusta's
next open) is a genuine leading indicator for the very thing this model
predicts. Being within-day and within one KC contract, it is roll-immune.

**Data source (precise 15-min, ~5.7 years).** Both this feature and
`rc_overnight_gap` come from `intraday_kc_rc_15min.json` — 15-minute RM + KC
bars from **Barchart** (`queryminutes.ashx`, reached via the same Playwright +
XSRF session the OI scraper uses). Barchart is the only intraday source that
carries robusta; Yahoo has none. The backfill
(`backfill_intraday_kc_rc.py`, workflow 1.97) fetches each delivery contract
(32 RM + 27 KC back to 2020-10) and stitches them into a front-month series by
**daily volume** — the genuinely liquid contract each day, which avoids the
stale near-expiry prints an FND-based roll would capture. Barchart timestamps
are US Central; localised to America/Chicago → Europe/London, where 15-min bars
land exactly on the 17:30 / 18:30 / 09:00 boundaries. Validation: RC
last-traded @ 17:30 vs the official settle agrees to a **0.14% median** over
1,272 days, with zero >2% days — confirming both the timezone mapping and the
contract consistency.

**Roll-day exclusion (important for the stats).** `rc_overnight_gap` is a
*cross-day* ratio (today's open vs yesterday's close). On a roll day — when the
liquid front contract changes — those two prices are different delivery months,
so the **calendar spread** (often several %) would masquerade as a giant
overnight gap and pollute the distribution. The loader therefore sets
`rc_overnight_gap` to NaN on every roll day (`rc_symbol` ≠ prior day's), and the
count is reported as `model.roll_days_excluded`. `kc_after_rc_diff` is
*within-day* (KC 17:30 → 18:30, same KC contract) and so is immune to rolls — it
is not excluded.

Both intraday features **activate automatically** once at least
`_MIN_KC_RC_OVERLAP` (40) days overlap the training window
(`model.kc_after_rc_active`, `model.rc_overnight_active`), and the active source
is reported as `model.intraday_source` (`barchart_15min`, or `hourly_fallback`
when the 15-min file is absent and the legacy `kc_at_rc_close_history.json`
hourly history is used for `kc_after_rc_diff` only).

**Refresh cadence.** The full history in `intraday_kc_rc_15min.json` is built by
the Barchart deep backfill (`backfill_intraday_kc_rc.py`, workflow 1.97,
~5.7y from 59 contracts) — heavy, run manually when the history needs rebuilding.
Day-to-day currency is kept by a **scheduled daily incremental refresh**
(`refresh_intraday_kc_rc.py`, workflow 1.98) that runs **20:13 UTC Mon-Fri**,
after both markets close (KC 18:30 London) and before the 21:30 UTC quant run
(1.9). It fetches only the few nearest contracts, volume-stitches them with the
*same* logic as the backfill (so contract selection is identical), and **merges**
the recent days into the file — recent dates overwrite, all older history is
preserved. The model therefore picks up the fresh intraday the same day and the
scored `as_of` advances automatically. Same-day official settles aren't in the
archive yet at 20:13 UTC; the model doesn't use the settle, and the next day's
refresh backfills it. The separate acaphe forward capture
(`capture_kc_at_rc_close.py`, workflow 0.2) still writes the *legacy*
`kc_at_rc_close_history.json` hourly fallback used only when the 15-min file is
absent.

### Graceful feature degradation

`rc_ret_1d` and `kc_rc_gap_z` are derived purely from the price archive and are
**always present**. The two CCI features are included only when `fx_history.json`
yields the component pairs; `kc_after_rc_diff` and `rc_overnight_gap` only once
enough intraday days overlap. Each optional feature is added **independently**,
so a missing input drops only its own feature(s) — the model proceeds on the
rest rather than failing. The active set is reported in
`model.active_features`, with the flags `cci_available`, `kc_after_rc_active`,
`rc_overnight_active`, `intraday_source`, and `roll_days_excluded`; the SHAP
decomposition adapts to whatever set was used and stays exactly additive.

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
- **Training-window size** — `n_train`. The joined training set is the
  intersection of *all active features'* coverage. The binding constraint is
  `fx_history.json` (a rolling ~1-year CCI window); the two intraday features
  tighten it slightly further. So with all six features active, `n_train` is
  currently ~160 defined rows even though the RC price archive spans 5 years and
  the intraday history ~5.7. Lengthening the FX history is the main lever; the
  model refits every day as coverage grows.

A model that cannot assemble at least `_MIN_DEFINED` (80) defined training rows
reports `available: false` rather than publishing a thin fit.

---

## 6. Output schema (`quant_report.json` → `open_direction`)

```jsonc
{
  "available": true,
  "as_of": "2026-06-25",            // date of the scored observation
  "scraped_at": "2026-06-28T14:38:43Z",
  "direction": "Bearish",
  "base_margin": ...,               // E[f(x)] in log-odds
  "final_margin": ...,              // f(x) in log-odds
  "base_prob": ...,                 // σ(base_margin)
  "final_prob": ...,                // σ(final_margin)
  "prob_up": ...,
  "prob_down": ...,
  "features": [                     // sorted by |φ| descending
    {
      "var_name": "kc_rc_gap_z",
      "label": "New York Price Gap (z)",
      "raw_value": -1.12,           // the z-score (this feature IS a z)
      "raw_fmt": "-1.12σ",
      "usd_per_ton": -781.0,        // robusta USD/MT ruler (see §3)
      "phi": 0.0641,                // log-odds SHAP contribution
      "detail": {                   // only on the price-gap factor
        "kc_usd_per_mt": 6366.9, "rc_usd_per_mt": 3756.0,
        "gap_usd_per_mt": 2610.9, "gap_mean_usd_per_mt": 3391.9,
        "gap_std_usd_per_mt": 697.2,
        "formula": "gap = KC(¢/lb × 22.0462) − RC, in USD/MT; z over a 260-day window"
      }
    }
    // … the other five factors (no `detail`)
  ],
  "barrier": { "horizon_days": 5, "k_sigma": 1.0, "vol_window": 20 },
  "model": {
    "kind": "logistic_regression_l2",
    "active_features": ["rc_ret_1d", "cci_ret_1d", "cci_z", "kc_rc_gap_z",
                        "kc_after_rc_diff", "rc_overnight_gap"],
    "n_features": 6,
    "n_train": 163,
    "test_accuracy": 0.469,         // on defined cases, time-holdout
    "n_test": 49,
    "undefined_ratio": 0.158,
    "n_resolvable": 190,
    "n_undefined": 30,
    "currency_axis": "coffee_currency_index",
    "cci_available": true,
    "kc_after_rc_active": true,
    "rc_overnight_active": true,
    "intraday_source": "barchart_15min",   // or "hourly_fallback"
    "roll_days_excluded": 65               // RC roll days NaN'd in rc_overnight_gap
  }
}
```

Every factor carries `usd_per_ton`; only `kc_rc_gap_z` carries `detail`.
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
- The current fit trains on a ~1-year window (the binding FX-history length),
  so it is thin relative to the multi-year price + intraday archives. Treat
  early live numbers as the method coming online, not a seasoned track record;
  the model refits daily and the window lengthens as FX history accumulates.

---

## 8. Limitations and future work

- **Daily label, intraday features.** The *label* is still the daily triple
  barrier; the original 30-minutes-after-open framing isn't used. Now that a
  15-min RM feed exists (Barchart, §3), the same labelling + attribution code
  could be applied to an intraday bar — only the barrier units would change.
  Today intraday data feeds two features but not the label.
- **Intraday refresh (resolved).** `intraday_kc_rc_15min.json` is now kept
  current by a scheduled daily incremental job (`refresh_intraday_kc_rc.py`,
  workflow 1.98, 20:13 UTC Mon-Fri) that fetches the nearest front contracts and
  merges the recent days into the file ahead of the 21:30 UTC quant run (§3), so
  the two intraday features stay live and the scored `as_of` no longer freezes.
  The deep backfill (1.97) remains the manual tool for rebuilding the full
  ~5.7y history.
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
