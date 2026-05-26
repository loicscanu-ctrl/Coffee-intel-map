"""Shared paths for the per-topic exporter modules.

ROOT/OUT_DIR live here (rather than in export_static_json) so the split-out
exporter modules and the orchestrator can share them without a circular import.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]          # backend/scraper/exporters/base.py → repo root
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Phase-3 sunset signal: set True (via `base.LATEST_PRICES_FALLBACK = True`) when
# the price exporters fall back to NewsItem regex parsing. Read by export_health
# and surfaced in health.json so CI can assert it stays False. Lives here as
# shared cross-module state (prices.py writes it, health.py reads it).
LATEST_PRICES_FALLBACK = False
