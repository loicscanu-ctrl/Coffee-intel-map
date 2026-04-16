"""
CONAB monthly scraper.
Fetches Brazil coffee production data from two sources:
  1. Safra bulletin — acreage + yield KPIs
  2. Custos de Produção report — production cost breakdown (Excel)
"""
from __future__ import annotations

import io
import json
import logging
import re
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONAB_SAFRA_URL  = "https://www.conab.gov.br/info-agro/safras/cafe"
CONAB_CUSTOS_URL = "https://www.conab.gov.br/info-agro/custos-de-producao/cafe"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

# Cost component mapping: regex pattern → (English label, hex color)
_COST_COMPONENT_MAP = {
    r"insumo":               ("Inputs",        "#3b82f6"),
    r"m[ãa]o.de.obra|m\.o": ("Labor",         "#22c55e"),
    r"mecaniza":             ("Mechanization", "#f59e0b"),
    r"arrendamento":         ("Land rent",     "#8b5cf6"),
    r"administra":           ("Admin",         "#475569"),
}

# Input detail mapping: regex → English label
_INPUT_DETAIL_MAP = {
    r"nitrog|ur[eé]ia|sal.amonio": "Nitrogen (urea / AN)",
    r"pot[áa]ssio|kcl":           "Potassium (KCl)",
    r"f[oó]sforo|map|dap":        "Phosphorus (MAP)",
    r"defensivo|pesticida":       "Pesticides / fungicides",
    r"cal[cç]á|lime|corretivo":   "Lime / soil correction",
}


# ---------------------------------------------------------------------------
# Pure parsing helpers (no I/O, fully testable)
# ---------------------------------------------------------------------------

def _brl_to_float(s: str) -> float | None:
    """Convert Brazilian number format '2.240,5' → 2240.5. Return None on empty/invalid."""
    s = s.strip()
    if not s:
        return None
    try:
        # Remove thousands separator (dot) and replace decimal separator (comma) with dot
        cleaned = s.replace(".", "").replace(",", ".")
        return float(cleaned)
    except (ValueError, AttributeError):
        return None


def _parse_conab_safra_html(html: str) -> dict | None:
    """Extract Brazil total harvested area (thousand ha) and yield (bags/ha).

    Look for a table where the first column of a row matches 'brasil' (case-insensitive).
    Return {"harvested_area_kha": float, "yield_bags_ha": float} or None if not found.
    The area is in column index 1 (second column), yield in column index 2 (third column).
    """
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if not cells:
                continue
            first_cell = cells[0].get_text(strip=True)
            if first_cell.lower() == "brasil":
                if len(cells) < 3:
                    continue
                area = _brl_to_float(cells[1].get_text(strip=True))
                yld  = _brl_to_float(cells[2].get_text(strip=True))
                if area is not None and yld is not None:
                    return {
                        "harvested_area_kha": area,
                        "yield_bags_ha": yld,
                    }

    return None


def _parse_conab_custos_excel(content: bytes, brl_usd: float) -> dict | None:
    """Parse CONAB Custos Excel. Try 'Sul de Minas' sheet first, fall back to wb.active.

    Iterate rows. For each row: get label from col A (str), find first positive numeric value in row.
    - Match label against _COST_COMPONENT_MAP patterns → append to components_brl
    - Match label against _INPUT_DETAIL_MAP patterns → append to inputs_detail_brl
    - Match r"custo total|total geral" → set total_brl

    Return None if components_brl is empty or total_brl is None.
    """
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)

    if "Sul de Minas" in wb.sheetnames:
        ws = wb["Sul de Minas"]
    else:
        ws = wb.active

    components_brl: list[dict] = []
    inputs_detail_brl: list[dict] = []
    total_brl: float | None = None

    for row in ws.iter_rows(values_only=True):
        if not row:
            continue

        # Get label from first column
        label_raw = row[0]
        if not isinstance(label_raw, str):
            continue
        label_raw = label_raw.strip()
        if not label_raw:
            continue

        label_lower = label_raw.lower()

        # Find first positive numeric value in the row
        value: float | None = None
        for cell in row[1:]:
            if isinstance(cell, (int, float)) and cell is not None and cell > 0:
                value = float(cell)
                break
            if isinstance(cell, str):
                parsed = _brl_to_float(cell)
                if parsed is not None and parsed > 0:
                    value = parsed
                    break

        if value is None:
            continue

        # Check for total
        if re.search(r"custo total|total geral", label_lower):
            total_brl = value
            continue

        # Check cost component map
        matched_component = False
        for pattern, (eng_label, color) in _COST_COMPONENT_MAP.items():
            if re.search(pattern, label_lower):
                components_brl.append({
                    "label":    eng_label,
                    "label_pt": label_raw,
                    "brl":      value,
                    "color":    color,
                })
                matched_component = True
                break

        if matched_component:
            continue

        # Check input detail map
        for pattern, eng_label in _INPUT_DETAIL_MAP.items():
            if re.search(pattern, label_lower):
                inputs_detail_brl.append({
                    "label": eng_label,
                    "brl":   value,
                })
                break

    wb.close()

    if not components_brl or total_brl is None:
        return None

    return {
        "season":               _current_season(),
        "total_brl_per_bag":    total_brl,
        "prev_total_brl_per_bag": None,  # caller fills from previous DB item
        "brl_usd":              brl_usd,
        "components_brl":       components_brl,
        "inputs_detail_brl":    inputs_detail_brl,
        "source_label":         f"CONAB Custos {date.today():%b %Y}",
    }


