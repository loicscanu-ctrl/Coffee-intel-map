# Open Price Direction — model research findings

Living record of feature decisions + evidence for the Robusta open-price-direction
work. Every candidate is judged on **walk-forward, out-of-sample** performance
(expanding window, refit periodically, standardise-on-past), scored as **edge =
OOS accuracy − rolling-majority baseline**, with sign-stability, per-year
consistency, significance and calibration checks.

## Target & firing
- **Predicts:** direction of the **overnight gap** — RC open ÷ prior 17:30-London
  close − 1 (up/down), with an **abstain band** on low-confidence days.
- **Fires:** 03:00 UTC (Mon–Fri, own job), pre-open; prediction feeds the Telegram brief.
- **Roll days excluded** from the target (front-contract change → spurious gap).

## Feature verdicts (overnight-gap target, ~900 OOS days 2022–2026)

| Feature | Decision | Evidence |
|---|---|---|
| `kc_after_rc_diff` (NY move 17:30→18:30 London, after RC closes) | **KEEP** | +2.8pp edge, AUC 0.57, sign 100% stable, 3/5 yrs +, better when confident (top-third 62.9%). The core lead signal. |
| `days_since_roll` (position in bi-monthly roll cycle) | **KEEP (provisional)** | Marginal **+1.1pp** over kc_after → combined **+3.9pp**, AUC 0.58, p1=0.019, 4/5 yrs; **confirmed on untouched last-30% holdout (+2.9pp marginal)**. Cycle shape: gaps tilt down mid-cycle (~day 10), up late-cycle (~day 37). |
| `cci_overnight` (CCI 17:30-close → 03:00 UTC, %→$/t) | **SHIP LIVE (forward-validate)** | No historical intraday FX → can't back-test; ships live, graded forward-only. |
| `kc_rc_gap_z` (arb level, windows 7/15/21) | **DROP** | Negative edge, AUC 0.48, unstable sign; adding it *lowers* the combined edge. Arb doesn't predict the overnight gap. |
| `kc_rc_gap_ret` (arb daily change) | **DROP** | Redundant with the level + roll-contaminated. |
| `rc_ret_1d` (prior-day return) | **DROP** | No signal (per design intuition). |
| `rc_overnight_gap`, `rc_open15_ret` | **OUTCOMES, not features** | These *are* the open behaviour we grade against. |
| harvest / frost / day-of-year seasonality | **DROP (this model)** | All ≤0 marginal, unstable — frequency-mismatched + too few annual cycles. Reserve for the longer-horizon model. |
| term structure, daily-BRL, index-roll, month-end, weekend | **DROP** | No usable edge on this target. |

## Vietnam physical overnight (candidate 1a) — DATA-STARVED, WAIT
Hypothesis: VN domestic robusta (giacaphe, Dak Lak) moves during Asia hours —
before London opens — so its fresh-morning change should lead the RC open.
Investigated 2026-07: **timing confirmed viable** — the daily scrape (01:07
UTC = 08:07 VN) captures the same-morning price, i.e. the feature is genuinely
knowable pre-open with correct alignment. **But only ~50 days of history
exist** (`origin_prices_history.json` accumulator started 2026-05-14), far
below the ~300 sessions the walk-forward gate needs. Per the evidence rule, it
does NOT enter the model now. Path forward: the accumulator grows daily with
zero new infrastructure — revisit at ~300 rows (~early 2027), or earlier via a
DB backfill if `physical_prices` holds deeper giacaphe history than the
exporter surfaces.

## COT industry × harvest — RE-TESTED ON DEEP DATA (2026-07): REJECTED
The deep backfill (workflow 9.4) banked **613 weekly ICE robusta COT rows
(2014-09 → 2026-06)** in `data/ice_cot_robusta_history.json`. Free robusta
*price* history remains the binding constraint (~2020-10 at best: intraday
17:30 closes + archive fronts + Barchart EOD, merged), so the joined test
sample is 1,454 days / ~7 harvest cycles — two more than the original test,
crucially adding the 2020-10→2021-06 regime.

