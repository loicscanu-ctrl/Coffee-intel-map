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

## Night batch (2026-07-03): brent_overnight PASSES — third active feature
`brent_overnight` = Brent front-month 17:30-London(prev) → 03:00-UTC move,
same anchors as cci_overnight, but reconstructible historically (Brent trades
~24h) via a per-contract Barchart backfill (front = max daily volume, anchors
same-contract → roll-immune; `data/brent_intraday_anchors.json`, ~5y).
Walk-forward verdict: **univariate +5.4pp** (n=700, sign 100% stable, 3/4 yrs),
**marginal +1.2pp** over kc_after+dsr, and exactly the geopolitical
hypothesis: **2022 (oil shock) edge +14.2pp → +20.3pp with brent**. Live model
with brent: wf edge **+5.2pp**, acted accuracy **67.5%** @ 42% coverage
(vs +3.6pp / 63.3% without). Positive sign: brent up overnight ⇒ robusta gaps
up (risk/energy complex tone). Daily forward capture appends new anchors from
the continuous front (backfilled per-contract rows are never overwritten).

Same-night battery — all REJECTED at the gate (marginal vs kc_after+dsr):
vol20 −2.3pp · kc_after×low-vol +0.1 · kc_after×harvest +0.3 · harvest −0.3 ·
days-since-session +0.2 · |kc_after| −1.3. Certified robusta stocks: only ~13
months of history → exploratory windows too small; retest ≥350 days (~2027).
Cecafe daily: current-values only, no committed history — not testable.
Consequence: market situation ships as **regime TAGS** (decision support, not
model inputs): ny_shock (the measured 88% setup), vol regime (confidence
reliable in low-vol only), harvest window. Every factor now also reports its
**z-score** in the payload and the logged factors.

## Owner decision (2026-07): ±10pp "Undefined" band
Calls with |p−50| < 10pp are now **Undefined** (band 0.06 → 0.10). Measured on
the 899-session walk-forward: acted hit-rate **63.6% at 36% coverage** (~1
call per 2.7 sessions), capture +$5.0/t per call vs +$2.1 acting on
everything. Stored direction value remains "Abstain" for record continuity;
all UI surfaces render "Undefined". The seed-regeneration trigger also fires
on band changes so backtest rows relabel consistently (live rows untouched).

## Bearish-call asymmetry (2026-07 analysis) — base rate, not model magic
Raw hit-rates (bear 60.4% vs bull 52.3%) look asymmetric, but robusta gaps
DOWN 55.4% of overnight sessions. Against the correct blind baselines the
skill is roughly symmetric — actually higher on bullish calls:
  bear 60.4% vs blind-bear 55.4% → **+5.0pp skill**
  bull 52.3% vs blind-bull 44.6% → **+7.7pp skill**
Bear-call share varies by month (22%→80%) but tracks each month's own
down-drift (e.g. Oct: 32% up-rate → 74% bear share, 74% bear hit) and each
year's regime (2024: 37% up-rate → bear 68%; 2025: 50% → bear 53%) — i.e.
regime-following via the intercept + drivers, not a calendar anomaly. No
evidence of a flaw; per-month samples (~75) too thin to trade separately.

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