# ---------------------------------------------------------------------------
# DB-writing helpers
# ---------------------------------------------------------------------------

def _current_season() -> str:
    """Return current crop-year label, e.g. '2025/26'. Brazil crop year starts July."""
    today = date.today()
    if today.month >= 7:
        return f"{today.year}/{str(today.year + 1)[-2:]}"
    else:
        return f"{today.year - 1}/{str(today.year)[-2:]}"


def _get_brl_usd() -> float:
    """Fetch current BRL/USD rate via yfinance ticker 'BRL=X'. Return 5.0 on any failure."""
    try:
        import yfinance as yf
        ticker = yf.Ticker("BRL=X")
        info = ticker.fast_info
        rate = float(info.last_price)
        if rate and rate > 0:
            return rate
        return 5.0
    except Exception:
        return 5.0


def _scrape_acreage_yield(db) -> None:
    """Fetch CONAB Safra page, parse HTML, upsert NewsItem."""
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import NewsItem
    from sqlalchemy import delete

    try:
        resp = requests.get(CONAB_SAFRA_URL, headers=_HEADERS, timeout=30)
        resp.raise_for_status()
        parsed = _parse_conab_safra_html(resp.text)

        if parsed is None:
            logger.warning("[conab_supply] Safra: could not parse Brazil row — retaining previous data")
            return

        # Read previous values for YoY comparison
        prev_meta: dict = {}
        existing = db.query(NewsItem).filter(NewsItem.source == "CONAB Safra").first()
        if existing and existing.meta:
            try:
                prev_meta = json.loads(existing.meta)
            except (json.JSONDecodeError, TypeError):
                prev_meta = {}

        # Delete existing and insert fresh
        db.execute(delete(NewsItem).where(NewsItem.source == "CONAB Safra"))
        db.add(NewsItem(
            title=f"CONAB Acreage Yield – {_current_season()}",
            source="CONAB Safra",
            category="supply",
            tags=["conab", "supply", "brazil", "acreage"],
            meta=json.dumps({
                "season":              _current_season(),
                "harvested_area_kha":  parsed["harvested_area_kha"],
                "prev_area_kha":       prev_meta.get("harvested_area_kha"),
                "yield_bags_ha":       parsed["yield_bags_ha"],
                "prev_yield_bags_ha":  prev_meta.get("yield_bags_ha"),
                "source_label":        f"CONAB Safra {date.today():%b %Y}",
            }),
            pub_date=datetime.utcnow(),
        ))
        db.commit()
        print(f"[conab_supply] Safra OK — area={parsed['harvested_area_kha']} kha, "
              f"yield={parsed['yield_bags_ha']} bags/ha")

    except Exception as e:
        db.rollback()
        logger.error(f"[conab_supply] Safra FAILED: {e}")


def _scrape_production_cost(db) -> None:
    """Fetch CONAB Custos page, find first .xlsx/.xls link, download and parse."""
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import NewsItem
    from sqlalchemy import delete

    try:
        brl_usd = _get_brl_usd()

        resp = requests.get(CONAB_CUSTOS_URL, headers=_HEADERS, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # Find first link ending in .xlsx or .xls
        xlsx_link = None
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.lower().endswith(".xlsx") or href.lower().endswith(".xls"):
                xlsx_link = href
                break

        if xlsx_link is None:
            logger.warning("[conab_supply] Custos: no .xlsx/.xls link found — retaining previous data")
            return

        # Prepend base URL if relative
        if not xlsx_link.startswith("http"):
            xlsx_link = "https://www.conab.gov.br" + xlsx_link

        xls_resp = requests.get(xlsx_link, headers=_HEADERS, timeout=60)
        xls_resp.raise_for_status()

        # Read previous total for YoY
        prev_total: float | None = None
        existing = db.query(NewsItem).filter(NewsItem.source == "CONAB Custos").first()
        if existing and existing.meta:
            try:
                prev_total = json.loads(existing.meta).get("total_brl_per_bag")
            except (json.JSONDecodeError, TypeError):
                prev_total = None

        parsed = _parse_conab_custos_excel(xls_resp.content, brl_usd)

        if parsed is None:
            logger.warning("[conab_supply] Custos: could not parse Excel — retaining previous data")
            return

        # Fill in previous total
        parsed["prev_total_brl_per_bag"] = prev_total

        db.execute(delete(NewsItem).where(NewsItem.source == "CONAB Custos"))
        db.add(NewsItem(
            title=f"CONAB Production Cost – {_current_season()}",
            source="CONAB Custos",
            category="supply",
            tags=["conab", "supply", "brazil", "cost"],
            meta=json.dumps(parsed),
            pub_date=datetime.utcnow(),
        ))
        db.commit()
        print(f"[conab_supply] Custos OK — total={parsed['total_brl_per_bag']} BRL/bag, "
              f"components={len(parsed['components_brl'])}")

    except Exception as e:
        db.rollback()
        logger.error(f"[conab_supply] Custos FAILED: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def run(db) -> None:
    """Monthly entry point. Called from run_monthly.py."""
    _scrape_acreage_yield(db)
    _scrape_production_cost(db)
