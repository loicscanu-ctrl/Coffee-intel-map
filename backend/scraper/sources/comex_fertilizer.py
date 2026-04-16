"""
comex_fertilizer.py — Monthly Playwright scraper for Brazil fertilizer imports.
Source: Comex Stat MDIC (https://comexstat.mdic.gov.br/pt/geral)
NCM Chapter 31: Urea, KCl, MAP, DAP.
Called from run_monthly.py.
"""

import os
import sys
import re
from datetime import datetime, date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

COMEX_STAT_URL = "https://comexstat.mdic.gov.br/pt/geral"

NCM_LABELS = {
    "31021010": "Urea",
    "31042010": "KCl",
    "31052000": "MAP",
    "31054000": "DAP",
}

# Portuguese month abbreviations (case-insensitive lookup via .lower())
_PT_MONTHS = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4,
    "mai": 5, "jun": 6, "jul": 7, "ago": 8,
    "set": 9, "out": 10, "nov": 11, "dez": 12,
}


def _month_str_to_date(month_str: str) -> date | None:
    """Convert date strings to date(year, month, 1).

    Handles formats:
    - "2026-01"           → date(2026, 1, 1)
    - "Jan/2026" or "jan/2026" → date(2026, 1, 1)  (PT month abbrev)
    - Full PT month names like "Janeiro/2026" → date(2026, 1, 1)
    Returns None on unrecognised format.
    """
    if not month_str or not month_str.strip():
        return None

    s = month_str.strip()

    # ISO format: "YYYY-MM"
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), 1)
        except ValueError:
            return None

    # PT abbreviation or full month name: "<month_part>/<year>"
    m = re.fullmatch(r"([A-Za-zç]+)/(\d{4})", s)
    if m:
        month_part = m.group(1).lower()
        year = int(m.group(2))
        # Try 3-letter abbreviation first
        month_num = _PT_MONTHS.get(month_part[:3])
        if month_num:
            try:
                return date(year, month_num, 1)
            except ValueError:
                return None

    return None


def _parse_int(s: str) -> int | None:
    """Strip non-digit characters and return int, or None if empty/no digits."""
    if not s or not s.strip():
        return None
    digits = re.sub(r"[^\d]", "", s)
    if not digits:
        return None
    return int(digits)


async def run(page, db) -> None:
    """
    Navigate Comex Stat UI and extract NCM Chapter 31 fertilizer import data.
    On failure, logs the error and retains existing DB data (does NOT raise).

    Strategy:
    1. Navigate to COMEX_STAT_URL, wait for page to settle
    2. Try to interact with the query form to filter by NCM Chapter 31
    3. Extract data from the rendered table via page.evaluate()
    4. For each row with a matching NCM code:
       - Delete existing FertilizerImport(month=month_dt, ncm_code=ncm_code)
       - Insert new FertilizerImport(month, ncm_code, ncm_label, net_weight_kg, fob_usd, scraped_at)
    5. db.commit()
    6. On ANY exception: db.rollback(), log the error, return gracefully
    """
    try:
        from models import FertilizerImport
    except ImportError:
        import importlib.util, pathlib
        spec = importlib.util.spec_from_file_location(
            "models",
            pathlib.Path(__file__).parents[2] / "models.py",
        )
        models_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(models_mod)
        FertilizerImport = models_mod.FertilizerImport

    try:
        print(f"[comex_fertilizer] Navigating to {COMEX_STAT_URL}")
        await page.goto(COMEX_STAT_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)

        # Attempt to set NCM filter to Chapter 31 via the query form.
        # The Comex Stat UI is an Angular SPA; selectors may change over time.
        # This is best-effort — if anything fails we catch and bail gracefully.

        # Try clicking/typing in the NCM chapter filter field
        ncm_input_selector = "input[placeholder*='NCM'], input[placeholder*='ncm'], input[aria-label*='NCM']"
        try:
            await page.wait_for_selector(ncm_input_selector, timeout=10000)
            await page.fill(ncm_input_selector, "31")
            await page.wait_for_timeout(2000)
            # Press Enter or click a search/apply button
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[comex_fertilizer] NCM filter interaction failed (non-fatal): {e}")

        # Try to click a "Consultar" / "Pesquisar" / search button if present
        try:
            search_btn = page.locator(
                "button:has-text('Consultar'), button:has-text('Pesquisar'), button:has-text('Buscar')"
            ).first
            await search_btn.click(timeout=5000)
            await page.wait_for_timeout(5000)
        except Exception:
            pass  # No such button visible or timed out — continue

        # Extract table data via JS evaluation
        rows = await page.evaluate("""
            () => {
                const results = [];
                const tables = document.querySelectorAll('table');
                tables.forEach(table => {
                    const headers = [];
                    const headerCells = table.querySelectorAll('thead th, thead td');
                    headerCells.forEach(th => headers.push(th.innerText.trim()));

                    table.querySelectorAll('tbody tr').forEach(tr => {
                        const cells = tr.querySelectorAll('td');
                        const row = {};
                        cells.forEach((td, i) => {
                            row[headers[i] || String(i)] = td.innerText.trim();
                        });
                        results.push(row);
                    });
                });
                return results;
            }
        """)

        inserted = 0
        for row in rows:
            # Normalise keys to lowercase for flexible matching
            row_lower = {k.lower(): v for k, v in row.items()}

            # Find NCM code in the row
            ncm_code = None
            for key in ("ncm", "código ncm", "codigo ncm", "ncm_code", "0"):
                val = row_lower.get(key, "")
                # Strip non-digit characters and check if it matches a known code
                candidate = re.sub(r"\D", "", val)
                if candidate in NCM_LABELS:
                    ncm_code = candidate
                    break

            if not ncm_code:
                continue

            # Find month value
            month_dt = None
            for key in ("mês", "mes", "month", "período", "periodo", "data", "1"):
                val = row_lower.get(key, "")
                month_dt = _month_str_to_date(val)
                if month_dt:
                    break

            if not month_dt:
                continue

            # Net weight (kg)
            net_kg = None
            for key in ("kg líquido", "kg liquido", "peso líquido", "peso liquido",
                        "net weight", "net_weight_kg", "2", "3"):
                val = row_lower.get(key, "")
                if val:
                    net_kg = _parse_int(val)
                    break

            # FOB value (USD)
            fob_usd = None
            for key in ("us$ fob", "usd fob", "valor fob", "fob_usd",
                        "fob usd", "valor us$ fob", "3", "4"):
                val = row_lower.get(key, "")
                if val:
                    parsed = _parse_int(val)
                    fob_usd = float(parsed) if parsed is not None else None
                    break

            # Upsert: delete existing then insert
            db.query(FertilizerImport).filter(
                FertilizerImport.month == month_dt,
                FertilizerImport.ncm_code == ncm_code,
            ).delete(synchronize_session=False)

            db.add(FertilizerImport(
                month=month_dt,
                ncm_code=ncm_code,
                ncm_label=NCM_LABELS[ncm_code],
                net_weight_kg=net_kg,
                fob_usd=fob_usd,
                scraped_at=datetime.utcnow(),
            ))
            inserted += 1

        db.commit()
        print(f"[comex_fertilizer] Done. {inserted} rows upserted.")

    except Exception as e:
        db.rollback()
        print(f"[comex_fertilizer] ERROR: {e}")
        return
