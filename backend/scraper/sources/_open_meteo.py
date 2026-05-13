"""Tiny shared helper for open-meteo HTTP calls.

open-meteo.com occasionally goes slow (>20 s response) — when it does, our
weather scrapers print "FAILED <region>: Read timed out" for one to four
regions per run. Bumping the per-call timeout helps; doing one retry on
transient connection errors helps more. This helper centralises both so
each weather scraper doesn't need its own try/except.

Usage:
    from scraper.sources._open_meteo import get_json
    data = get_json(url, params, headers)   # raises on terminal failure
"""
from __future__ import annotations

from typing import Any

import requests

# Two attempts with progressively-longer timeouts. open-meteo's slow periods
# tend to clear within a minute, so attempt 2 with 60 s usually succeeds when
# attempt 1 (45 s) failed.
_ATTEMPTS: tuple[int, ...] = (45, 60)

_TRANSIENT_ERRORS = (
    requests.exceptions.Timeout,
    requests.exceptions.ConnectionError,
    requests.exceptions.ChunkedEncodingError,
)


def get_json(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
) -> dict[str, Any]:
    """GET + .json() with two-attempt fallback on transient errors.

    Raises the last exception if both attempts fail, matching the behaviour
    callers had before this helper existed (so the surrounding try/except
    still triggers the per-region "FAILED" log line).
    """
    last_err: Exception | None = None
    for timeout in _ATTEMPTS:
        try:
            r = requests.get(url, params=params, headers=headers, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except _TRANSIENT_ERRORS as e:
            last_err = e
            continue
    assert last_err is not None
    raise last_err