Result: the purged walk-forward edge FLIPS NEGATIVE — ind_z+harv **−3.8pp**
vs baseline (95% CI [−8.1, +1.0], P(edge>0)=0.065), with 2022 alone at
−15.9pp. The 2×2 directional shape survives qualitatively (heavy-short·harvest
+2.0% fwd-10d vs min-short·harvest −0.3%) but cannot be monetized out of
sample. **Verdict: the earlier +1.5pp was sample luck; do NOT found a
multi-day model on this interaction.** The deep COT file stays banked for
future hypotheses; re-opening this one requires pre-2020 price data (paid or
manual import) AND a materially different formulation.

## COT industry × harvest (original 6y test) — INCONCLUSIVE
Hypothesis: commercial (`pmpu`) positioning conditioned on harvest predicts a
**multi-day** move (min-short during harvest = unsold crop overhang = bearish).

- **Directional pattern is coherent & consistent** (holds on non-overlapping data):
  min-short·harvest = most bearish (fwd-10d −0.1%, 52–57% down); heavy-short·harvest
  = bullish (fwd-10d +2.4%, ~34% down).
- **But it does NOT clear significance.** Naive walk-forward showed +5.6pp; under a
  **10-day purge/embargo** (removing overlapping-return leakage) it deflates to
  **+1.5pp**, and a block-bootstrap gives **95% CI [−3.3, +6.8], P(edge>0)=0.74**.
- **Verdict:** suggestive, not proven on 6 years (~5 harvest cycles). **Next step:
  backfill deeper ICE robusta COT history (~15y)** to get more cycles before
  founding a model on it; treat as experimental/monitored meanwhile.

## Track record / calendar
- Live predictions are logged **append-only** at 03:00 UTC (before the open) and
  resolved after the open — the honest forward record, distinct from the backtest.
- Backtest-seeded history (2022–2026): coverage 79% (abstain band ±0.03),
  hit-rate on acted days **56.5%**.

## Rollout status (2026-07, all stages live)
| Stage | What | Where |
|---|---|---|
| 1 | Append-only prediction log + resolver | `open_direction_log.py`, workflow **1.16** (03:00 UTC Mon–Fri) |
| 2 | Live model swapped to this spec (gap target, proven features, abstain band, exact SHAP) | `open_direction.py`; panel + methodology page updated; DST regression + invariant tests |
| 3 | Intraday-FX snapshots (17:30-London / 03:00-UTC anchors per CCI pair) → activates `cci_overnight` at ≥40 days | `fetch_fx_snapshots.py`, non-blocking step in 1.16 |
| 4 | Telegram brief chains on 1.16 and carries the pre-open RC call | `morning-brief.yml` (cron now the 03:41 fallback), `telegram/handlers/brief.py` |
| 5 | Calendar UI: prediction vs realized open, live vs backtest, stats + table view | `OpenDirectionCalendar.tsx` on the Macro tab |

One prediction → two artifacts: the 03:00 job writes the history row AND
`quant_report.json["open_direction"]` from the same fit, so the panel and the
record can never disagree. `run_quant.py` (21:30) preserves the key untouched.

## Enhancements (2026-07, second wave)
- **Abstain band retuned 0.03 → 0.06** on the real walk-forward probs (sweep
  0.00→0.10, objective: max acted hit-rate s.t. coverage ≥60%): acted accuracy
  56.5% @ 79% coverage → **58.7% @ 60%**. The monotone band→accuracy curve
  (0.10 → 63.5% @ 36%) confirms the probability is informative. Mild selection
  effect acknowledged; the live record is the arbiter.
- **Per-prediction SHAP logging** — every history row (live + regenerated
  backtest seed) stores its per-feature φᵢ, enabling "which feature has been
  earning" analysis on live data later. Live rows are never rewritten.
- **Drift alarm** — the payload carries `track` (live graded n, overall +
  rolling-60 acted hit-rate); the Telegram brief warns "⚠️ cold streak" when
  ≥20 graded live calls run below 50% rolling. The model monitors itself.
- **Magnitude head** — ridge on the same pre-open features predicting the
  SIGNED gap; payload exposes `expected_gap_pct` / `expected_gap_usd_mt`
  (brief: "exp. +16$/t"). Honest OOS read on real data: MAE 0.302% vs 0.308%
  zero-baseline → **skill +0.02** (small); it sizes the call, the classifier
  remains the headline. Both MAEs are published in the model block.
