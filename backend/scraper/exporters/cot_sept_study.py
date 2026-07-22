"""
cot_sept_study.py
September X-ray — single-contract COT positioning for KC September futures.

The CFTC disaggregated futures-only report splits Coffee C into crop-year
buckets ("old" = delivery months of the current Oct–Sep crop year, "other" =
later). September is the LAST month of the coffee crop year, so once July
trades out the old bucket degenerates to September alone — an exact per-cohort
X-ray of one contract month, something COT data never normally gives:

  phase "baseline"      (≤ July FND)          old = July + September
  phase "jul_delivery"  (July FND → July LTD) old = September + a July stub
  phase "pure"          (July LTD → Sept FND) old = September EXACTLY
  phase "sept_delivery" (Sept FND → Aug 31)   old = September, in its notice period
  ~Sep 1: CFTC rolls the crop year (old jumps to ~95% of OI) → window ends.

The roll boundary and the collapse (e.g. 2024: 107k lots on Jul 23 → 550 by
Aug 27) are verified empirically against the app's stored COT data.

Sources, in order:
  1. Years already in the output file (source "cftc") are kept as-is —
     append-once, so ONE successful production run backfills 2006→2023 forever.
  2. Missing years: CFTC disaggregated history zips (hist 2006-2016 + yearly).
     Blocked in some sandboxes — failure is graceful, production succeeds.
  3. Whatever is still missing: the app's own cot.json / cot_recent.json
     (ny.*_old fields, populated 2024→now), source "app".
The current year is always rebuilt from the freshest source available.
"""
import csv
import io
import json
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone

from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json, validate_cot_sept_study

OUT_PATH = OUT_DIR / "sept_positioning.json"

CFTC_HIST_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_hist_2006_2016.zip"
CFTC_YEAR_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
FIRST_YEAR = 2006  # disaggregated format begins 2006-06-13


# ── US market-holiday business days ──────────────────────────────────────────
def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month = (h + m - 7 * n + 114) // 31
    day = ((h + m - 7 * n + 114) % 31) + 1
    return date(y, month, day)


def _observed(d: date) -> date:
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def _nth_weekday(y: int, m: int, weekday: int, n: int) -> date:
    d = date(y, m, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(y: int, m: int, weekday: int) -> date:
    d = date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _us_holidays(y: int) -> set[date]:
    hols = {
        _observed(date(y, 1, 1)),                 # New Year
        _nth_weekday(y, 1, 0, 3),                 # MLK
        _nth_weekday(y, 2, 0, 3),                 # Presidents
        _easter(y) - timedelta(days=2),           # Good Friday (exchange holiday)
        _last_weekday(y, 5, 0),                   # Memorial Day
        _observed(date(y, 7, 4)),                 # Independence Day
        _nth_weekday(y, 9, 0, 1),                 # Labor Day
        _nth_weekday(y, 11, 3, 4),                # Thanksgiving
        _observed(date(y, 12, 25)),               # Christmas
    }
    if y >= 2022:
        hols.add(_observed(date(y, 6, 19)))       # Juneteenth (markets from 2022)
    return hols


def _is_biz(d: date, hols: set[date]) -> bool:
    return d.weekday() < 5 and d not in hols


def _biz_back(d: date, n: int, hols: set[date]) -> date:
    while n > 0:
        d -= timedelta(days=1)
        if _is_biz(d, hols):
            n -= 1
    return d


def _first_biz(y: int, m: int, hols: set[date]) -> date:
    d = date(y, m, 1)
    while not _is_biz(d, hols):
        d += timedelta(days=1)
    return d


def _last_biz(y: int, m: int, hols: set[date]) -> date:
    d = date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)
    while not _is_biz(d, hols):
        d -= timedelta(days=1)
    return d


