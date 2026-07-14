"""
Diagnostic probe #2: find a Cloudflare-free source for the Brazil Arabica
(CEPEA/ESALQ) physical price.

Probe #1 established CEPEA is hard-walled by Cloudflare in CI (403 on every URL,
challenge page on render). This probe looks for an alternative that CI can reach:

  A) BCB SGS API (api.bcb.gov.br) — the same clean gov JSON that feeds
     brazil_conilon. Sweep the coffee cluster (4330-4340) plus 1/7/8, print each
     series' latest row so we can see which arabica/conilon series are still
     live (4332 arabica is believed dead since May 2026).
  B) A couple of Brazilian mirrors that republish the CEPEA arábica indicator,
     to see whether any is fetchable without a bot challenge.

Pure diagnostic — no DB, no commits. Run via the "Probe: CEPEA" workflow.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

PRICE_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")


def _get(url: str, headers: dict | None = None, timeout: int = 30):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def bcb_series(code: int) -> None:
    """Print the latest row of a BCB SGS series (and whether it has 2026 data)."""
    last_url = (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}"
                f"/dados/ultimos/3?formato=json")
    try:
        st, body = _get(last_url)
        rows = json.loads(body) if body.strip().startswith("[") else []
        latest = rows[-1] if rows else None
        has2026 = any(str(r.get("data", "")).endswith("2026") for r in rows)
        print(f"  SGS {code}: HTTP {st}  rows={len(rows)}  latest={latest}  2026={has2026}")
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:120]
        print(f"  SGS {code}: FAILED {type(e).__name__}: {msg}")


def mirror(url: str) -> None:
    print(f"\n[mirror] {url}")
    try:
        st, body = _get(url, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "pt-BR,pt;q=0.9",
        })
        prices = PRICE_RE.findall(body)
        low = body.lower()
        cf = any(s in low for s in ("just a moment", "cloudflare", "verificação de segurança",
                                    "attention required", "captcha"))
        # show a little context around "arábica"/"arabica" if present
        idx = low.find("arábica")
        if idx < 0:
            idx = low.find("arabica")
        ctx = body[max(0, idx - 40):idx + 120].replace("\n", " ") if idx >= 0 else ""
        print(f"   HTTP {st}  {len(body)} bytes  cf_challenge={cf}  prices={len(prices)} (first {prices[:6]})")
        if ctx:
            print(f"   arabica ctx: {ctx!r}")
    except Exception as e:  # noqa: BLE001
        print(f"   FAILED {type(e).__name__}: {str(e)[:140]}")


def main() -> None:
    print("=== (A) BCB SGS coffee-cluster sweep ===")
    for code in [1, 7, 8, 4330, 4331, 4332, 4333, 4334, 4335, 4336, 4337, 4338, 4339, 4340,
                 27574, 27575, 24369, 24370]:
        bcb_series(code)

    print("\n=== (B) Brazilian CEPEA-arabica mirrors ===")
    for url in [
        "https://www.noticiasagricolas.com.br/cotacoes/cafe",
        "https://www.melhorcambio.com/cafe-hoje",
        "https://www.canalrural.com.br/precos-agropecuarios/cafe/",
        "https://www.notasagricolas.com.br/cafe",
    ]:
        mirror(url)


if __name__ == "__main__":
    main()
