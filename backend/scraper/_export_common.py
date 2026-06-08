"""Shared helpers for the per-origin export_*.py scripts.

These three were duplicated verbatim across export_colombia / export_ethiopia /
export_honduras / export_indonesia / export_uganda; centralised here so the
per-origin files only carry origin-specific logic.
"""
from __future__ import annotations

_RISK_ORDER = {"-": 0, "L": 1, "M": 2, "H": 3}


def _worst_risk(risks: list) -> str:
    return max(risks, key=lambda r: _RISK_ORDER.get(r, 0)) if risks else "-"


def _badge(code: str) -> str:
    return {"H": "HIGH", "M": "MED", "L": "LOW", "-": "NONE"}.get(code, "NONE")
