"""
Diagnostic probe #4 (verification): confirm the rewritten cepea.py parses the
live noticiasagricolas CEPEA/ESALQ indicators end-to-end in CI.

Removed once the fix lands.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

from scraper.sources.cepea import (  # noqa: E402
    _NA_ARABICA,
    _NA_CONILON,
    _http_get,
    _parse_indicator,
)


def main() -> None:
    for name, url in [("Arabica", _NA_ARABICA), ("Conilon (Robusta)", _NA_CONILON)]:
        html = _http_get(url)
        if not html:
            print(f"[verify] {name}: fetch FAILED")
            continue
        price, date_str = _parse_indicator(html)
        print(f"[verify] {name}: price={price!r} date={date_str!r}  ({len(html)} bytes)")


if __name__ == "__main__":
    main()
