"""Sample-based tests for the ICE certified-stocks parsers.

Sample text is taken VERBATIM from the live probe run (the inline previews from
debug/ice_probe/*.{csv,txt}). If the source format drifts in production, these
tests are the canary."""
from __future__ import annotations

from scraper.sources.ice_certified_stocks.parse_gradings import parse_gradings
from scraper.sources.ice_certified_stocks.parse_iss_recv import (
    parse_iss_recv_daily,
    parse_iss_recv_monthly,
)
from scraper.sources.ice_certified_stocks.parse_stock_report import parse_stock_report
from scraper.sources.ice_certified_stocks.parse_tenders import parse_tenders

# ── 1. Robusta stock report (CSV) ────────────────────────────────────────────

STOCK_REPORT_SAMPLE = (
    '"Commodity","CutOffDate","PortId","LotsWithValCert","LotsNonTend","LotsSuspended"\n'
    '"RC","26-May-2026","AMS","0","0","0"\n'
    '"RC","26-May-2026","ANT","2114","1","0"\n'
    '"RC","26-May-2026","BAR","9","0","0"\n'
    '"RC","26-May-2026","BRE","0","0","0"\n'
    '"RC","26-May-2026","FEL","34","0","0"\n'
    '"RC","26-May-2026","HAM","0","0","0"\n'
    '"RC","26-May-2026","LEH","0","0","0"\n'
    '"RC","26-May-2026","LIV","0","0","0"\n'
    '"RC","26-May-2026","LON","1764","0","0"\n'
    '"RC","26-May-2026","NOR","0","0","0"\n'
    '"RC","26-May-2026","ROT","0","0","0"\n'
    '"RC","26-May-2026","TRI","0","0","0"\n'
    '"GrandTotal","","","3921","1","0"\n'
)


def test_stock_report():
    r = parse_stock_report(STOCK_REPORT_SAMPLE)
    assert r["cut_off_date"] == "2026-05-26"
    assert r["grand_total"] == {"with_val_cert": 3921, "non_tend": 1, "suspended": 0}
    # 12 ports parsed; ANT (2114) and LON (1764) dominate; rest mostly 0.
    assert len(r["ports"]) == 12
    by_id = {p["port_id"]: p for p in r["ports"]}
    assert by_id["ANT"]["with_val_cert"] == 2114
    assert by_id["ANT"]["non_tend"] == 1
    assert by_id["ANT"]["port_name"] == "Antwerp"
    assert by_id["LON"]["with_val_cert"] == 1764
    assert by_id["LON"]["port_name"] == "London"
    # Sum reconciles to grand total.
    assert sum(p["with_val_cert"] for p in r["ports"]) == 3921


# ── 2. Robusta gradings (TXT) ────────────────────────────────────────────────

GRADINGS_SAMPLE = (
    "                                        ICE EU GUARDIAN - Robusta 409 MARKET GRADING                       21-May-2026 17:00\n"
    "Commodity: Robusta 409   Panel Date: 21-May-2026   Panel Time: 08:00\n"
    "UK LOTS\n"
    "                                    Origin                                    Port Class    Total      No.\n"
    "                                                                               ID           Allow.    Lots\n"
    "Brazilian Conillon                                                            LON       1      0.000      48\n"
    "Brazilian Conillon                                                            LON       2    -30.000     106\n"
    "Brazilian Conillon                                                            LON       4    -90.000       1\n"
    "                                                                                                         155\n"
    "                                                   Page   1\n"
    "                                                       Units     Month\n"
    "                                                                 Total\n"
    "Total Tenderable Lots                                    155       586\n"
    "Total Non-Tenderable Lots                                  0         0\n"
    "Total Lots Graded                                        155       586\n"
)


def test_gradings():
    r = parse_gradings(GRADINGS_SAMPLE)
    assert r["panel_date"] == "2026-05-21"
    assert r["panel_time"] == "08:00"
    assert r["report_date"] == "2026-05-21"
    assert len(r["entries"]) == 3
    e0 = r["entries"][0]
    assert e0["origin"] == "Brazilian Conillon"
    assert e0["port"] == "LON"
    assert e0["section"] == "UK LOTS"
    assert e0["class"] == 1
    assert e0["allowance_cts_lb"] == 0.0
    assert e0["lots"] == 48
    assert e0["tenderable"] is True
    assert r["entries"][2]["allowance_cts_lb"] == -90.0
    assert r["entries"][2]["lots"] == 1
    s = r["summary"]
    assert s["tenderable_today"] == 155 and s["tenderable_month"] == 586
    assert s["lots_graded_today"] == 155 and s["lots_graded_month"] == 586


# ── 3. Grading appeals — same parser ─────────────────────────────────────────

APPEALS_SAMPLE = (
    "                                        ICE EU GUARDIAN - Robusta 409 MARKET GRADING - APPEALS                       23-Sep-2025 17:07\n"
    "Commodity: Robusta 409   Panel Date: 23-Sep-2025   Panel Time: 08:00\n"
    "CONTINENTAL LOTS\n"
    "                                    Origin                                    Port Class    Total      No.\n"
    "                                                                               ID           Allow.    Lots\n"
    "Cameroon                                                                      ANT         Non Tender       1\n"
    "Cote d'Ivoire                                                                 ANT         Non Tender       1\n"
    "                                                   Page   1\n"
    "                                                       Units   Monthly\n"
    "                                                                 Total\n"
    "Total Tenderable Lots                                      0         0\n"
    "Total Non-Tenderable Lots                                  2         2\n"
    "Total Lots Graded                                          2         2\n"
)


