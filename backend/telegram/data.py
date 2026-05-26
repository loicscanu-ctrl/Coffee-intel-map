from __future__ import annotations

import json
import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR  = Path(os.environ.get("DATA_DIR", str(_REPO_ROOT / "frontend" / "public" / "data")))


def load(filename: str) -> dict | list | None:
    path = _DATA_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