def key_dates(y: int) -> dict:
    """KC notice/trading dates: FND = 7 biz days before the delivery month's
    first biz day; Last Notice = 7 biz days before its last biz day; LTD = the
    biz day before Last Notice (per the contract-rules paper)."""
    hols = _us_holidays(y)
    out = {}
    for tag, m in (("jul", 7), ("sept", 9)):
        fnd = _biz_back(_first_biz(y, m, hols), 7, hols)
        lnd = _biz_back(_last_biz(y, m, hols), 7, hols)
        out[f"{tag}_fnd"] = fnd
        out[f"{tag}_ltd"] = _biz_back(lnd, 1, hols)
    return out


# ── CFTC download & parse ────────────────────────────────────────────────────
def _int(v) -> int:
    try:
        return int(float(str(v).strip().replace(",", "")))
    except Exception:
        return 0


def _row_date(row: dict):
    iso = (row.get("Report_Date_as_YYYY-MM-DD") or "").strip()
    if iso:
        try:
            return datetime.strptime(iso[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    raw = (row.get("As_of_Date_In_Form_YYMMDD") or "").strip()
    try:
        return datetime.strptime(raw, "%y%m%d").date()
    except ValueError:
        return None


def _get(row: dict, *names) -> int:
    for n in names:
        if n in row and str(row[n]).strip() != "":
            return _int(row[n])
    return 0


def _fetch_cftc_year_rows(url: str) -> list[dict]:
    """Download one CFTC disaggregated zip → normalized Coffee C records."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    out = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            if not (name.endswith(".txt") or name.endswith(".csv")):
                continue
            with z.open(name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
                for row in reader:
                    mkt = (row.get("Market_and_Exchange_Names") or "").upper()
                    if "COFFEE C" not in mkt:
                        continue
                    d = _row_date(row)
                    if d is None:
                        continue
                    rec = {
                        "date": d.isoformat(),
                        "oi": _get(row, "Open_Interest_Old"),
                        "oi_all": _get(row, "Open_Interest_All"),
                        "comm_l": _get(row, "Prod_Merc_Positions_Long_Old"),
                        "comm_s": _get(row, "Prod_Merc_Positions_Short_Old"),
                        "swap_l": _get(row, "Swap_Positions_Long_Old"),
                        "swap_s": _get(row, "Swap__Positions_Short_Old", "Swap_Positions_Short_Old"),
                        "swap_sp": _get(row, "Swap__Positions_Spread_Old", "Swap_Positions_Spread_Old"),
                        "mm_l": _get(row, "M_Money_Positions_Long_Old"),
                        "mm_s": _get(row, "M_Money_Positions_Short_Old"),
                        "mm_sp": _get(row, "M_Money_Positions_Spread_Old"),
                        "oth_l": _get(row, "Other_Rept_Positions_Long_Old"),
                        "oth_s": _get(row, "Other_Rept_Positions_Short_Old"),
                        "oth_sp": _get(row, "Other_Rept_Positions_Spread_Old"),
                        "nr_l": _get(row, "NonRept_Positions_Long_Old"),
                        "nr_s": _get(row, "NonRept_Positions_Short_Old"),
                    }
                    out.append(rec)
    return out


# ── App-data fallback (cot.json / cot_recent.json, ny.*_old) ─────────────────
def _load_json(name: str):
    try:
        return json.loads((OUT_DIR / name).read_text(encoding="utf-8"))
    except Exception:
        return None


def _app_records() -> list[dict]:
    rows = []
    for name in ("cot.json", "cot_recent.json"):
        data = _load_json(name)
        if isinstance(data, list):
            rows.extend(data)
    by_date: dict[str, dict] = {}
    for r in rows:
        ny = (r or {}).get("ny") or {}
        if ny.get("mm_long_old") is None:
            continue
        g = lambda k: ny.get(k) or 0
        # CFTC long-side identity: OI = every cohort's longs + spreads.
        oi_old = (g("pmpu_long_old") + g("swap_long_old") + g("swap_spread_old")
                  + g("mm_long_old") + g("mm_spread_old")
                  + g("other_long_old") + g("other_spread_old") + g("nr_long_old"))
        by_date[r["date"]] = {
            "date": r["date"],
            "oi": oi_old,
            "oi_all": g("oi_total"),
            "comm_l": g("pmpu_long_old"), "comm_s": g("pmpu_short_old"),
            "swap_l": g("swap_long_old"), "swap_s": g("swap_short_old"), "swap_sp": g("swap_spread_old"),
            "mm_l": g("mm_long_old"), "mm_s": g("mm_short_old"), "mm_sp": g("mm_spread_old"),
            "oth_l": g("other_long_old"), "oth_s": g("other_short_old"), "oth_sp": g("other_spread_old"),
            "nr_l": g("nr_long_old"), "nr_s": g("nr_short_old"),
        }
    return sorted(by_date.values(), key=lambda x: x["date"])


# ── Window assembly ──────────────────────────────────────────────────────────
def _build_year(year: int, records: list[dict], source: str) -> dict | None:
    kd = key_dates(year)
    start = kd["jul_fnd"] - timedelta(days=21)
    end = date(year, 8, 31)  # crop-year roll ~Sep 1 ends the window
    rows = []
    for rec in records:
        d = date.fromisoformat(rec["date"])
        if d < start or d > end:
            continue
        if d <= kd["jul_fnd"]:
            phase = "baseline"
        elif d <= kd["jul_ltd"]:
            phase = "jul_delivery"
        elif d <= kd["sept_fnd"]:
            phase = "pure"
        else:
            phase = "sept_delivery"
        r = dict(rec)
        r["dtf"] = (kd["sept_fnd"] - d).days
        r["phase"] = phase
        r["mm_net"] = r["mm_l"] - r["mm_s"]
        r["comm_net"] = r["comm_l"] - r["comm_s"]
        r["share"] = round(r["oi"] / r["oi_all"], 4) if r["oi_all"] else None
        rows.append(r)
    if not rows:
        return None
    return {
        "jul_fnd": kd["jul_fnd"].isoformat(), "jul_ltd": kd["jul_ltd"].isoformat(),
        "sept_fnd": kd["sept_fnd"].isoformat(), "sept_ltd": kd["sept_ltd"].isoformat(),
        "source": source,
        "rows": sorted(rows, key=lambda x: x["date"]),
    }


# ── Event study: does Sept spec length at ~30d before FND predict outcomes? ──
def _nearest(dmap: dict[str, float], target: date, back: int, fwd: int):
    """Value at the date closest to target within [-back, +fwd] days."""
    best, best_gap = None, None
    for off in range(0, max(back, fwd) + 1):
        for sgn in (1, -1):
            d = target + timedelta(days=off * sgn)
            if (sgn < 0 and off > back) or (sgn > 0 and off > fwd):
                continue
            v = dmap.get(d.isoformat())
            if v is not None and (best_gap is None or off < best_gap):
                best, best_gap = v, off
        if best is not None:
            return best
    return None


def _pearson(xs: list[float], ys: list[float]):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return round(sxy / (sxx * syy) ** 0.5, 3)


def _spearman(xs: list[float], ys: list[float]):
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        for pos, i in enumerate(order):
            r[i] = pos
        return r
    return _pearson(rank(xs), rank(ys))


def _load_cert_totals() -> dict[str, float]:
    """Daily KC certified totals (bags), merged across the deep bucket files."""
    out: dict[str, float] = {}
    for p in sorted(OUT_DIR.glob("certified_stocks_arabica_deep_*.json")):
        try:
            for snap in json.loads(p.read_text(encoding="utf-8")).get("snapshots") or []:
                d, t = snap.get("date"), snap.get("total_bags")
                if d and t is not None:
                    out[d] = t
        except Exception:
            continue
    return out


def _row_near(rows: list[dict], dtf_target: int, lo: int, hi: int):
    """Row whose dtf is closest to dtf_target within [lo, hi]."""
    cand = [r for r in rows if lo <= r["dtf"] <= hi]
    return min(cand, key=lambda r: abs(r["dtf"] - dtf_target)) if cand else None


def _build_study(years: dict[str, dict]) -> dict:
    root_data = OUT_DIR.parents[2] / "data" / "kc_sept_dec_contracts.json"
    try:
        contracts = json.loads(root_data.read_text(encoding="utf-8"))
    except Exception:
        contracts = {}
    cert = _load_cert_totals()

    rows = []
    for y, yd in sorted(years.items()):
        r30 = _row_near(yd["rows"], 30, 21, 42)
        if not r30:
            continue
        fnd = date.fromisoformat(yd["sept_fnd"])
        rec: dict = {
            "year": int(y),
            "mm_net_30": r30["mm_net"], "oi_30": r30["oi"], "dtf_30": r30["dtf"],
        }
        r63 = _row_near(yd["rows"], 63, 56, 70)
        r7 = _row_near(yd["rows"], 7, 4, 11)
        r0 = _row_near(yd["rows"], 0, -3, 3)
        if r63 and r63["oi"]:
            rec["oi_rem_7"] = round(r7["oi"] / r63["oi"] * 100, 1) if r7 else None
            rec["oi_rem_0"] = round(r0["oi"] / r63["oi"] * 100, 1) if r0 else None
        rc7 = _row_near(yd["rows"], 7, 4, 11)
        rec["comm_net_7"] = rc7["comm_net"] if rc7 else None
        rec["comm_flip"] = (rc7["comm_net"] > 0) if rc7 else None

        # delivery outcome: certified-stock build FND−3d → FND+28d (bags)
        c0 = _nearest(cert, fnd - timedelta(days=3), back=7, fwd=2)
        c1 = _nearest(cert, fnd + timedelta(days=28), back=6, fwd=7)
        if c0 is not None and c1 is not None:
            rec["cert_build"] = int(c1 - c0)

        # spread outcome: (U − Z) change from the predictor date into FND
        legs = contracts.get(y) or {}
        u, z = legs.get("U") or {}, legs.get("Z") or {}
        if u and z:
            d30 = date.fromisoformat(r30["date"])
            u30, z30 = _nearest(u, d30, 5, 1), _nearest(z, d30, 5, 1)
            uf, zf = _nearest(u, fnd - timedelta(days=1), 5, 0), _nearest(z, fnd - timedelta(days=1), 5, 0)
            if None not in (u30, z30, uf, zf):
                rec["uz_30"] = round(u30 - z30, 2)
                rec["uz_fnd"] = round(uf - zf, 2)
                rec["uz_chg"] = round((uf - zf) - (u30 - z30), 2)
                rec["u_ret"] = round((uf / u30 - 1) * 100, 2) if u30 else None
        rows.append(rec)

    # z-score the predictor across completed rows
    mm = [r["mm_net_30"] for r in rows]
    if len(mm) >= 3:
        mean = sum(mm) / len(mm)
        sd = (sum((v - mean) ** 2 for v in mm) / len(mm)) ** 0.5
        for r in rows:
            r["mm_net_30_z"] = round((r["mm_net_30"] - mean) / sd, 2) if sd else None

    def _agg(okey: str) -> dict | None:
        pairs = [(r["mm_net_30"], r[okey]) for r in rows if r.get(okey) is not None]
        if len(pairs) < 5:
            return None
        xs, ys = [p[0] for p in pairs], [float(p[1]) for p in pairs]
        srt = sorted(pairs, key=lambda p: p[0])
        k = max(1, len(srt) // 3)
        lo = sum(p[1] for p in srt[:k]) / k
        hi = sum(p[1] for p in srt[-k:]) / k
        return {"n": len(pairs), "pearson": _pearson(xs, ys), "spearman": _spearman(xs, ys),
                "bottom_third_mean": round(lo, 1), "top_third_mean": round(hi, 1)}

    flips = [r["cert_build"] for r in rows if r.get("comm_flip") is True and r.get("cert_build") is not None]
    noflips = [r["cert_build"] for r in rows if r.get("comm_flip") is False and r.get("cert_build") is not None]
    return {
        "predictor": "mm_net_30 — Sept old-bucket managed-money net at the COT closest to 30d before Sept FND",
        "outcomes": {
            "uz_chg": _agg("uz_chg"),
            "cert_build": _agg("cert_build"),
            "oi_rem_7": _agg("oi_rem_7"),
            "oi_rem_0": _agg("oi_rem_0"),
        },
        "comm_flip_cert": {
            "flip_mean": round(sum(flips) / len(flips), 0) if flips else None, "flip_n": len(flips),
            "noflip_mean": round(sum(noflips) / len(noflips), 0) if noflips else None, "noflip_n": len(noflips),
        },
        "rows": rows,
        "notes": "uz_chg = Δ(U−Z) c/lb from ~30d-before-FND into FND−1d (negative = Sept weakened vs Dec, roll "
                 "pressure). cert_build = Δ certified bags FND−3d → FND+28d (deep files, 2011+). oi_rem_* = OI at "
                 "7d/0d as % of the 63d level. Small n — read as direction, not significance.",
    }


def export_cot_sept_study() -> None:
    today = datetime.now(timezone.utc).date()
    current_year = today.year if today.month <= 9 else today.year + 1

    existing = (_load_json("sept_positioning.json") or {}).get("years") or {}
    years: dict[str, dict] = {
        y: v for y, v in existing.items()
        if v.get("source") == "cftc" and int(y) < current_year   # append-once cache
    }

    # Which years still need building from a live source?
    needed = [y for y in range(FIRST_YEAR, current_year + 1) if str(y) not in years]

    fetched: dict[int, list[dict]] = {}
    if needed:
        urls = []
        if any(y <= 2016 for y in needed):
            urls.append((CFTC_HIST_URL, "hist"))
        urls += [(CFTC_YEAR_URL.format(year=y), y) for y in needed if y > 2016]
        for url, tag in urls:
            try:
                recs = _fetch_cftc_year_rows(url)
                for rec in recs:
                    yy = int(rec["date"][:4])
                    fetched.setdefault(yy, []).append(rec)
                print(f"  cot_sept_study → fetched {tag}: {len(recs)} Coffee C rows")
            except Exception as e:
                print(f"  cot_sept_study → CFTC fetch unavailable ({tag}): {e}")

    app_recs = _app_records()
    app_by_year: dict[int, list[dict]] = {}
    for rec in app_recs:
        app_by_year.setdefault(int(rec["date"][:4]), []).append(rec)

    for y in needed:
        if y in fetched:
            built = _build_year(y, fetched[y], "cftc")
        elif y in app_by_year:
            built = _build_year(y, app_by_year[y], "app")
        else:
            built = None
        if built:
            years[str(y)] = built

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "market": "KC Coffee C (ICE Futures U.S.) — CFTC disaggregated futures-only, old-crop bucket",
        "current_year": current_year,
        "meta": {
            "premise": "Sept is the last month of the Oct–Sep coffee crop year: after July's last "
                       "trade the CFTC 'old' bucket = the September contract alone.",
            "phases": {
                "baseline": "≤ July FND — old = July + September",
                "jul_delivery": "July FND → July LTD — September + a shrinking July stub",
                "pure": "July LTD → Sept FND — September exactly",
                "sept_delivery": "Sept FND → Aug 31 — September in its own notice period",
            },
            "window_end": "Aug 31 — the CFTC rolls the crop-year buckets ~Sep 1",
            "dtf": "days to September First Notice Day (positive = before FND)",
            "units": "contracts (lots of 37,500 lb)",
        },
        "years": dict(sorted(years.items())),
        "study": _build_study(years),
    }
    safe_write_json(OUT_PATH, payload, validate_cot_sept_study)
    n_rows = sum(len(v["rows"]) for v in years.values())
    srcs = {v["source"] for v in years.values()}
    print(f"  sept_positioning.json → {len(years)} Septembers ({min(years) if years else '—'}–"
          f"{max(years) if years else '—'}), {n_rows} rows, sources={sorted(srcs)}")