def test_grading_appeals():
    r = parse_gradings(APPEALS_SAMPLE)
    assert r["panel_date"] == "2025-09-23"
    assert len(r["entries"]) == 2
    e = r["entries"][0]
    assert e["origin"] == "Cameroon"
    assert e["port"] == "ANT"
    assert e["section"] == "CONTINENTAL LOTS"
    assert e["tenderable"] is False
    assert e["class"] is None
    assert e["allowance_cts_lb"] is None
    assert e["lots"] == 1
    assert r["entries"][1]["origin"] == "Cote d'Ivoire"
    assert r["summary"]["non_tenderable_today"] == 2
    assert r["summary"]["lots_graded_today"] == 2


# ── 4. Issuers/receivers daily ───────────────────────────────────────────────

IR_DAILY_SAMPLE = (
    "                                   ICE EU Guardian - DAILY ISSUERS/RECEIVERS REPORT - 22-May-2026 RC                     22-May-2026 16:01\n"
    "Commodity : RC Delivery : 22-May-2026\n"
    "                                        Sold    Bought\n"
    "Tenders for : FIM\n"
    "     Brazilian Conillon                  155         0\n"
    "Total For Member                         155         0\n"
    "Tenders for : ICS\n"
    "     Brazilian Conillon                    0       155\n"
    "Total For Member                           0       155\n"
    "Total                                    155       155\n"
)


def test_iss_recv_daily():
    r = parse_iss_recv_daily(IR_DAILY_SAMPLE)
    assert r["report_date"] == "2026-05-22"
    assert r["delivery_date"] == "2026-05-22"
    assert len(r["members"]) == 2
    fim, ics = r["members"]
    assert fim["code"] == "FIM" and fim["total_sold"] == 155 and fim["total_bought"] == 0
    assert fim["rows"] == [{"origin": "Brazilian Conillon", "sold": 155, "bought": 0}]
    assert ics["code"] == "ICS" and ics["total_sold"] == 0 and ics["total_bought"] == 155
    assert r["grand_total"] == {"sold": 155, "bought": 155}


# ── 5. Issuers/receivers monthly ─────────────────────────────────────────────

IR_MONTHLY_SAMPLE = (
    "                                   ICE EU Guardian - MONTH END ISSUERS/RECEIVERS REPORT - Mar-2026 RC                     31-Mar-2026 16:01\n"
    "Commodity : RC Delivery : Mar-2026\n"
    "                                        Sold    Bought\n"
    "ADU                                        3         3\n"
    "ICS                                      353       331\n"
    "MFL                                        8         8\n"
    "SCD                                        0        22\n"
    "Total                                    364       364\n"
)


def test_iss_recv_monthly():
    r = parse_iss_recv_monthly(IR_MONTHLY_SAMPLE)
    assert r["report_date"] == "2026-03-31"
    assert r["month"] == "2026-03"
    assert len(r["members"]) == 4
    codes = [m["code"] for m in r["members"]]
    assert codes == ["ADU", "ICS", "MFL", "SCD"]
    assert r["members"][1] == {"code": "ICS", "sold": 353, "bought": 331}
    assert r["grand_total"] == {"sold": 364, "bought": 364}


# ── 6. Tenders ───────────────────────────────────────────────────────────────

TENDERS_SAMPLE = (
    "                                   ICE EU Guardian - MARKET DELIVERY REPORT - 22-May-2026 RC                     22-May-2026 16:01\n"
    "Commodity : RC Delivery Period: May-2026 Business Date : 22-May-2026\n"
    "Original Tender Date : 22-May-2026      Today          Over Month\n"
    "     Angola\n"
    "     Originals:                            0                   1\n"
    "     Retenders:                            0                   0\n"
    "     Brazilian Conillon\n"
    "     Originals:                          155                 934\n"
    "     Retenders:                            0                   0\n"
    "     Indonesia\n"
    "     Originals:                            0                 407\n"
    "     Retenders:                            0                   0\n"
    "     Vietnam\n"
    "     Originals:                            0                   4\n"
    "     Retenders:                            0                   0\n"
    "Totals for 22-May-2026\n"
    "     Originals:                          155                1346\n"
    "     Retenders:                            0                   0\n"
    "GRAND TOTALS:\n"
    "     Originals:                          155                1346\n"
    "     Retenders:                            0                   0\n"
    "     Originals Rejected:                   0                   0\n"
    "     Retenders Rejected:                   0                   0\n"
    "     Originals Withdrawn:                  0                   0\n"
    "     Retenders Withdrawn:                  0                   0\n"
    "     Originals Substituted:                0                   0\n"
    "     Retenders Substituted:                0                   0\n"
    "     Original Substitutions:               0                   0\n"
    "     Retender Substitutions:               0                   0\n"
)


def test_tenders():
    r = parse_tenders(TENDERS_SAMPLE)
    assert r["report_date"] == "2026-05-22"
    assert r["delivery_period"] == "2026-05"
    assert r["business_date"] == "2026-05-22"
    assert len(r["by_origin"]) == 4
    origins = {o["origin"]: o for o in r["by_origin"]}
    assert origins["Brazilian Conillon"]["originals_today"] == 155
    assert origins["Brazilian Conillon"]["originals_month"] == 934
    assert origins["Indonesia"]["originals_month"] == 407
    assert origins["Vietnam"]["originals_today"] == 0
    assert r["totals_today"]["originals"] == 155
    assert r["totals_today"]["originals_month"] == 1346
    assert r["grand_totals"]["originals"] == 155
    assert r["grand_totals"]["originals_rejected"] == 0
