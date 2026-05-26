"""Shared paths for the per-topic exporter modules.

ROOT/OUT_DIR live here (rather than in export_static_json) so the split-out
exporter modules and the orchestrator can share them without a circular import.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]          # backend/scraper/exporters/base.py → repo root
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)
